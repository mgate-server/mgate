#!/usr/bin/env python3
"""Deliverability check preparation step (see README.md — the final 10/10 score itself is read
by a human from the mail-tester.com report link; this only automates sending the probe message
and reminds the operator of the checklist items that determine that score).

Usage: python3 tests/deliverability/run_check.py --to xxxxx@mail-tester.com
"""
from __future__ import annotations

import argparse
import os
import smtplib
import socket
import ssl
import sys

CHECKLIST = [
    "SPF TXT record published and resolvable",
    "DKIM signature present, >=2048-bit key, selector matches DNS TXT",
    "DMARC TXT record present with a documented policy",
    "Forward/reverse DNS (A + PTR) match MGATE_HOSTNAME (operator/hosting responsibility)",
    "Postfix HELO/EHLO name matches PTR/A (Postfix myhostname)",
    "Server IP not listed on major DNSBLs (Rspamd RBL module; IP reputation is "
    "outside MGate's control)",
    "Outgoing message has a sane Content-Type/charset and a plain-text part",
    "TLS available on the sending path (submission STARTTLS)",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--to", required=True, help="the one-time mail-tester.com address")
    parser.add_argument("--host", default=os.environ.get("SMOKE_HOST", "127.0.0.1"))
    # Default follows the compose host port (rootless Docker cannot bind <1024).
    parser.add_argument("--port", type=int, default=int(os.environ.get("MGATE_SUBMISSION_PORT") or 587))
    parser.add_argument("--domain", default=os.environ.get("SMOKE_TEST_DOMAIN", "mail.example.com"))
    parser.add_argument("--user", default=os.environ.get("SMOKE_TEST_USER", ""))
    parser.add_argument("--password", default=os.environ.get("SMOKE_TEST_PASSWORD", ""))
    args = parser.parse_args()

    if not args.user or not args.password:
        print(
            "SMOKE_TEST_USER/SMOKE_TEST_PASSWORD (or --user/--password) not set — cannot "
            "authenticate on submission (587). Create a mailbox first (admin API/CLI)."
        )
        return 1

    sender = args.user
    body = (
        f"From: {sender}\r\nTo: {args.to}\r\nSubject: MGate deliverability probe\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n\r\n"
        "This message was sent by tests/deliverability/run_check.py to prepare a mail-tester.com "
        "score check. See tests/deliverability/README.md for the full checklist.\r\n"
    )

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # self-signed bootstrap cert until ACME issues a real one
    try:
        with smtplib.SMTP(args.host, args.port, timeout=10) as smtp:
            smtp.ehlo("mgate-deliverability-check")
            smtp.starttls(context=ctx)
            smtp.ehlo("mgate-deliverability-check")
            smtp.login(args.user, args.password)
            smtp.sendmail(sender, [args.to], body)
    except smtplib.SMTPException as exc:
        print(f"error: SMTP submission failed: {exc}", file=sys.stderr)
        return 1
    except (ConnectionRefusedError, socket.timeout, OSError) as exc:
        print(
            f"error: could not reach {args.host}:{args.port} ({exc}) — is postfix up?",
            file=sys.stderr,
        )
        return 1

    print(f"Sent probe message to {args.to}.")
    print(f"Now open https://www.mail-tester.com/{args.to.split('@')[0]} and record the score.")
    print()
    print("Checklist this score depends on:")
    for item in CHECKLIST:
        print(f"  - {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
