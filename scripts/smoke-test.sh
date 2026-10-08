#!/usr/bin/env bash
# smoke-test.sh — end-to-end smoke test of a running MGate stack (make smoke).
#
# Provisions a test fixture (domain + mailbox) with a minimal insert-only SQL snippet, so the
# test does not depend on the admin API (an already existing domain is never modified; for an
# existing test mailbox only the password hash is refreshed; the hash is an argon2id PHC string
# produced by `doveadm pw -s ARGON2ID`). Use a dedicated test domain, not a production one.
# Publishes a DKIM key to Valkey db 1 the way mgate does (HSET DKIM_KEYS "<selector>.<domain>"
# <PEM>, HSET DKIM_SELECTORS <domain> <selector>), then:
#   a) SMTP :25 inbound to the local mailbox -> Rspamd milter headers -> LMTP -> Maildir
#   b) IMAP :143 STARTTLS and :993 login through the API passdb, LIST with special-use folders
#   c) Submission :587 STARTTLS + AUTH, outbound to an external address -> relayed to mailpit
#      (dev overlay) with a DKIM-Signature for the test domain
#   d) Valkey stream mgate:logs receives postfix and dovecot lines (mgate-agent syslog)
#   e) HTTPS via Traefik: SPA, /api/v1/system/health, /api/v1/mail/health (self-signed: -k)
#   f) wrong passwords are rejected (IMAP and SMTP AUTH)
#
# Requires: the stack running (make dev, or the build + dev overlays with all services),
# docker compose, python3 (standard library only). Reads .env for ports and secrets.
#
# Env overrides:
#   SMOKE_HOST             host the published ports listen on (default 127.0.0.1)
#   SMOKE_TEST_DOMAIN      mail domain to provision (default: MGATE_HOSTNAME minus first label)
#   SMOKE_TEST_LOCAL       local part of the test mailbox (default smoketest)
#   SMOKE_TEST_PASSWORD    password to set (default: random per run)
#   SMOKE_EXTERNAL_RCPT    outbound recipient (default smoke-rcpt@example.org -> mailpit)
#   SMOKE_COMPOSE          compose command used for `exec` (default: docker compose -f docker-compose.yml)
#   SMOKE_TIMEOUT          seconds to wait for deliveries (default 60)
set -uo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root" || exit 1

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[FAIL] python3 not found on PATH — required to run smoke-test.sh" >&2
  exit 1
fi

export SMOKE_HOST="${SMOKE_HOST:-127.0.0.1}"
export SMOKE_COMPOSE="${SMOKE_COMPOSE:-docker compose -f docker-compose.yml}"

exec python3 - <<'PYEOF'
import email
import imaplib
import json
import os
import re
import secrets
import shlex
import smtplib
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request

E = os.environ
HOST = E["SMOKE_HOST"]
COMPOSE = shlex.split(E["SMOKE_COMPOSE"])
TIMEOUT = int(E.get("SMOKE_TIMEOUT", "60"))
HOSTNAME = E.get("MGATE_HOSTNAME", "mail.example.com")
labels = HOSTNAME.split(".")
DOMAIN = E.get("SMOKE_TEST_DOMAIN") or (".".join(labels[1:]) if len(labels) > 2 else HOSTNAME)
# IANA started publishing a real anti-spoofing SPF ("-all") + DMARC ("p=reject") policy for the
# example.{com,net,org,edu} domains (verified live against public DNS on 2026-09-12) -- this
# script's unauthenticated inbound probe in step (a), which claims `From: probe@{DOMAIN}` with
# no SPF/DKIM, is now correctly *hard-rejected* by DMARC alignment instead of merely scored into
# Junk (the behavior docs/TESTING.md documents and this script's assertions assume) whenever
# DOMAIN resolves to one of those. That breaks `make smoke` out of the box for anyone using the
# documented default MGATE_HOSTNAME=mail.example.com without an explicit SMOKE_TEST_DOMAIN.
# Fall back to an RFC 2606 domain that is guaranteed to never resolve, so the antispam checks
# below see "no policy" rather than a real internet policy that can change out from under us.
if DOMAIN in ("example.com", "example.net", "example.org", "example.edu"):
    DOMAIN = "smoke.mgate.test"
LOCAL = E.get("SMOKE_TEST_LOCAL", "smoketest")
USER = f"{LOCAL}@{DOMAIN}"
PASSWORD = E.get("SMOKE_TEST_PASSWORD") or "Smoke-" + secrets.token_urlsafe(12)
EXT_RCPT = E.get("SMOKE_EXTERNAL_RCPT", "smoke-rcpt@example.org")
SELECTOR = "dkim"
RUN = secrets.token_hex(4)


