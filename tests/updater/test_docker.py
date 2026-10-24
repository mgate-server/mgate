"""Opt-in integration with real Compose/PostgreSQL and synthetic product services.

MGATE_UPDATER_DOCKER_TEST=1 python3 -m unittest discover -s tests/updater -v
Uses a unique project, no published ports, and removes only its own test volumes.
Images must already exist locally; this test never pulls production release images.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
import uuid
from unittest.mock import patch

from test_updater import updater


@unittest.skipUnless(os.environ.get("MGATE_UPDATER_DOCKER_TEST") == "1", "opt-in Docker integration")
class DockerUpdateTests(unittest.TestCase):
    def test_upgrade_keeps_database_mail_queue_and_restoreable_dump(self):
        project = "mgate-update-it-" + uuid.uuid4().hex[:10]
        with tempfile.TemporaryDirectory(prefix="mgate-update-it-") as temporary:
            root = Path(temporary)
            installed = root / "installed"
            trees = {}
            compose = '''name: PROJECT
services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: mgate
      POSTGRES_DB: mgate
      POSTGRES_PASSWORD: temporary-test-only
    volumes: [pg-data:/var/lib/postgresql]
    healthcheck:
      test: [CMD-SHELL, "pg_isready -U mgate"]
      interval: 1s
      timeout: 2s
      retries: 30
  valkey:
    image: alpine:latest
    command: [sleep, infinity]
  api:
    image: python:3.12-slim-bookworm
    command: [python3, /mock_api.py]
    environment:
      RELEASE: ${MGATE_VERSION}
      MGATE_SECRET_KEY: keep-secret
      MGATE_INTERNAL_TOKEN: keep-token
    volumes: [./mock_api.py:/mock_api.py:ro]
  web:
    image: alpine:latest
    command: [sleep, infinity]
  postfix:
    image: alpine:latest
    command: [sleep, infinity]
    volumes: [mail-data:/var/vmail, queue-data:/var/spool/postfix]
  worker:
    image: alpine:latest
    command: [sleep, infinity]
  migrate:
    image: postgres:18-alpine
    entrypoint: [psql]
    environment:
      PGPASSWORD: temporary-test-only
    command: [-h, postgres, -U, mgate, -d, mgate, -c, "ALTER TABLE messages ADD COLUMN IF NOT EXISTS upgraded boolean DEFAULT true"]
volumes:
  pg-data:
  mail-data:
  queue-data:
'''.replace("PROJECT", project)
            mock_api = '''import http.server, json, os
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200); self.end_headers()
  self.wfile.write(json.dumps({'build':{'version':os.environ['RELEASE']}}).encode())
http.server.HTTPServer(('0.0.0.0',8080),Handler).serve_forever()
'''
            for version in ("2026.10.1", "2026.10.2"):
                tree = root / version
                (tree / "scripts").mkdir(parents=True)
                (tree / "VERSION").write_text(version + "\n")
                (tree / "docker-compose.yml").write_text(compose)
                (tree / "mock_api.py").write_text(mock_api)
                (tree / ".env.example").write_text("MGATE_VERSION=" + version + "\n")
                (tree / "scripts/gen-secrets.sh").write_text("#!/bin/sh\n")
                trees[version] = tree
            shutil.copytree(trees["2026.10.1"], installed)
            (installed / ".env").write_text("MGATE_VERSION=2026.10.1\nCUSTOM=keep\n")

            class FixtureUpdater(updater.Updater):
                def validate(self, old, new):
                    # Production image/ownership/project checks are covered by isolated tests.
                    # This fixture deliberately uses local non-product images and a unique name.
                    for relative in updater.files(old):
                        if (self.directory / relative).read_bytes() != (old / relative).read_bytes():
                            raise AssertionError(relative)
                    return self.config()

                def compose(self, *args, **kwargs):
                    if args[0] == "pull":
                        return b""
                    return super().compose(*args, **kwargs)

            manager = FixtureUpdater(installed)

            def download(url, destination=None):
                if destination is None:
                    return {"tag_name": "v2026.10.2", "prerelease": False, "draft": False}
                version = url.rsplit("/v", 1)[-1].removesuffix(".tar.gz")
                with tarfile.open(destination, "w:gz") as bundle:
                    bundle.add(trees[version], arcname="mgate-" + version)

            try:
                manager.compose("up", "-d", "--wait", "postgres", "valkey", "api", "web", "postfix", "worker")
                manager.compose("exec", "-T", "postgres", "psql", "-U", "mgate", "-d", "mgate", "-c",
                                "CREATE TABLE messages(id integer PRIMARY KEY, subject text); INSERT INTO messages VALUES(1,'test-mail')")
                manager.compose("exec", "-T", "postfix", "sh", "-c",
                                "printf 'Subject: test-mail\\n\\nbody' > /var/vmail/sample.eml; echo pending > /var/spool/postfix/sample.queue")
                with patch.object(updater, "secure_path"), patch.object(updater, "fetch", side_effect=download):
                    lock, job = manager.begin("2026.10.2")
                    self.assertTrue(manager.execute(lock, job), manager.job())
                self.assertEqual(manager.job()["stage"], "succeeded")
                row = manager.compose("exec", "-T", "postgres", "psql", "-U", "mgate", "-d", "mgate", "-Atc",
                                      "SELECT subject,upgraded FROM messages").decode().strip()
                self.assertEqual(row, "test-mail|t")
                mail = manager.compose("exec", "-T", "postfix", "cat", "/var/vmail/sample.eml")
                queue = manager.compose("exec", "-T", "postfix", "cat", "/var/spool/postfix/sample.queue")
                self.assertIn(b"Subject: test-mail", mail)
                self.assertEqual(queue.strip(), b"pending")
                self.assertIn("CUSTOM=keep", (installed / ".env").read_text())
                manager.compose("exec", "-T", "postgres", "createdb", "-U", "mgate", "restore_test")
                with (Path(manager.job()["backup_path"]) / "database.dump").open("rb") as stream:
                    manager.compose("exec", "-T", "postgres", "pg_restore", "-U", "mgate", "-d", "restore_test", input_file=stream)
                restored = manager.compose("exec", "-T", "postgres", "psql", "-U", "mgate", "-d", "restore_test", "-Atc", "SELECT subject FROM messages")
                self.assertEqual(restored.strip(), b"test-mail")
                schema = manager.compose("exec", "-T", "postgres", "psql", "-U", "mgate", "-d", "restore_test", "-Atc",
                                         "SELECT count(*) FROM information_schema.columns WHERE table_name='messages' AND column_name='upgraded'")
                self.assertEqual(schema.strip(), b"0")
            finally:
                # Explicitly limited to the unique fixture project; never the real mgate stack.
                subprocess.run(["docker", "compose", "--project-name", project, "--project-directory", str(installed),
                                "-f", str(installed / "docker-compose.yml"), "down", "--volumes", "--remove-orphans"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=60)


if __name__ == "__main__":
    unittest.main()
