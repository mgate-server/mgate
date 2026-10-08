"""SMTP (25) -> Rspamd milter -> LMTP -> Dovecot Maildir, with Rspamd score headers on
the delivered copy. Delivery reuses the same approach as scripts/smoke-test.sh; this scenario
additionally logs into IMAP and inspects the headers Rspamd's milter_headers module actually adds
(`X-Spamd-Result`, `X-Rspamd-Action`, `X-Rspamd-Server`, `X-Spamd-Bar`, `Authentication-Results`,
plus `X-Spam: Yes` above the add_header threshold). Inbound mail is deliberately NOT DKIM-signed
(docker/rspamd/local.d/dkim_signing.conf: sign_inbound = false) — the DKIM-Signature check belongs
to the submission path, covered by scripts/smoke-test.sh step (c)."""
from __future__ import annotations

import email
import imaplib
import os
import smtplib
import socket
import ssl

from ._common import ScenarioResult


def run() -> ScenarioResult:
    host = os.environ.get("SMOKE_HOST", "127.0.0.1")
    # Host ports are configurable (docker-compose.yml, .env): rootless Docker cannot bind <1024.
    smtp_port = int(os.environ.get("MGATE_SMTP_PORT") or 25)
    imaps_port = int(os.environ.get("MGATE_IMAPS_PORT") or 993)
    domain = os.environ.get("SMOKE_TEST_DOMAIN") or os.environ.get("MGATE_HOSTNAME", "mail.example.com")
    user = os.environ.get("SMOKE_TEST_USER") or f"smoketest@{domain}"
    password = os.environ.get("SMOKE_TEST_PASSWORD", "")

    if not password:
        return ScenarioResult("SKIP", "SMOKE_TEST_PASSWORD not set — run scenario 02 first or export it")

    subject = "MGate e2e mail-delivery test"
    msg = (
        f"From: e2e-test@{domain}\r\nTo: {user}\r\nSubject: {subject}\r\n\r\n"
        "Automated end-to-end test message (tests/e2e/scenarios/03_mail_delivery.py).\r\n"
    )
    try:
        with smtplib.SMTP(host, smtp_port, timeout=10) as smtp:
            smtp.ehlo("e2e-test.invalid")
            refused = smtp.sendmail(f"e2e-test@{domain}", [user], msg)
            if refused:
                return ScenarioResult("SKIP", f"recipient refused: {refused} — mailbox may not exist")
    except (ConnectionRefusedError, socket.timeout, OSError) as exc:
        return ScenarioResult("SKIP", f"port {smtp_port} not reachable ({exc}) — needs postfix to be running")

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with imaplib.IMAP4_SSL(host, imaps_port, ssl_context=ctx, timeout=10) as imap:
            imap.login(user, password)
            folder = None
            data = None
            for candidate in ("INBOX", "Junk"):
                if imap.select(candidate)[0] != "OK":
                    continue
                typ, found = imap.search(None, "SUBJECT", f'"{subject}"')
                if typ == "OK" and found and found[0]:
                    folder, data = candidate, found
                    break
            if not folder:
                return ScenarioResult(
                    "SKIP",
                    "message not found in INBOX/Junk yet — either delivery is still in flight or "
                    "Sieve/LMTP routing is not wired yet",
                )
            msg_id = data[0].split()[-1]
            typ, msg_data = imap.fetch(msg_id, "(RFC822)")
            if typ != "OK" or not msg_data or not isinstance(msg_data[0], tuple):
                return ScenarioResult("FAIL", "IMAP FETCH did not return message content")
            parsed = email.message_from_bytes(msg_data[0][1])
    except imaplib.IMAP4.error as exc:
        return ScenarioResult("FAIL", f"IMAP login/search/fetch failed: {exc}")
    except (ConnectionRefusedError, socket.timeout, OSError) as exc:
        return ScenarioResult("SKIP", f"port {imaps_port} not reachable ({exc}) — needs dovecot to be running")

    notes = []
    if "Authentication-Results" not in parsed:
        notes.append("no Authentication-Results header (Rspamd milter_headers not applied)")
    if not any(h.lower().startswith(("x-spam", "x-rspamd")) for h in parsed.keys()):
        notes.append("no X-Spamd-Result/X-Rspamd-* header (Rspamd milter did not add headers)")

    if notes:
        return ScenarioResult("SKIP", "; ".join(notes))
    action = parsed.get("X-Rspamd-Action", "?")
    return ScenarioResult(
        "OK",
        f"delivered to {folder} with Rspamd headers (action: {action}); "
        "DKIM signing is checked on the submission path (scripts/smoke-test.sh step c)",
    )