def port(name, default):
    return int(E.get(name) or default)


P_SMTP = port("MGATE_SMTP_PORT", 25)
P_SUBM = port("MGATE_SUBMISSION_PORT", 587)
P_SUBMS = port("MGATE_SUBMISSIONS_PORT", 465)
P_IMAP = port("MGATE_IMAP_PORT", 143)
P_IMAPS = port("MGATE_IMAPS_PORT", 993)
P_HTTPS = port("MGATE_HTTPS_PORT", 443)
P_HTTP = port("MGATE_HTTP_PORT", 80)
P_MAILPIT = port("MGATE_DEV_MAILPIT_PORT", 8025)

results = []  # (name, status, detail)


def record(name, status, detail=""):
    results.append((name, status, detail))
    print(f"  [{status}] {name}" + (f": {detail}" if detail else ""), flush=True)


def section(title):
    print(f"\n== {title} ==", flush=True)


def dexec(service, *cmd, stdin=None, check=True):
    """Runs a command inside a compose service container; returns stdout (str)."""
    p = subprocess.run(
        COMPOSE + ["exec", "-T", service, *cmd],
        input=stdin, capture_output=True, text=True, timeout=120,
    )
    if check and p.returncode != 0:
        raise RuntimeError(f"{service}: {' '.join(cmd[:3])}... exit {p.returncode}: "
                           f"{(p.stderr or p.stdout).strip()[-400:]}")
    return p.stdout


def valkey(db, *args, stdin=None):
    return dexec("valkey", "valkey-cli", "--no-auth-warning", "-a", E["VALKEY_PASSWORD"],
                 "-n", str(db), *args, stdin=stdin)


def tls_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # self-signed bootstrap cert until ACME issues a real one
    return ctx


def wait_for(fn, timeout=TIMEOUT, interval=2):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = fn()
            if last:
                return last
        except Exception as exc:  # noqa: BLE001 - retried until the deadline
            last = exc
        time.sleep(interval)
    return None


# --- provisioning ----------------------------------------------------------------------------
section(f"provision {USER} (domain {DOMAIN}) + DKIM key in Valkey db 1")
try:
    out = dexec("dovecot", "doveadm", "pw", "-s", "ARGON2ID", "-p", PASSWORD).strip()
    pw_hash = re.sub(r"^\{ARGON2ID\}", "", out)
    if not pw_hash.startswith("$argon2id$"):
        raise RuntimeError(f"unexpected doveadm pw output: {out[:40]}")
    sql = """
INSERT INTO domains (name, status)
  SELECT :'dom', 'active'
  WHERE NOT EXISTS (SELECT 1 FROM domains WHERE name = :'dom');
UPDATE mailboxes SET password_hash = :'hash' WHERE address = :'addr';
INSERT INTO mailboxes (domain_id, local_part, password_hash, display_name)
  SELECT d.id, :'local', :'hash', 'MGate smoke test' FROM domains d
  WHERE d.name = :'dom' AND NOT EXISTS (SELECT 1 FROM mailboxes WHERE address = :'addr');
SELECT address || ' ' || status FROM mailboxes WHERE address = :'addr';
"""
    out = dexec("postgres", "psql", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1",
                "-U", E.get("POSTGRES_USER", "mgate"), "-d", E.get("POSTGRES_DB", "mgate"),
                "-v", f"dom={DOMAIN}", "-v", f"local={LOCAL}", "-v", f"addr={USER}",
                "-v", f"hash={pw_hash}", stdin=sql)
    record("mailbox provisioned", "OK", out.strip())
    # Password may have changed since a previous run: drop Dovecot's auth cache.
    dexec("dovecot", "doveadm", "auth", "cache", "flush", check=False)
    userdb = dexec("dovecot", "doveadm", "user", USER).strip().replace("\n", "; ")
    record("dovecot userdb (SQL view)", "OK", userdb[:160])
except Exception as exc:  # noqa: BLE001
    record("provisioning", "FAIL", str(exc))
    print("\nsmoke-test: provisioning failed, aborting")
    sys.exit(1)

try:
    pem = dexec("postfix", "openssl", "genpkey", "-algorithm", "RSA",
                "-pkeyopt", "rsa_keygen_bits:2048")
    valkey(1, "-x", "HSET", "DKIM_KEYS", f"{SELECTOR}.{DOMAIN}", stdin=pem)
    valkey(1, "HSET", "DKIM_SELECTORS", DOMAIN, SELECTOR)
    record("DKIM key published", "OK", f"DKIM_KEYS[{SELECTOR}.{DOMAIN}], DKIM_SELECTORS[{DOMAIN}]")
