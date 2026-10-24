"""Isolated installer regression tests; never install packages or start containers.

Run: python3 -m unittest discover -s tests/installer -v
"""
from __future__ import annotations

import http.server
import json
import os
from pathlib import Path
import shlex
import shutil
import socket
import ssl
import subprocess
import tarfile
import tempfile
import threading
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/install.sh"


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.target = self.base / "mgate"
        self.target.mkdir()
        self.work = self.base / "work"
        self.work.mkdir()
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.state = self.base / "state.json"
        self.config = {
            "services": {
                "migrate": {"environment": {"MGATE_HOSTNAME": "mail.example.org"}},
                "api": {"environment": {"MGATE_HOSTNAME": "mail.example.org"}},
            },
            "networks": {"backend": {"ipam": {"config": [{"subnet": "172.30.1.0/24"}]}}},
        }
        self.write_state()
        self.executable("docker", '''import json, os, sys
from pathlib import Path
state = json.loads(Path(os.environ['INSTALLER_TEST_STATE']).read_text())
a = sys.argv[1:]
if a[:2] == ['volume', 'ls']:
    print(state.get('volumes', ''), end='')
elif a[:2] == ['network', 'ls']:
    print('net' if state.get('networks') else '')
elif a[:2] == ['network', 'inspect']:
    print(json.dumps(state.get('networks', [])))
elif a[:2] == ['ps', '-q']:
    print('running' if state.get('running') else '')
elif a[:2] == ['ps', '-aq']:
    print('existing' if state.get('existing') else '')
elif a[0] == 'inspect':
    print(json.dumps(state.get('existing', []) if a[1] == 'existing' else state.get('running', []) if a[1] == 'running' else state.get('containers', [])))
elif a[0] == 'compose':
    if '--services' in a:
        print('\\n'.join(state['config']['services']))
    elif 'config' in a:
        print(json.dumps(state['config']))
    elif 'ps' in a:
        print(' '.join(str(n) for n, _ in enumerate(state.get('containers', []))))
    else:
        sys.exit('Unexpected compose operation: ' + repr(a))
else:
    sys.exit('Unexpected Docker operation: ' + repr(a))
''')
        self.executable("ip", '''import json, os, sys
from pathlib import Path
state = json.loads(Path(os.environ['INSTALLER_TEST_STATE']).read_text())
print(json.dumps(state.get('routes', [])))
''')
        (self.target / ".env").write_text("COMPOSE_PROFILES=\n")
        (self.work / "compose.json").write_text(json.dumps(self.config))

    def executable(self, name, code):
        path = self.bin / name
        path.write_text("#!" + shutil.which("python3") + "\n" + code)
        path.chmod(0o755)

    def write_state(self, **extra):
        self.state.write_text(json.dumps({"config": self.config, **extra}))

    def shell(self, body, *, success=True):
        env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                   INSTALLER_TEST_STATE=str(self.state))
        setup = f"source {shlex.quote(str(SCRIPT))}\nparse_args\n"
        setup += f"install_dir={shlex.quote(str(self.target))}\nwork_dir={shlex.quote(str(self.work))}\n"
        result = subprocess.run(["bash", "-c", setup + body], env=env,
                                text=True, capture_output=True, timeout=15)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    @staticmethod
    def container(service, status="running", health="healthy", exit_code=0, directory=None, ports=None):
        labels = {"com.docker.compose.service": service}
        if directory:
            labels["com.docker.compose.project.working_dir"] = str(directory)
        return {"Config": {"Labels": labels},
                "State": {"Status": status, "ExitCode": exit_code, "Health": {"Status": health}},
                "NetworkSettings": {"Ports": ports or {}}}

    def test_help_works_as_file_and_from_pipe_without_root(self):
        for args, data in ((["bash", str(SCRIPT), "--help"], None),
                           (["bash", "-s", "--", "--help"], SCRIPT.read_text())):
            result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--domain", result.stdout)

    def test_invalid_arguments_fail_before_mutations(self):
        for arg in ("--dir", "--version ../../dev", "--wait-timeout 0", "--wait-timeout nope", "--unknown"):
            with self.subTest(arg=arg):
                self.shell("parse_args " + arg, success=False)

    def test_accepts_supported_versions(self):
        self.shell("version_at_least 25.0.2 25.0\nversion_at_least v2.24.0 2.24\nversion_at_least 5.0.1 2.24")
        self.shell("version_at_least 24.9.9 25.0", success=False)
        self.shell("version_at_least v2.23.9 2.24", success=False)
        self.shell("version_at_least invalid 2.24", success=False)

    def test_validates_domain_and_email_without_shell_evaluation(self):
        self.shell("domain=example.org; hostname=mail.example.org; admin_email=admin@example.org; validate_settings")
        for value in ("https://example.org", "127.0.0.1", "foo..org", "-a.org", "пример.рф", "example.org:443"):
            with self.subTest(value=value):
                self.shell(f"domain={shlex.quote(value)}; hostname=mail.example.org; admin_email=admin@example.org; validate_settings", success=False)

    def new_configuration(self, email="admin@example.org"):
        (self.target / ".env").unlink()
        shutil.copy(ROOT / ".env.example", self.target / ".env.example")
        (self.target / "scripts").mkdir()
        shutil.copy(ROOT / "scripts/gen-secrets.sh", self.target / "scripts/gen-secrets.sh")
        return self.shell(f"domain=example.org; hostname=mail.example.org; admin_email={shlex.quote(email)}; without_clamav=1; configure")

    def test_new_configuration_generates_private_secrets_and_pins_version(self):
        result = self.new_configuration()
        content = (self.target / ".env").read_text()
        values = dict(line.split("=", 1) for line in content.splitlines() if line and not line.startswith("#") and "=" in line)
        self.assertEqual(values["MGATE_HOSTNAME"], "mail.example.org")
        self.assertEqual(values["MGATE_MAIL_DOMAIN"], "example.org")
        self.assertEqual(values["COMPOSE_PROFILES"], "")
        self.assertEqual(values["MGATE_VERSION"], (ROOT / "VERSION").read_text().strip())
        self.assertGreaterEqual(len(values["MGATE_ADMIN_PASSWORD"]), 30)
        self.assertNotIn("change-me", values["POSTGRES_PASSWORD"])
        self.assertNotIn(values["MGATE_ADMIN_PASSWORD"], result.stdout + result.stderr)
        self.assertEqual((self.target / ".env").stat().st_mode & 0o777, 0o600)

    @unittest.skipUnless(shutil.which("docker"), "Docker CLI required for compose config validation")
    def test_real_compose_resolves_generated_env_and_quoted_email(self):
        email = "o'neil$test#tag@example.org"
        self.new_configuration(email)
        result = subprocess.run(["docker", "compose", "--project-directory", str(self.target),
                                 "--env-file", str(self.target / ".env"), "-f", str(ROOT / "docker-compose.yml"),
                                 "config", "--format", "json"], text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = json.loads(result.stdout)
        env = rendered["services"]["migrate"]["environment"]
        # Compose 2.24 escapes dollars in the printable model; runtime values stay literal.
        self.assertEqual(env["MGATE_ADMIN_EMAIL"].replace("$$", "$"), email)
        self.assertEqual(env["MGATE_HOSTNAME"], "mail.example.org")
        self.assertGreaterEqual(len(env["MGATE_ADMIN_PASSWORD"]), 30)
        self.assertNotIn("clamav", rendered["services"])
        self.assertIn("docker-entrypoint-initdb.d", str(rendered["services"]["postgres"]["volumes"]))

    def test_existing_env_is_preserved_verbatim_and_never_sourced(self):
        marker = self.base / "should-not-exist"
        content = f'COMPOSE_PROFILES=\nMGATE_ADMIN_PASSWORD=$(touch {marker})\n'
        (self.target / ".env").write_text(content)
        self.shell("configure")
        self.assertEqual((self.target / ".env").read_text(), content)
        self.assertFalse(marker.exists())
        self.shell("domain=new.example.org; configure", success=False)
        self.assertEqual((self.target / ".env").read_text(), content)

    def test_new_env_refuses_existing_volumes(self):
        (self.target / ".env").unlink()
        self.write_state(volumes="mgate_pg-data\n")
        self.shell("domain=example.org; hostname=mail.example.org; admin_email=admin@example.org; without_clamav=1; configure", success=False)
        self.assertFalse((self.target / ".env").exists())

    def test_existing_different_release_is_not_overwritten(self):
        (self.target / "docker-compose.yml").write_text("services: {}\n")
        (self.target / ".env.example").touch()
        (self.target / "scripts").mkdir()
        (self.target / "scripts/gen-secrets.sh").touch()
        (self.target / "VERSION").write_text("2026.10.1\n")
        self.shell("version=2026.10.2; prepare_release", success=False)
        self.assertEqual((self.target / "VERSION").read_text(), "2026.10.1\n")

    def test_standalone_downloads_selected_release_without_git(self):
        (self.target / ".env").unlink()
        source = self.base / "release"
        (source / "scripts").mkdir(parents=True)
        (source / "scripts/gen-secrets.sh").touch()
        (source / "VERSION").write_text("2026.10.2\n")
        (source / "docker-compose.yml").write_text("services: {}\n")
        source.chmod(0o775)
        (source / "scripts").chmod(0o775)
        (source / "scripts/gen-secrets.sh").chmod(0o775)
        (source / "VERSION").chmod(0o664)
        with tarfile.open(self.base / "archive.tar.gz", "w:gz") as archive:
            archive.add(source, arcname="mgate-2026.10.2")
        body = f'''fetch() {{ cp {shlex.quote(str(self.base / 'archive.tar.gz'))} "$3"; }}
version=2026.10.2
umask 002
prepare_release
'''
        self.shell(body)
        self.assertEqual((self.target / "VERSION").read_text(), "2026.10.2\n")
        for name in (".", "scripts", "scripts/gen-secrets.sh", "VERSION"):
            self.assertEqual((self.target / name).stat().st_mode & 0o022, 0, name)

    def local_api(self, domain_status=201):
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def respond(self, status, payload):
                encoded = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def do_GET(self):
                requests.append((self.path, self.headers.get("Host"), None, None))
                self.respond(200, {"status": "ok"})

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                payload = json.loads(body) if body else None
                auth = self.headers.get("Authorization")
                requests.append((self.path, self.headers.get("Host"), payload, auth))
                if self.path.endswith("/login"):
                    self.respond(200, {"status": "ok", "token": "installer-test-token"})
                elif self.path.endswith("/logout"):
                    self.respond(200, {})
                else:
                    self.respond(domain_status, {})

        cert, key = self.base / "cert.pem", self.base / "key.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=installer-test.invalid", "-keyout", str(key), "-out", str(cert)],
                       capture_output=True, check=True, timeout=10)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def close():
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.addCleanup(close)
        self.config["services"]["traefik"] = {"ports": [
            {"host_ip": "0.0.0.0", "published": str(server.server_port), "target": 443}]}
        self.config["services"]["migrate"]["environment"].update(
            MGATE_ADMIN_EMAIL="admin@example.org", MGATE_ADMIN_PASSWORD="installer-test-password")
        (self.work / "bootstrap-env.json").write_text(json.dumps([k + "=" + v for k, v in self.config["services"]["migrate"]["environment"].items()]))
        (self.target / ".env").write_text("MGATE_MAIL_DOMAIN=example.org\n")
        (self.work / "compose.json").write_text(json.dumps(self.config))
        return requests

    def test_connects_domain_through_local_https_and_logs_out(self):
        requests = self.local_api()
        result = self.shell("connect_domain")
        self.assertEqual([r[0] for r in requests], ["/api/v1/system/health", "/api/v1/auth/login",
                                                  "/api/v1/admin/domains", "/api/v1/auth/logout"])
        self.assertTrue(all(r[1] == "mail.example.org" for r in requests))
        self.assertEqual(requests[2][2], {"name": "example.org"})
        self.assertEqual(requests[2][3], "Bearer installer-test-token")
        self.assertNotIn("installer-test-password", result.stdout + result.stderr)
        self.assertNotIn("installer-test-token", result.stdout + result.stderr)
        self.assertEqual((self.target / ".mgate-installed-domain").read_text(), "example.org\n")
        requests.clear()
        self.shell("connect_domain")
        self.assertEqual([r[0] for r in requests], ["/api/v1/system/health"])

    def test_existing_domain_is_accepted_after_interrupted_installation(self):
        self.local_api(domain_status=409)
        self.shell("connect_domain")
        self.assertTrue((self.target / ".mgate-installed-domain").exists())

    def test_domain_failure_does_not_mark_installation_complete(self):
        requests = self.local_api(domain_status=403)
        result = self.shell("connect_domain", success=False)
        self.assertIn("HTTP 403", result.stderr)
        self.assertFalse((self.target / ".mgate-installed-domain").exists())
        self.assertEqual(requests[-1][0], "/api/v1/auth/logout")

    def test_waits_for_successful_migrations_and_healthchecks(self):
        self.write_state(containers=[self.container("migrate", "exited"), self.container("api")])
        self.assertIn("все сервисы готовы", self.shell("wait_ready").stdout)

    def test_failed_migration_does_not_report_success(self):
        self.write_state(containers=[self.container("migrate", "exited", exit_code=1), self.container("api")])
        self.assertIn("Миграции", self.shell("wait_ready", success=False).stderr)

    def test_unhealthy_or_missing_service_times_out(self):
        for containers in ([self.container("migrate", "exited"), self.container("api", health="unhealthy")],
                           [self.container("migrate", "exited")]):
            with self.subTest(containers=containers):
                self.write_state(containers=containers)
                self.assertIn("Истекло время", self.shell("wait_timeout=1; wait_ready", success=False).stderr)

    def test_preflight_checks_every_published_port(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen()
            number = sock.getsockname()[1]
            self.config["services"]["api"]["ports"] = [{"host_ip": "127.0.0.1", "published": str(number), "target": 8080}]
            self.write_state()
            result = self.shell(f"docker_root={shlex.quote(str(self.base))}\ndocker() {{ if [[ $1 == info ]]; then echo {shlex.quote(str(self.base))}; else command docker \"$@\"; fi; }}\npreflight", success=False)
            self.assertIn(str(number), result.stderr)

    def test_docker_nat_port_conflict_is_rejected_without_a_listener(self):
        self.config["services"]["api"]["ports"] = [{"host_ip": "0.0.0.0", "published": "587", "target": 587}]
        self.write_state(running=[self.container("other", ports={"587/tcp": [{"HostIp": "0.0.0.0", "HostPort": "587"}]})])
        result = self.shell(f"docker() {{ if [[ $1 == info ]]; then echo {shlex.quote(str(self.base))}; else command docker \"$@\"; fi; }}\npreflight", success=False)
        self.assertIn("другим Docker-контейнером", result.stderr)

    def test_existing_installation_can_reuse_its_own_published_ports(self):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            sock.listen()
            number = sock.getsockname()[1]
            self.config["services"]["api"]["ports"] = [{"host_ip": "127.0.0.1", "published": str(number), "target": 8080}]
            own = self.container("api", directory=self.target, ports={"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(number)}]})
            own["Config"]["Labels"]["com.docker.compose.project"] = "mgate"
            self.write_state(existing=[own], running=[own])
            self.shell(f"docker() {{ if [[ $1 == info ]]; then echo {shlex.quote(str(self.base))}; else command docker \"$@\"; fi; }}\npreflight")

    def test_no_install_deps_gives_instructions_without_package_changes(self):
        result = self.shell("install_deps=0; os_id=debian; install_docker", success=False)
        self.assertIn("docs.docker.com/engine/install", result.stderr)

    def test_other_installation_with_same_project_is_rejected(self):
        self.write_state(existing=[self.container("api", directory="/another/mgate")])
        result = self.shell(f"docker() {{ if [[ $1 == info ]]; then echo {shlex.quote(str(self.base))}; else command docker \"$@\"; fi; }}\npreflight", success=False)
        self.assertIn("другой compose-проект", result.stderr)

    def test_vpn_route_overlap_is_rejected(self):
        self.write_state(routes=[{"dst": "172.30.0.0/16"}])
        result = self.shell(f"docker() {{ if [[ $1 == info ]]; then echo {shlex.quote(str(self.base))}; else command docker \"$@\"; fi; }}\npreflight", success=False)
        self.assertIn("пересекается с маршрутом", result.stderr)


if __name__ == "__main__":
    unittest.main()
