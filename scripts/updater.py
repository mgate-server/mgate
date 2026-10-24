#!/usr/bin/env python3
"""MGate Compose updater. Standard library only; run on the Docker host."""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import http.server
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socketserver
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
import uuid

RELEASE_API = "https://api.github.com/repos/mgate-server/mgate/releases"
VERSION = re.compile(r"[0-9]{4}\.(?:[1-9]|1[0-2])\.[1-9][0-9]*\Z")
ACTIVE = {"checking", "downloading", "backup", "installing", "migrating", "starting", "verifying"}
PROTECTED = {".git", ".env", ".env.bak", ".mgate-updater", "backups", "node_modules"}
WRITERS = ("traefik", "api", "webmail", "worker", "postfix", "dovecot", "rspamd", "backup", "firewall")


class UpdateError(Exception):
    """An actionable, secret-free error suitable for the operator."""


def version_parts(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise UpdateError("Некорректная версия; ожидается YYYY.M.N.")
    return tuple(map(int, value.split(".")))


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def fetch(url, destination=None):
    request = urllib.request.Request(url, headers={"User-Agent": "MGate-Updater", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(request, timeout=30 if destination else 10) as response:
            if destination is None:
                return json.loads(response.read(2 * 1024 * 1024))
            with destination.open("wb") as stream:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > 128 * 1024 * 1024:
                        raise UpdateError("Архив релиза превышает допустимый размер.")
                    stream.write(chunk)
    except (OSError, ValueError) as error:
        raise UpdateError("Не удалось загрузить релиз. Проверьте доступ к GitHub и сеть.") from error


def release(version=None):
    if version is not None:
        version_parts(version)
    data = fetch(RELEASE_API + (f"/tags/v{version}" if version else "/latest"))
    tag = data.get("tag_name", "")
    if not tag.startswith("v"):
        raise UpdateError("GitHub вернул некорректный релиз.")
    version_parts(tag[1:])
    if data.get("draft") or data.get("prerelease") or (version and tag[1:] != version):
        raise UpdateError("Доступны только опубликованные стабильные релизы.")
    return {"version": tag[1:], "url": f"https://github.com/mgate-server/mgate/releases/tag/{tag}"}


def unpack(archive, destination, expected):
    destination.mkdir(mode=0o700)
    total = 0
    count = 0
    prefix = None
    seen = set()
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            count += 1
            total += member.size
            parts = PurePosixPath(member.name).parts
            if (not parts or member.name.startswith("/") or ".." in parts
                    or not (member.isdir() or member.isfile()) or count > 20000
                    or total > 512 * 1024 * 1024):
                raise UpdateError("Небезопасная структура архива релиза.")
            prefix = prefix or parts[0]
            if parts[0] != prefix:
                raise UpdateError("В архиве несколько корневых каталогов.")
            if len(parts) == 1:
                if not member.isdir():
                    raise UpdateError("Некорректный корень архива.")
                continue
            relative = Path(*parts[1:])
            if relative.parts[0] in PROTECTED:
                raise UpdateError("Архив содержит локальные данные установки.")
            target = destination / relative
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if relative in seen:
                raise UpdateError("Повторяющийся файл в архиве.")
            seen.add(relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(member) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o755 if member.mode & 0o111 else 0o644)
    if ((destination / "VERSION").read_text().strip() != expected
            or not all((destination / p).is_file() for p in ("docker-compose.yml", ".env.example", "scripts/gen-secrets.sh"))):
        raise UpdateError("Неполный релиз или несовпадение VERSION.")


def files(root):
    return {p.relative_to(root) for p in root.rglob("*") if p.is_file()}


def secure_path(path):
    """No symlinks or paths replaceable by unprivileged users in privileged operations."""
    for part in (path, *path.parents):
        if part.is_symlink():
            raise UpdateError("Каталог установки и его файлы не должны быть символическими ссылками.")
        if part.exists():
            info = part.stat()
            if info.st_uid != 0 or info.st_mode & 0o022:
                raise UpdateError(f"Недопустимый владелец или права {part}: нужны root и отсутствие записи для группы/остальных пользователей.")


class Updater:
    def __init__(self, directory):
        self.directory = Path(directory).absolute()
        if self.directory == Path("/") or "\n" in str(self.directory):
            raise UpdateError("Нужен отдельный абсолютный каталог установки.")
        self.home = self.directory / ".mgate-updater"
        self.state_dir = self.home / "state"
        self.job_path = self.state_dir / "job.json"
        self.socket = self.home / "run" / "control.sock"
        self.metadata = None
        self.metadata_at = 0
        self.metadata_lock = threading.Lock()

    def current(self):
        value = (self.directory / "VERSION").read_text().strip()
        version_parts(value)
        return value

    def job(self):
        try:
            return json.loads(self.job_path.read_text())
        except FileNotFoundError:
            return None

    def latest(self, force=False):
        with self.metadata_lock:
            if force or self.metadata is None or time.monotonic() - self.metadata_at > 300:
                self.metadata = release()
                self.metadata_at = time.monotonic()
            return self.metadata

    def status(self, force=False):
        result = {"supported": True, "current_version": self.current(), "latest_version": None,
                  "release_url": None, "check_error": None, "job": self.job()}
        # Progress must stay available while the host is offline or the API is restarting.
        if result["job"] and result["job"]["stage"] in ACTIVE:
            latest = self.metadata
        else:
            try:
                latest = self.latest(force)
            except UpdateError as error:
                latest = None
                result["check_error"] = str(error)
        if latest:
            result.update(latest_version=latest["version"], release_url=latest["url"])
        return result

    def prepare_state(self):
        secure_path(self.directory)
        secure_path(self.state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.home.chmod(0o700)

    def lock(self):
        self.prepare_state()
        secure_path(self.state_dir / "lock")
        stream = (self.state_dir / "lock").open("a")
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            stream.close()
            raise UpdateError("Другое обновление уже выполняется.") from error
        return stream

    def save(self, job, stage, **values):
        job.update(stage=stage, **values)
        atomic_json(self.job_path, job)

    def run(self, args, *, output=None, input_file=None, timeout=600):
        try:
            return subprocess.run(args, check=True, stdout=output or subprocess.PIPE,
                                  stdin=input_file, stderr=subprocess.PIPE, timeout=timeout,
                                  env={k: v for k, v in os.environ.items() if k in
                                       {"PATH", "LANG", "LC_ALL", "HOME", "DOCKER_CONFIG", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
                                        "http_proxy", "https_proxy", "no_proxy"}}).stdout
        except (subprocess.SubprocessError, OSError) as error:
            # Docker/config output may contain passwords: never persist it or return it to HTTP.
            raise UpdateError("Ошибка команды " + args[0] + ". Проверьте службу Docker и локальный журнал контейнеров.") from error

    def compose(self, *args, tree=None, env_file=None, output=None, input_file=None):
        return self.run(["docker", "compose", "--project-directory", str(self.directory),
                         "--env-file", str(env_file or self.directory / ".env"),
                         "-f", str((tree or self.directory) / "docker-compose.yml"), *args], output=output, input_file=input_file)

    def config(self, tree=None, env_file=None):
        return json.loads(self.compose("config", "--format", "json", tree=tree, env_file=env_file))

    def validate(self, old, new):
        for name in ("docker-compose.override.yml", "docker-compose.override.yaml", "compose.override.yml", "compose.override.yaml"):
            if (self.directory / name).exists():
                raise UpdateError("Найдены пользовательские Compose overrides; обновите такую установку вручную.")
        managed = files(old) | files(new)
        for relative in sorted(managed):
            local, previous = self.directory / relative, old / relative
            secure_path(local)
            if previous.is_file():
                if not local.is_file() or local.read_bytes() != previous.read_bytes() or bool(local.stat().st_mode & 0o111) != bool(previous.stat().st_mode & 0o111):
                    raise UpdateError(f"Локально изменён файл {relative}; требуется ручное обновление.")
            elif local.exists():
                raise UpdateError(f"Новый файл релиза конфликтует с {relative}.")
        secure_path(self.directory / ".env")
        current = self.config()
        endpoint = self.run(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]).decode().strip()
        if not endpoint.startswith("unix://"):
            raise UpdateError("Для обновления нужен локальный Docker daemon.")
        ids = self.run(["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=mgate"]).decode().split()
        if not ids:
            raise UpdateError("Не найден работающий Compose-проект mgate.")
        for container in json.loads(self.run(["docker", "inspect", *ids])):
            labels = container.get("Config", {}).get("Labels", {})
            if Path(labels.get("com.docker.compose.project.working_dir", "/")).resolve() != self.directory.resolve():
                raise UpdateError("Compose-проект mgate принадлежит другому каталогу.")
        services = current["services"]
        env = services["api"]["environment"]
        configured = services["api"]["image"].rsplit(":", 1)[-1]
        if configured != self.current():
            raise UpdateError("VERSION не совпадает с закреплённой версией образов в .env.")
        registry = "ghcr.io/mgate-server/"
        for name, service in services.items():
            image = service.get("image", "")
            if name in {"api", "webmail", "worker", "migrate", "web", "postfix", "dovecot", "rspamd", "unbound", "traefik", "backup", "firewall", "restore"}:
                image_name = "mgate" if name in {"api", "webmail", "worker", "migrate"} else "backup" if name == "restore" else name
                if image != f"{registry}{image_name}:{configured}":
                    raise UpdateError("Нестандартный реестр или образ; требуется ручное обновление.")
        if not env.get("MGATE_SECRET_KEY") or not env.get("MGATE_INTERNAL_TOKEN"):
            raise UpdateError("Отсутствуют существующие секреты установки.")
        return current

    def candidate_env(self, target, destination):
        text = (self.directory / ".env").read_text()
        seen = set(re.findall(r"^([A-Za-z_][A-Za-z0-9_]*)=", text, re.M))
        # Preserve all existing values verbatim. Only a version pin may change.
        text = re.sub(r"^MGATE_VERSION=.*$", "MGATE_VERSION=" + target["version"], text, flags=re.M)
        if "MGATE_VERSION" not in seen:
            text += "\nMGATE_VERSION=" + target["version"] + "\n"
        for line in (target["tree"] / ".env.example").read_text().splitlines():
            match = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
            if match and match[1] not in seen:
                key, value = match.groups()
                if key in {"MGATE_SECRET_KEY", "MGATE_INTERNAL_TOKEN", "POSTGRES_PASSWORD", "POSTGRES_MAIL_PASSWORD", "VALKEY_PASSWORD", "DOVEADM_API_KEY", "RSPAMD_CONTROLLER_PASSWORD"}:
                    raise UpdateError("Не хватает существующего секрета " + key + ". Выполните ручную настройку.")
                text += "\n" + line + "\n"
        destination.write_text(text)
        destination.chmod(0o600)

    def apply(self, tree, managed):
        for relative in sorted(managed):
            target = self.directory / relative
            secure_path(target)
            if (tree / relative).is_file():
                target.parent.mkdir(parents=True, exist_ok=True)
                # Atomic replacement of each managed file; the writers are stopped.
                temporary = target.with_name(target.name + ".mgate-update")
                secure_path(temporary)
                shutil.copy2(tree / relative, temporary)
                os.replace(temporary, target)
            elif target.is_file():
                target.unlink()

    def recover(self):
        with self.lock():
            job = self.job()
            if job and job["stage"] in ACTIVE:
                self.save(job, "interrupted", error="Обновление прервано. Проверьте резервную копию и восстановите установку вручную.")

    def begin(self, version, actor="cli"):
        version_parts(version)
        lock = self.lock()
        try:
            previous = self.job()
            if previous and previous["stage"] in ACTIVE:
                self.save(previous, "interrupted", error="Предыдущее обновление прервано; требуется ручная проверка установки.")
                raise UpdateError("Предыдущее обновление прервано; см. docs/UPDATES.md.")
            if previous and previous["stage"] in {"interrupted", "recovery_required"}:
                raise UpdateError("Сначала восстановите установку после прерванного обновления; см. docs/UPDATES.md.")
            if version_parts(version) <= version_parts(self.current()):
                raise UpdateError("Нужна версия новее установленной.")
            target = release(version)
            job = {"id": str(uuid.uuid4()), "from_version": self.current(), "to_version": target["version"],
                   "actor": actor, "stage": "checking", "started_at": int(time.time()),
                   "error": None, "backup_path": None, "migration_started": False}
            self.save(job, "checking")
            return lock, job
        except BaseException:
            lock.close()
            raise

    def execute(self, lock, job):
        stopped = False
        changed = False
        backup = None
        active_writers = []
        try:
            with tempfile.TemporaryDirectory(prefix="mgate-update-", dir=self.state_dir) as scratch:
                scratch = Path(scratch)
                self.save(job, "downloading")
                for name, version in (("old", job["from_version"]), ("new", job["to_version"])):
                    archive = scratch / (name + ".tar.gz")
                    fetch(f"https://github.com/mgate-server/mgate/archive/refs/tags/v{version}.tar.gz", archive)
                    unpack(archive, scratch / name, version)
                old, new = scratch / "old", scratch / "new"
                current = self.validate(old, new)
                candidate = scratch / "candidate.env"
                self.candidate_env({"version": job["to_version"], "tree": new}, candidate)
                next_config = self.config(new, candidate)
                # Core infrastructure/data paths and secrets must never move implicitly.
                for name in ("postgres", "valkey"):
                    if current["services"][name] != next_config["services"][name]:
                        raise UpdateError("Изменение PostgreSQL/Valkey требует ручного обновления.")
                for name in ("networks", "volumes"):
                    if current.get(name) != next_config.get(name):
                        raise UpdateError("Изменение сетей или томов требует ручного обновления.")
                for name, service in current["services"].items():
                    next_mounts = next_config["services"].get(name, {}).get("volumes", [])
                    for mount in service.get("volumes", []):
                        if mount not in next_mounts:
                            raise UpdateError("Изменение существующих путей хранения требует ручного обновления.")
                for key in ("MGATE_SECRET_KEY", "MGATE_INTERNAL_TOKEN", "MGATE_DATABASE_URL", "MGATE_REDIS_URL", "MGATE_HOSTNAME"):
                    if current["services"]["api"]["environment"].get(key) != next_config["services"]["api"]["environment"].get(key):
                        raise UpdateError("Изменение подключения к данным или секретов требует ручного обновления.")
                docker_root = Path(self.run(["docker", "info", "--format", "{{.DockerRootDir}}"]).decode().strip())
                available = min(shutil.disk_usage(p).free for p in (self.directory, self.state_dir, docker_root))
                db_size = int(self.compose("exec", "-T", "postgres", "sh", "-c",
                    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT pg_database_size(current_database())"').strip())
                if available < max(5 * 1024**3, db_size * 2):
                    raise UpdateError("Недостаточно места для резервной копии (нужно не менее 5 GiB и двойного размера базы).")
                self.compose("pull", tree=new, env_file=candidate)
                backup = self.state_dir / "backups" / job["id"]
                backup.mkdir(parents=True, mode=0o700)
                managed = files(old) | files(new)
                snapshot = backup / "files"
                snapshot.mkdir()
                for relative in files(old):
                    target = snapshot / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(self.directory / relative, target)
                shutil.copy2(self.directory / ".env", backup / ".env")
                atomic_json(backup / "manifest.json", {"files": sorted(map(str, managed))})
                self.save(job, "backup", backup_path=str(backup))
                active_writers = [name for name in WRITERS if name in current["services"]]
                stopped = True
                self.compose("stop", *active_writers)
                with (backup / "database.dump").open("wb") as dump:
                    self.compose("exec", "-T", "postgres", "sh", "-c",
                                 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc', output=dump)
                    dump.flush()
                    os.fsync(dump.fileno())
                with (backup / "database.dump").open("rb") as dump:
                    self.compose("exec", "-T", "postgres", "pg_restore", "--list", input_file=dump)
                atomic_json(backup / "complete.json", {"version": job["from_version"], "created_at": int(time.time())})
                self.save(job, "installing")
                changed = True
                self.apply(new, managed)
                shutil.copy2(candidate, self.directory / ".env")
                self.save(job, "migrating", migration_started=True)
                self.compose("run", "--rm", "--no-deps", "migrate")
                self.save(job, "starting")
                # The explicit migration above must not be run a second time by depends_on.
                self.compose("up", "-d", "--no-build", "--no-deps", *[n for n in next_config["services"] if n != "migrate"])
                self.save(job, "verifying")
                self.verify(next_config, job["to_version"])
                # Refresh the installed engine for the next operation. The current process
                # keeps running its original code until this operation is durably complete.
                package = Path("/usr/local/lib/mgate-updater/updater.py")
                config_path = Path("/etc/mgate-updater.json")
                if package.is_file() and config_path.is_file() and (new / "scripts/updater.py").is_file():
                    config = json.loads(config_path.read_text())
                    if config.get("directory") == str(self.directory):
                        secure_path(package)
                        temporary = package.with_suffix(".next")
                        secure_path(temporary)
                        shutil.copy2(new / "scripts/updater.py", temporary)
                        temporary.chmod(0o644)
                        os.replace(temporary, package)
                        unit = new / "deploy/systemd/mgate-updater.service"
                        if unit.is_file():
                            installed_unit = Path("/etc/systemd/system/mgate-updater.service")
                            secure_path(installed_unit)
                            shutil.copy2(unit, installed_unit)
                            installed_unit.chmod(0o644)
                self.save(job, "succeeded", finished_at=int(time.time()))
                return True
        except BaseException as error:
            message = str(error) if isinstance(error, UpdateError) else "Ошибка обновления. Проверьте Docker и резервную копию."
            stage = "failed"
            if job["migration_started"]:
                stage = "recovery_required"
            elif stopped:
                try:
                    if changed:
                        manifest = json.loads((backup / "manifest.json").read_text())
                        self.apply(backup / "files", {Path(p) for p in manifest["files"]})
                        shutil.copy2(backup / ".env", self.directory / ".env")
                    self.compose("start", *active_writers)
                except Exception:
                    stage = "recovery_required"
                    message += " Не удалось запустить прежний стек; требуется ручное восстановление."
            self.save(job, stage, error=message, finished_at=int(time.time()))
            return False
        finally:
            lock.close()

    def verify(self, config, expected):
        deadline = time.monotonic() + 300
        required = set(config["services"]) - {"migrate"}
        while time.monotonic() < deadline:
            ids = self.compose("ps", "-q").decode().split()
            containers = json.loads(self.run(["docker", "inspect", *ids])) if ids else []
            ready = set()
            for container in containers:
                state = container["State"]
                if state.get("Running") and state.get("Health", {}).get("Status", "healthy") == "healthy":
                    ready.add(container["Config"]["Labels"]["com.docker.compose.service"])
            if required <= ready:
                # Ask the actual backend; healthy old containers do not prove an upgrade.
                value = json.loads(self.compose("exec", "-T", "web", "wget", "-qO-", "http://api:8080/api/v1/system/info"))
                if value["build"]["version"] == expected:
                    return
            time.sleep(3)
        raise UpdateError("Сервисы не стали готовы за 5 минут или версия API не совпадает с релизом.")


class UnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def make_server(updater):
    updater.home.chmod(0o711)
    updater.socket.parent.mkdir(mode=0o755, exist_ok=True)
    updater.socket.parent.chmod(0o755)
    secure_path(updater.socket.parent)
    updater.socket.unlink(missing_ok=True)

    class Handler(http.server.BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            encoded = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            with contextlib.suppress(BrokenPipeError):
                self.wfile.write(encoded)

        def do_GET(self):
            if self.path not in {"/updates", "/updates?refresh=true"}:
                return self.reply(404, {})
            try:
                self.reply(200, updater.status(self.path.endswith("?refresh=true")))
            except Exception:
                self.reply(503, {"error": "Не удалось прочитать состояние установки."})

        def do_POST(self):
            if self.path != "/updates":
                return self.reply(404, {})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096:
                    return self.reply(400, {})
                value = json.loads(self.rfile.read(size))
                if set(value) != {"version", "actor"} or not isinstance(value["actor"], str) or len(value["actor"]) > 100:
                    return self.reply(400, {})
                lock, job = updater.begin(value["version"], value["actor"])
                def execute_and_reload():
                    if updater.execute(lock, job):
                        subprocess.run(["systemctl", "daemon-reload"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                        subprocess.run(["systemctl", "try-restart", "--no-block", "mgate-updater.service"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                thread = threading.Thread(target=execute_and_reload, daemon=False)
                thread.start()
                self.reply(202, job)
            except UpdateError as error:
                self.reply(409, {"error": str(error)})
            except (ValueError, KeyError, TypeError):
                self.reply(400, {})
            except Exception:
                self.reply(503, {"error": "Служба обновления недоступна."})

    server = UnixServer(str(updater.socket), Handler)
    os.chown(updater.socket, 0, 10001)
    updater.socket.chmod(0o660)
    return server


def serve(updater):
    updater.recover()
    with make_server(updater) as server:
        server.serve_forever(poll_interval=1)


def install_service(updater):
    updater.prepare_state()
    updater.home.chmod(0o711)
    updater.socket.parent.mkdir(mode=0o755, exist_ok=True)
    updater.socket.parent.chmod(0o755)
    secure_path(updater.socket.parent)
    package = Path("/usr/local/lib/mgate-updater")
    secure_path(package)
    package.mkdir(parents=True, exist_ok=True, mode=0o755)
    package.chmod(0o755)
    secure_path(package / "updater.py")
    secure_path(Path("/etc/mgate-updater.json"))
    secure_path(Path("/etc/systemd/system/mgate-updater.service"))
    shutil.copy2(Path(__file__), package / "updater.py")
    (package / "updater.py").chmod(0o644)
    atomic_json(Path("/etc/mgate-updater.json"), {"directory": str(updater.directory)})
    unit = Path(__file__).resolve().parent.parent / "deploy/systemd/mgate-updater.service"
    shutil.copy2(unit, "/etc/systemd/system/mgate-updater.service")
    Path("/etc/systemd/system/mgate-updater.service").chmod(0o644)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", "mgate-updater.service"], check=True)


def main():
    parser = argparse.ArgumentParser(description="Обновление MGate Docker Compose с резервной копией базы и настроек.")
    parser.add_argument("--dir", default=str(Path(__file__).resolve().parent.parent))
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--status", action="store_true")
    mode.add_argument("--install-service", action="store_true")
    mode.add_argument("--serve", action="store_true", help=argparse.SUPPRESS)
    mode.add_argument("--acknowledge-recovery", action="store_true", help="Снять блокировку после ручного восстановления и проверки установки")
    parser.add_argument("--version")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    try:
        if args.serve:
            args.dir = json.loads(Path("/etc/mgate-updater.json").read_text())["directory"]
        updater = Updater(args.dir)
        if args.check:
            print(json.dumps(updater.status(), ensure_ascii=False, indent=2))
            return 0
        if args.status:
            print(json.dumps(updater.job(), ensure_ascii=False, indent=2))
            return 0
        if os.geteuid() != 0:
            raise UpdateError("Запустите обновление через sudo.")
        if args.install_service:
            install_service(updater)
            print("Служба обновления установлена. Пересоздайте API с новым Compose-файлом для доступа из панели.")
            return 0
        if args.serve:
            serve(updater)
            return 0
        if args.acknowledge_recovery:
            with updater.lock():
                job = updater.job()
                if job:
                    updater.save(job, "recovered", error=None)
            return 0
        target = release(args.version)
        if version_parts(target["version"]) == version_parts(updater.current()):
            print("Установлена актуальная версия.")
            return 0
        if version_parts(target["version"]) < version_parts(updater.current()):
            raise UpdateError("Понижение версии не поддерживается.")
        print(f"MGate {updater.current()} → {target['version']}. Будут созданы копия базы и настроек и перезапущены сервисы.")
        if not args.yes and (not sys.stdin.isatty() or input("Продолжить? [y/N] ").lower() not in {"y", "yes"}):
            raise UpdateError("Обновление отменено; для автоматического запуска укажите --yes.")
        lock, job = updater.begin(target["version"])
        success = updater.execute(lock, job)
        print(json.dumps(updater.job(), ensure_ascii=False, indent=2))
        if success and Path("/etc/mgate-updater.json").is_file():
            configured = json.loads(Path("/etc/mgate-updater.json").read_text()).get("directory")
            if configured == str(updater.directory):
                subprocess.run(["systemctl", "daemon-reload"], check=False)
                subprocess.run(["systemctl", "try-restart", "--no-block", "mgate-updater.service"], check=False)
        return 0 if success else 1
    except (UpdateError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error) if isinstance(error, UpdateError) else "Не удалось выполнить обновление; проверьте установку и службу Docker.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