except Exception as exc:  # noqa: BLE001
    record("DKIM key published", "FAIL", str(exc))


def imap_fetch_headers(subject_token):
    """Header block of the message with that Subject, and the folder it was filed into.

    Rspamd scores an unauthenticated message from a domain with no SPF/DKIM/DMARC above the
    add_header threshold, so `sieve_before` (X-Spam: Yes) files it into Junk — both folders are
    a successful Maildir delivery.
    """
    for folder in ("INBOX", "Junk"):
        out = dexec("dovecot", "doveadm", "fetch", "-u", USER, "hdr", "mailbox", folder,
                    "header", "Subject", subject_token, check=False)
        if "Subject:" in out:
            return out, folder
    return None


# --- a) inbound SMTP ---------------------------------------------------------------------------
section(f"a) SMTP :{P_SMTP} inbound -> rspamd -> LMTP -> Maildir")
subj_in = f"MGate smoke inbound {RUN}"
try:
    with smtplib.SMTP(HOST, P_SMTP, timeout=30) as smtp:
        smtp.ehlo("smoke-client.example.net")
        msg = (f"From: Smoke Probe <probe@{DOMAIN}>\r\nTo: {USER}\r\nSubject: {subj_in}\r\n"
               f"Message-ID: <in-{RUN}@smoke.invalid>\r\n"
               f"Date: {email.utils.formatdate()}\r\n\r\n"
               "Inbound smoke-test message (scripts/smoke-test.sh).\r\n")
        refused = smtp.sendmail(f"probe@{DOMAIN}", [USER], msg)
    if refused:
        record("SMTP accepted", "FAIL", f"refused: {refused}")
    else:
        record("SMTP accepted", "OK", f"250 for {USER}")
    found = wait_for(lambda: imap_fetch_headers(subj_in))
    if not found:
        record("delivered to Maildir", "FAIL", f"not in INBOX/Junk after {TIMEOUT}s")
        hdrs = ""
    else:
        hdrs, folder = found
        status = dexec("dovecot", "doveadm", "mailbox", "status", "-u", USER,
                       "messages", "INBOX", "Junk").strip().replace("\n", "; ")
        record("delivered to Maildir", "OK",
               f"doveadm fetch found it in {folder} (spam -> Junk via sieve_before); {status}")
    if hdrs:
        rsp = [ln for ln in hdrs.splitlines()
               if re.match(r"(?i)^(X-Spam|X-Spamd-Result|X-Rspamd-Action|X-Rspamd-Server"
                           r"|X-Spamd-Bar|Authentication-Results):", ln)]
        if any(ln.lower().startswith(("x-spamd-result", "x-rspamd-")) for ln in rsp):
            record("rspamd milter headers", "OK", " | ".join(x.strip()[:70] for x in rsp[:4]))
        else:
            record("rspamd milter headers", "FAIL", "no X-Spamd-Result/X-Rspamd-* header")
except Exception as exc:  # noqa: BLE001
    record("SMTP inbound", "FAIL", repr(exc))


# --- b) IMAP -------------------------------------------------------------------------------------
section(f"b) IMAP :{P_IMAP} STARTTLS and :{P_IMAPS} TLS login via API passdb")
SPECIAL = ("\\Sent", "\\Drafts", "\\Junk", "\\Trash")


def check_list(imap, label):
    typ, boxes = imap.list()
    lines = [b.decode(errors="replace") for b in boxes or []]
    missing = [s for s in SPECIAL if not any(s in ln for ln in lines)]
    if typ == "OK" and not missing:
        record(f"{label} LIST special-use", "OK", ", ".join(
            ln.split(' "')[-1].strip('"') for ln in lines))
    else:
        record(f"{label} LIST special-use", "FAIL", f"{typ}; missing {missing}; got {lines}")


try:
    imap = imaplib.IMAP4(HOST, P_IMAP, timeout=20)
    imap.starttls(ssl_context=tls_ctx())
    imap.login(USER, PASSWORD)
    record("IMAP STARTTLS login", "OK", USER)
    check_list(imap, "IMAP")
    imap.logout()
except Exception as exc:  # noqa: BLE001
    record("IMAP STARTTLS login", "FAIL", repr(exc))
try:
    with imaplib.IMAP4_SSL(HOST, P_IMAPS, ssl_context=tls_ctx(), timeout=20) as imap:
        imap.login(USER, PASSWORD)
        typ, data = imap.select("INBOX", readonly=True)
        record("IMAPS login + SELECT INBOX", "OK" if typ == "OK" else "FAIL",
               f"{data[0].decode()} message(s)")
