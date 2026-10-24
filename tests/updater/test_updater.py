"""Isolated updater tests: no network, daemon changes, or production containers."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import http.client
import socket
import threading
import time
import tarfile
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[2] / "scripts/updater.py"
spec = importlib.util.spec_from_file_location("updater", MODULE)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class FakeUpdater(updater.Updater):
    def __init__(self, directory):
        super().__init__(directory)
        self.calls = []
        self.failure = None
        self.old_config = {
            "services": {
                "postgres": {"image": "postgres:18-alpine"},
                "valkey": {"image": "valkey:9-alpine"},
                "api": {"image": "ghcr.io/mgate-server/mgate:2026.10.1", "environment": {
                    "MGATE_SECRET_KEY": "keep-secret", "MGATE_INTERNAL_TOKEN": "keep-token"}},
                "web": {"image": "ghcr.io/mgate-server/web:2026.10.1"},
                "worker": {"image": "ghcr.io/mgate-server/mgate:2026.10.1"},
            }, "networks": {"backend": {}}, "volumes": {"pg-data": {}},
        }

    def run(self, args, **_kwargs):
        if "context" in args:
            return b"unix:///var/run/docker.sock\n"
        if "info" in args:
            return str(self.directory).encode()
        if "ps" in args:
            return b"container-id\n"
        if "inspect" in args:
            return json.dumps([{"Config": {"Labels": {"com.docker.compose.project.working_dir": str(self.directory)}}}]).encode()
        raise AssertionError(args)

    def config(self, tree=None, env_file=None):
        value = copy.deepcopy(self.old_config)
        if tree:
            for service in value["services"].values():
                service["image"] = service["image"].replace("2026.10.1", "2026.10.2")
        return value

    def compose(self, *args, tree=None, env_file=None, output=None, input_file=None):
        self.calls.append(args)
        operation = args[0]
        if self.failure == operation or (self.failure == "dump" and "pg_dump" in str(args)) or (self.failure == "restore" and "pg_restore" in args):
            raise updater.UpdateError("simulated failure")
        if "pg_database_size" in str(args):
            return b"100\n"
        if output:
            output.write(b"PGDMP-test")
        return b""

    def verify(self, _config, expected):
        self.calls.append(("verify", expected))
        if self.failure == "verify":
            raise updater.UpdateError("simulated readiness timeout")


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.installed = self.root / "installed"
        self.installed.mkdir()
        self.trees = {}
        for version in ("2026.10.1", "2026.10.2"):
            tree = self.root / version
            (tree / "scripts").mkdir(parents=True)
            (tree / "VERSION").write_text(version + "\n")
            (tree / "docker-compose.yml").write_text("name: mgate\n")
            (tree / "scripts/gen-secrets.sh").write_text("#!/bin/sh\n")
            (tree / "scripts/gen-secrets.sh").chmod(0o755)
            (tree / ".env.example").write_text("MGATE_VERSION=" + version + "\nNEW_SETTING=default\n")
            (tree / "README.md").write_text("release " + version)
            self.trees[version] = tree
        (self.trees["2026.10.1"] / "removed.txt").write_text("obsolete")
        (self.trees["2026.10.2"] / "added.txt").write_text("new")
        import shutil
        shutil.copytree(self.trees["2026.10.1"], self.installed, dirs_exist_ok=True)
        self.env = "MGATE_VERSION=2026.10.1\nMGATE_SECRET_KEY=keep-secret\nCUSTOM='keep=$value'\n"
        (self.installed / ".env").write_text(self.env)
        (self.installed / ".env").chmod(0o600)
        (self.installed / "local.txt").write_text("local data")
        self.manager = FakeUpdater(self.installed)
        # /tmp is intentionally rejected in real privileged updates. Tests only use temp files.
        self.guard = patch.object(updater, "secure_path")
        self.guard.start()
        self.addCleanup(self.guard.stop)
        self.fetch = patch.object(updater, "fetch", side_effect=self.download)
        self.fetch.start()
        self.addCleanup(self.fetch.stop)

    def download(self, url, destination=None):
        if destination is None:
            version = url.rsplit("/v", 1)[-1] if "/tags/v" in url else "2026.10.2"
            return {"tag_name": "v" + version, "draft": False, "prerelease": False}
        version = url.rsplit("/v", 1)[-1].removesuffix(".tar.gz")
        with tarfile.open(destination, "w:gz") as archive:
            archive.add(self.trees[version], arcname="mgate-" + version)

    def perform(self):
        lock, job = self.manager.begin("2026.10.2", "admin-id")
        return self.manager.execute(lock, job)

    def test_success_keeps_local_data_and_creates_backup_before_migration(self):
        self.assertTrue(self.perform())
        job = self.manager.job()
        self.assertEqual(job["stage"], "succeeded")
        self.assertEqual(job["actor"], "admin-id")
        self.assertEqual(self.manager.current(), "2026.10.2")
        self.assertIn("CUSTOM='keep=$value'", (self.installed / ".env").read_text())
        self.assertIn("MGATE_SECRET_KEY=keep-secret", (self.installed / ".env").read_text())
        self.assertIn("NEW_SETTING=default", (self.installed / ".env").read_text())
        self.assertEqual((self.installed / "local.txt").read_text(), "local data")
        self.assertFalse((self.installed / "removed.txt").exists())
        self.assertTrue((self.installed / "added.txt").is_file())
        backup = Path(job["backup_path"])
        self.assertEqual((backup / ".env").read_text(), self.env)
        self.assertEqual((backup / "database.dump").read_bytes(), b"PGDMP-test")
        self.assertTrue((backup / "complete.json").is_file())
        operations = [c[0] for c in self.manager.calls]
        self.assertLess(operations.index("pull"), operations.index("stop"))
        self.assertLess(operations.index("stop"), operations.index("run"))
        self.assertEqual(operations.count("run"), 1)
        self.assertIn(("verify", "2026.10.2"), self.manager.calls)

    def test_modified_release_file_blocks_update_before_stop(self):
        (self.installed / "README.md").write_text("custom")
        self.assertFalse(self.perform())
        self.assertIn("README.md", self.manager.job()["error"])
        self.assertNotIn("stop", [c[0] for c in self.manager.calls])
        self.assertEqual(self.manager.current(), "2026.10.1")

    def test_failed_download_pull_or_disk_check_never_stops_running_services(self):
        self.manager.failure = "pull"
        self.assertFalse(self.perform())
        self.assertNotIn("stop", [c[0] for c in self.manager.calls])
        self.manager.failure = None
        with patch.object(updater.shutil, "disk_usage", return_value=type("Disk", (), {"free": 1})()):
            self.assertFalse(self.perform())
        self.assertNotIn("stop", [c[0] for c in self.manager.calls])
        with patch.object(updater, "fetch", side_effect=updater.UpdateError("offline")):
            with self.assertRaises(updater.UpdateError):
                self.manager.begin("2026.10.2")
        self.assertEqual(self.manager.current(), "2026.10.1")

    def test_conflicting_new_file_and_compose_override_are_rejected(self):
        for name in ("added.txt", "docker-compose.override.yml"):
            with self.subTest(name=name):
                (self.installed / name).write_text("custom")
                self.assertFalse(self.perform())
                (self.installed / name).unlink()
        self.assertNotIn("stop", [c[0] for c in self.manager.calls])

    def test_backup_failure_restarts_old_stack_without_migrating(self):
        self.manager.failure = "dump"
        self.assertFalse(self.perform())
        self.assertEqual(self.manager.job()["stage"], "failed")
        self.assertEqual(self.manager.current(), "2026.10.1")
        self.assertIn("start", [c[0] for c in self.manager.calls])
        self.assertNotIn("run", [c[0] for c in self.manager.calls])
        self.assertFalse((Path(self.manager.job()["backup_path"]) / "complete.json").exists())

    def test_unreadable_dump_stops_before_file_replacement(self):
        self.manager.failure = "restore"
        self.assertFalse(self.perform())
        self.assertEqual(self.manager.current(), "2026.10.1")
        self.assertFalse(self.manager.job()["migration_started"])

    def test_failed_install_restores_previous_files(self):
        real_apply = self.manager.apply
        first = True
        def broken_apply(tree, managed):
            nonlocal first
            real_apply(tree, managed)
            if first:
                first = False
                raise updater.UpdateError("partial install")
        with patch.object(self.manager, "apply", side_effect=broken_apply):
            self.assertFalse(self.perform())
        self.assertEqual(self.manager.current(), "2026.10.1")
        self.assertEqual((self.installed / ".env").read_text(), self.env)
        self.assertFalse((self.installed / "added.txt").exists())
        self.assertTrue((self.installed / "removed.txt").exists())

    def test_migration_and_readiness_failure_require_manual_recovery(self):
        for operation in ("run", "verify"):
            with self.subTest(operation=operation):
                self.manager.failure = operation
                self.assertFalse(self.perform())
                self.assertEqual(self.manager.job()["stage"], "recovery_required")
                self.assertTrue(self.manager.job()["migration_started"])
                self.assertNotIn("start", [c[0] for c in self.manager.calls])
                with self.assertRaises(updater.UpdateError):
                    self.manager.begin("2026.10.3")
                (self.installed / "VERSION").write_text("2026.10.1\n")
                (self.installed / ".env.example").write_text((self.trees["2026.10.1"] / ".env.example").read_text())
                self.manager.job_path.unlink()
                import shutil
                shutil.copytree(self.trees["2026.10.1"], self.installed, dirs_exist_ok=True)
                (self.installed / "added.txt").unlink(missing_ok=True)

    def test_lock_blocks_another_request_and_releases_after_failure(self):
        lock, _ = self.manager.begin("2026.10.2")
        try:
            with self.assertRaises(updater.UpdateError):
                self.manager.begin("2026.10.2")
        finally:
            lock.close()
        self.manager.recover()
        self.assertEqual(self.manager.job()["stage"], "interrupted")
        with self.assertRaises(updater.UpdateError):
            self.manager.begin("2026.10.2")

    def test_interrupted_cli_operation_is_detected_without_daemon(self):
        lock, _ = self.manager.begin("2026.10.2")
        lock.close()
        with self.assertRaises(updater.UpdateError):
            self.manager.begin("2026.10.2")
        self.assertEqual(self.manager.job()["stage"], "interrupted")

    def test_status_survives_network_outage_and_active_job_avoids_network(self):
        lock, job = self.manager.begin("2026.10.2")
        lock.close()
        with patch.object(self.manager, "latest", side_effect=AssertionError("must not fetch")):
            self.assertEqual(self.manager.status()["job"]["id"], job["id"])
        self.manager.save(job, "failed")
        with patch.object(self.manager, "latest", side_effect=updater.UpdateError("offline")):
            self.assertEqual(self.manager.status()["check_error"], "offline")

    def test_versions_and_downgrades(self):
        self.assertLess(updater.version_parts("2026.9.9"), updater.version_parts("2026.10.1"))
        for value in ("2026.10.1", "2026.9.1", "latest", "v2026.10.2", "2026.01.2", "2026.10.0", "2026.10.2;id"):
            with self.subTest(value=value), self.assertRaises(updater.UpdateError):
                self.manager.begin(value)

    def test_prerelease_is_rejected(self):
        with patch.object(updater, "fetch", return_value={"tag_name": "v2026.10.2", "prerelease": True}):
            with self.assertRaises(updater.UpdateError):
                updater.release()

    def test_unsafe_archive_members_are_rejected(self):
        for name, kind in (("root/../../escape", tarfile.REGTYPE), ("/escape", tarfile.REGTYPE),
                           ("root/link", tarfile.SYMTYPE), ("root/hard", tarfile.LNKTYPE),
                           ("root/.env", tarfile.REGTYPE), ("root/.mgate-updater/job.json", tarfile.REGTYPE)):
            with self.subTest(name=name):
                archive = self.root / "bad.tar.gz"
                with tarfile.open(archive, "w:gz") as bundle:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    member.linkname = "/etc/passwd"
                    bundle.addfile(member, io.BytesIO())
                with tempfile.TemporaryDirectory(dir=self.root) as dest:
                    with self.assertRaises(updater.UpdateError):
                        updater.unpack(archive, Path(dest) / "unpack", "2026.10.2")

    def test_real_guard_rejects_symlink_and_writable_installation(self):
        self.guard.stop()
        (self.root / "link").symlink_to(self.installed)
        with self.assertRaises(updater.UpdateError):
            updater.secure_path(self.root / "link")
        self.installed.chmod(0o777)
        with self.assertRaises(updater.UpdateError):
            updater.secure_path(self.installed)

    def test_unix_service_accepts_only_known_requests_and_persists_result(self):
        self.manager.prepare_state()
        with patch.object(updater.os, "chown"):
            server = updater.make_server(self.manager)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

        def request(method, path, body=None):
            connection = http.client.HTTPConnection("localhost", timeout=3)
            connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            connection.sock.connect(str(self.manager.socket))
            try:
                connection.request(method, path, body=json.dumps(body) if body else None)
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()

        self.assertEqual(request("GET", "/arbitrary-command")[0], 404)
        self.assertEqual(request("POST", "/updates", {"version": "2026.10.2", "actor": "admin", "command": "id"})[0], 400)
        with patch.object(updater.subprocess, "run") as service_commands:
            code, job = request("POST", "/updates", {"version": "2026.10.2", "actor": "admin"})
            self.assertEqual(code, 202)
            end = time.monotonic() + 5
            while self.manager.job()["stage"] in updater.ACTIVE and time.monotonic() < end:
                time.sleep(0.01)
            code, status = request("GET", "/updates")
            self.assertEqual(code, 200)
            self.assertEqual(status["job"]["id"], job["id"])
            self.assertEqual(status["job"]["stage"], "succeeded")
            # Keep systemctl mocked until the background worker has finished both calls.
            while service_commands.call_count < 2 and time.monotonic() < end:
                time.sleep(0.01)
            self.assertEqual(service_commands.call_count, 2)


if __name__ == "__main__":
    unittest.main()
