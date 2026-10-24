"""Standalone update command: old installations, pinned releases and download failures."""
import json
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/update.sh"
source = SCRIPT.read_text().split("<<'PYCODE'\n", 1)[1].rsplit("\nPYCODE", 1)[0]
bootstrap = types.ModuleType("update_bootstrap")
exec(compile(source, str(SCRIPT), "exec"), bootstrap.__dict__)


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name) / "old installation"
        self.directory.mkdir()
        (self.directory / "VERSION").write_text("2026.10.2\n")
        (self.directory / ".env").write_text("MGATE_VERSION=2026.10.2\nCUSTOM=keep\n")
        self.urls = []
        self.release = {"tag_name": "v2026.10.4", "draft": False, "prerelease": False}
        # A stand-in engine records the invocation and makes the newly installed engine
        # available, as a successful update would. It never runs Docker or systemctl.
        self.engine = b'''import json, pathlib, sys
directory = pathlib.Path(sys.argv[sys.argv.index('--dir') + 1])
with (directory / 'calls.jsonl').open('a') as stream:
    stream.write(json.dumps(sys.argv[1:]) + '\\n')
if '--install-service' not in sys.argv:
    assert not (directory / 'scripts/updater.py').exists()
    assert (directory / 'VERSION').read_text() == '2026.10.2\\n'
    (directory / 'scripts').mkdir()
    (directory / 'scripts/updater.py').write_bytes(pathlib.Path(__file__).read_bytes())
'''
        for target, value in (("download", self.download),):
            mock = patch.object(bootstrap, target, side_effect=value)
            mock.start()
            self.addCleanup(mock.stop)
        root = patch.object(bootstrap.os, "geteuid", return_value=0)
        root.start()
        self.addCleanup(root.stop)
        systemd = patch.object(bootstrap.shutil, "which", return_value="/usr/bin/systemctl")
        systemd.start()
        self.addCleanup(systemd.stop)

    def download(self, url):
        self.urls.append(url)
        return self.engine if url.endswith("/updater.py") else json.dumps(self.release).encode()

    def run_update(self, *args):
        return bootstrap.main(["--dir", str(self.directory), "--yes", *args])

    def test_old_installation_bootstraps_without_overwriting_old_files(self):
        original = (self.directory / ".env").read_bytes()
        self.assertEqual(self.run_update(), 0)
        calls = [json.loads(line) for line in (self.directory / "calls.jsonl").read_text().splitlines()]
        self.assertEqual(calls[0], ["--dir", str(self.directory), "--version", "2026.10.4", "--yes"])
        self.assertEqual((self.directory / ".env").read_bytes(), original)
        self.assertIn("/v2026.10.4/scripts/updater.py", self.urls[1])

    def test_enables_panel_updates_on_systemd_after_success(self):
        with patch.object(bootstrap.Path, "is_dir", return_value=True):
            self.run_update()
        calls = [json.loads(line) for line in (self.directory / "calls.jsonl").read_text().splitlines()]
        self.assertEqual(calls[-1], ["--dir", str(self.directory), "--install-service"])

    def test_without_systemd_cli_update_still_succeeds(self):
        with patch.object(bootstrap.shutil, "which", return_value=None):
            self.run_update()
        self.assertEqual(len((self.directory / "calls.jsonl").read_text().splitlines()), 1)

    def test_requested_release_is_pinned_for_download_and_execution(self):
        self.run_update("--version", "2026.10.4")
        self.assertTrue(self.urls[0].endswith("/tags/v2026.10.4"))
        self.assertIn("/v2026.10.4/scripts/updater.py", self.urls[1])

    def test_unpublished_invalid_or_mismatched_releases_do_not_execute(self):
        for change in ({"draft": True}, {"prerelease": True}, {"tag_name": "v../main"},
                       {"tag_name": "v2026.10.5"}):
            with self.subTest(change=change):
                with patch.object(bootstrap, "download", return_value=json.dumps({**self.release, **change}).encode()):
                    with self.assertRaises(ValueError):
                        self.run_update("--version", "2026.10.4")
                self.assertFalse((self.directory / "calls.jsonl").exists())

    def test_network_and_engine_failure_leave_installation_unchanged(self):
        with patch.object(bootstrap, "download", side_effect=OSError("offline")):
            with self.assertRaises(OSError):
                self.run_update()
        self.engine = b"raise SystemExit(1)"
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_update()
        self.assertFalse((self.directory / "scripts").exists())
        self.assertEqual((self.directory / "VERSION").read_text(), "2026.10.2\n")

    def test_detects_existing_directory_from_compose_labels(self):
        containers = [{"Config": {"Labels": {"com.docker.compose.project.working_dir": str(self.directory)}}}]
        responses = [subprocess.CompletedProcess([], 0, stdout="id1 id2\n"),
                     subprocess.CompletedProcess([], 0, stdout=json.dumps(containers))]
        with patch.object(bootstrap.subprocess, "run", side_effect=responses):
            self.assertEqual(bootstrap.installation(None), self.directory)
        containers.append({"Config": {"Labels": {"com.docker.compose.project.working_dir": "/other"}}})
        responses[-1] = subprocess.CompletedProcess([], 0, stdout=json.dumps(containers))
        with patch.object(bootstrap.subprocess, "run", side_effect=responses):
            with self.assertRaises(ValueError):
                bootstrap.installation(None)

    def test_validation_and_help_work_without_a_download(self):
        with patch.object(bootstrap, "download") as download:
            for args in (["--yes", "--version", "../../main"], []):
                with self.assertRaises(ValueError):
                    bootstrap.main(args)
            with patch.object(bootstrap.os, "geteuid", return_value=1000):
                with self.assertRaises(ValueError):
                    self.run_update()
            download.assert_not_called()
        for command, data in ((["bash", str(SCRIPT), "--help"], None),
                              (["bash", "-s", "--", "--help"], SCRIPT.read_text())):
            result = subprocess.run(command, input=data, text=True, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--dir", result.stdout)


if __name__ == "__main__":
    unittest.main()