except Exception as exc:  # noqa: BLE001
    record("IMAPS login", "FAIL", repr(exc))


# --- c) submission -> mailpit with DKIM ------------------------------------------------------------
section(f"c) Submission :{P_SUBM} STARTTLS + AUTH -> relay (mailpit) with DKIM-Signature")
subj_out = f"MGate smoke outbound {RUN}"
mailpit = f"http://127.0.0.1:{P_MAILPIT}"
try:
    with smtplib.SMTP(HOST, P_SUBM, timeout=30) as smtp:
        smtp.ehlo("smoke-client.example.net")
        smtp.starttls(context=tls_ctx())
        smtp.ehlo("smoke-client.example.net")
        smtp.login(USER, PASSWORD)
        record("Submission AUTH", "OK", USER)
        msg = (f"From: Smoke Test <{USER}>\r\nTo: {EXT_RCPT}\r\nSubject: {subj_out}\r\n"
               f"Message-ID: <out-{RUN}@{DOMAIN}>\r\nDate: {email.utils.formatdate()}\r\n\r\n"
               "Outbound smoke-test message (scripts/smoke-test.sh).\r\n")
        refused = smtp.sendmail(USER, [EXT_RCPT], msg)
        record("Submission accepted", "FAIL" if refused else "OK",
               str(refused) if refused else f"250 for {EXT_RCPT}")
except Exception as exc:  # noqa: BLE001
    record("Submission", "FAIL", repr(exc))


def mailpit_find():
    q = urllib.parse.quote(f'subject:"{subj_out}"')
    with urllib.request.urlopen(f"{mailpit}/api/v1/search?query={q}", timeout=5) as r:
        data = json.load(r)
    msgs = data.get("messages") or []
    return msgs[0]["ID"] if msgs else None


try:
    import urllib.parse  # noqa: E402
    urllib.request.urlopen(f"{mailpit}/api/v1/info", timeout=5).read()
    mid = wait_for(mailpit_find)
    if not mid:
        record("relayed to mailpit", "FAIL", f"not in mailpit after {TIMEOUT}s")
    else:
        with urllib.request.urlopen(f"{mailpit}/api/v1/message/{mid}/headers", timeout=5) as r:
            headers = json.load(r)
        record("relayed to mailpit", "OK", f"mailpit message {mid}")
        sig = " ".join(headers.get("Dkim-Signature") or headers.get("DKIM-Signature") or [])
        if sig and f"d={DOMAIN}" in sig and f"s={SELECTOR}" in sig:
            record("DKIM-Signature", "OK", re.sub(r"\s+", " ", sig)[:110] + "...")
        else:
            record("DKIM-Signature", "FAIL", f"missing/unexpected: {sig[:120]!r}")
except (urllib.error.URLError, OSError) as exc:
    record("relayed to mailpit", "SKIP", f"mailpit API {mailpit} unreachable ({exc}); "
           "needs docker-compose.dev.yml")


# --- d) mgate:logs ---------------------------------------------------------------------------------
section("d) Valkey stream mgate:logs (mgate-agent syslog)")
try:
    xlen = valkey(0, "XLEN", "mgate:logs").strip()
    raw = valkey(0, "XREVRANGE", "mgate:logs", "+", "-", "COUNT", "5000").splitlines()
    srcs = {}
    sample = {}
    for i, ln in enumerate(raw[:-1]):
        if ln == "src":
            s = raw[i + 1]
            srcs[s] = srcs.get(s, 0) + 1
        if ln == "msg" and i + 1 < len(raw):
            owner = next((raw[j + 1] for j in range(i, max(i - 14, -1), -1) if raw[j] == "src"),
                         None)
            sample.setdefault(owner, raw[i + 1][:80])
    for src in ("postfix", "dovecot"):
        if srcs.get(src):
            record(f"mgate:logs src={src}", "OK", f"{srcs[src]} entries (XLEN {xlen}); "
                   f"e.g. {sample.get(src, '')!r}")
        else:
            record(f"mgate:logs src={src}", "FAIL", f"no entries (XLEN {xlen}, sources {srcs})")
except Exception as exc:  # noqa: BLE001
    record("mgate:logs", "FAIL", str(exc))


# --- e) HTTPS via traefik --------------------------------------------------------------------------
section(f"e) HTTPS :{P_HTTPS} via Traefik (Host {HOSTNAME})")


