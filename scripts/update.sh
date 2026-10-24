#!/usr/bin/env bash
# Use the installed engine, or bootstrap it when downloaded for an older installation.
set -euo pipefail
if [[ -n ${BASH_SOURCE[0]:-} ]]; then
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f $script_dir/updater.py ]]; then
    exec python3 "$script_dir/updater.py" "$@"
  fi
fi

# A standalone copy (including curl | bash) downloads the engine into a private temporary
# directory. Never write new files into the installation before its old release is validated.
exec python3 - "$@" <<'PYCODE'
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "MGate-Updater"})
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read(2 * 1024 * 1024 + 1)
    if len(content) > 2 * 1024 * 1024:
        raise ValueError("Слишком большой ответ сервера обновлений.")
    return content


def installation(directory):
    if directory:
        return Path(directory).absolute()
    result = subprocess.run(
        ["docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=mgate"],
        check=True, capture_output=True, text=True, timeout=30,
    )
    ids = result.stdout.split()
    if not ids:
        raise ValueError("Установка MGate не найдена. Укажите --dir /путь/к/mgate.")
    result = subprocess.run(["docker", "inspect", *ids], check=True, capture_output=True, text=True, timeout=30)
    directories = {container.get("Config", {}).get("Labels", {}).get(
        "com.docker.compose.project.working_dir", "") for container in json.loads(result.stdout)}
    if len(directories) != 1 or not all(directories):
        raise ValueError("Не удалось определить каталог MGate. Укажите --dir /путь/к/mgate.")
    directory = Path(directories.pop())
    if not directory.is_absolute():
        raise ValueError("Каталог MGate должен быть абсолютным.")
    return directory


def main(argv=None):
    parser = argparse.ArgumentParser(description="Обновление существующей установки MGate одной командой.")
    parser.add_argument("--dir", help="Каталог установки; по умолчанию определяется через Docker")
    parser.add_argument("--version", help="Версия YYYY.M.N; по умолчанию последний стабильный релиз")
    parser.add_argument("--yes", action="store_true", help="Подтвердить обновление без терминала")
    args = parser.parse_args(argv)
    if os.geteuid() != 0:
        raise ValueError("Запустите команду через sudo bash.")
    if not args.yes:
        raise ValueError("Для запуска загруженного обновлятора добавьте --yes.")
    pattern = r"[0-9]{4}\.(?:[1-9]|1[0-2])\.[1-9][0-9]*"
    if args.version and not re.fullmatch(pattern, args.version):
        raise ValueError("Некорректная версия; ожидается YYYY.M.N.")
    directory = installation(args.dir)
    endpoint = "/tags/v" + args.version if args.version else "/latest"
    release = json.loads(download("https://api.github.com/repos/mgate-server/mgate/releases" + endpoint))
    if not isinstance(release, dict):
        raise ValueError("Не удалось получить сведения о стабильном релизе.")
    tag = release.get("tag_name", "")
    if (not isinstance(tag, str) or not re.fullmatch("v" + pattern, tag) or release.get("draft") or release.get("prerelease")
            or (args.version and tag != "v" + args.version)):
        raise ValueError("Доступны только опубликованные стабильные релизы.")
    engine = download(f"https://raw.githubusercontent.com/mgate-server/mgate/{tag}/scripts/updater.py")
    compile(engine, "updater.py", "exec")
    print(f"Обновление MGate в {directory} до {tag[1:]}", flush=True)
    with tempfile.TemporaryDirectory(prefix="mgate-updater-") as temporary:
        script = Path(temporary) / "updater.py"
        script.write_bytes(engine)
        subprocess.run([sys.executable, str(script), "--dir", str(directory),
                        "--version", tag[1:], "--yes"], check=True, stdin=subprocess.DEVNULL)
    if Path("/run/systemd/system").is_dir() and shutil.which("systemctl"):
        subprocess.run([sys.executable, str(directory / "scripts/updater.py"),
                        "--dir", str(directory), "--install-service"], check=True,
                       stdin=subprocess.DEVNULL)
    print("MGate обновлён.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError:
        sys.exit("Обновление не завершено. Проверьте сообщение обновлятора выше.")
    except ValueError as error:
        sys.exit(str(error))
    except (OSError, SyntaxError, subprocess.TimeoutExpired):
        sys.exit("Не удалось подготовить обновление. Проверьте параметры, Docker и доступ к GitHub.")
PYCODE