def https_get(path):
    conn_ctx = tls_ctx()
    with socket.create_connection((HOST, P_HTTPS), timeout=10) as raw_sock:
        with conn_ctx.wrap_socket(raw_sock, server_hostname=HOSTNAME) as s:
            cert = s.getpeercert(binary_form=True)
            ver = s.version()
            s.sendall(f"GET {path} HTTP/1.1\r\nHost: {HOSTNAME}\r\nConnection: close\r\n"
                      "Accept: */*\r\n\r\n".encode())
            buf = b""
            while True:
                chunk = s.recv(65536)
                if not chunk:
                    break
                buf += chunk
    head, _, body = buf.partition(b"\r\n\r\n")
    status = int(head.split(b" ", 2)[1])
    return status, head.decode(errors="replace"), body, ver, cert


try:
    st, head, body, ver, cert = https_get("/")
    cn = subprocess.run(["openssl", "x509", "-inform", "DER", "-noout", "-subject"],
                        input=cert, capture_output=True).stdout.decode().strip()
    ok = st == 200 and b"<div id=\"root\"" in body or b"<!doctype html" in body.lower()
    record("SPA /", "OK" if st == 200 and ok else "FAIL", f"{st}, {ver}, cert {cn or '?'}")
    for path, label in (("/api/v1/system/health", "api health"),
                        ("/api/v1/mail/health", "webmail health")):
        st, head, body, _, _ = https_get(path)
        txt = body.decode(errors="replace")
        # chunked bodies: strip the chunk-size lines
        good = st == 200 and '"status":"ok"' in txt.replace(" ", "")
        record(label, "OK" if good else "FAIL", f"{st} {txt.strip()[:80]!r}")
except Exception as exc:  # noqa: BLE001
    record("HTTPS", "FAIL", repr(exc))
try:
    with socket.create_connection((HOST, P_HTTP), timeout=10) as s:
        s.sendall(f"GET /admin HTTP/1.1\r\nHost: {HOSTNAME}\r\nConnection: close\r\n\r\n".encode())
        first = s.recv(4096).decode(errors="replace")
    st = int(first.split(" ", 2)[1])
    loc = re.search(r"(?im)^location:\s*(\S+)", first)
    record("HTTP -> HTTPS redirect", "OK" if st in (301, 302, 307, 308) else "FAIL",
           f"{st} {loc.group(1) if loc else ''}")
except Exception as exc:  # noqa: BLE001
    record("HTTP redirect", "FAIL", repr(exc))


# --- f) wrong password -----------------------------------------------------------------------------
section("f) wrong password is rejected")
try:
    imap = imaplib.IMAP4(HOST, P_IMAP, timeout=20)
    imap.starttls(ssl_context=tls_ctx())
    try:
        imap.login(USER, PASSWORD + "-wrong")
        record("IMAP wrong password", "FAIL", "login succeeded")
    except imaplib.IMAP4.error as exc:
        record("IMAP wrong password", "OK", str(exc)[:100])
    try:
        imap.logout()
    except Exception:  # noqa: BLE001
        pass
except Exception as exc:  # noqa: BLE001
    record("IMAP wrong password", "FAIL", repr(exc))
try:
    with smtplib.SMTP(HOST, P_SUBM, timeout=30) as smtp:
        smtp.ehlo("smoke-client.example.net")
        smtp.starttls(context=tls_ctx())
        smtp.ehlo("smoke-client.example.net")
        try:
            smtp.login(USER, PASSWORD + "-wrong")
            record("SMTP AUTH wrong password", "FAIL", "AUTH succeeded")
        except smtplib.SMTPAuthenticationError as exc:
            record("SMTP AUTH wrong password", "OK", f"{exc.smtp_code} "
                   f"{exc.smtp_error.decode(errors='replace')[:80]}")
except Exception as exc:  # noqa: BLE001
    record("SMTP AUTH wrong password", "FAIL", repr(exc))
try:
    with smtplib.SMTP(HOST, P_SMTP, timeout=30) as smtp:
        smtp.ehlo("smoke-client.example.net")
        code, _ = smtp.docmd("MAIL FROM:<probe@example.net>")
        code, resp = smtp.docmd(f"RCPT TO:<nobody-{RUN}@example.org>")
        record("port 25 relay denied", "OK" if code >= 500 else "FAIL",
               f"{code} {resp.decode(errors='replace')[:80]}")
except Exception as exc:  # noqa: BLE001
    record("port 25 relay denied", "FAIL", repr(exc))

print()
oks = sum(1 for _, s, _ in results if s == "OK")
skips = sum(1 for _, s, _ in results if s == "SKIP")
fails = sum(1 for _, s, _ in results if s == "FAIL")
print(f"smoke-test: {oks} ok, {skips} skipped, {fails} failed "
      f"(mailbox {USER} left in place; `docker compose down -v` removes it)")
sys.exit(1 if fails else 0)
PYEOF
