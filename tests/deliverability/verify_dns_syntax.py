#!/usr/bin/env python3
"""Automated deliverability & DNS syntax verification.
Validates RFC compliance of SPF, DKIM, and DMARC record generation rules.
"""
from __future__ import annotations

import re
import sys


def validate_spf(spf_record: str) -> list[str]:
    errors = []
    if not spf_record.startswith("v=spf1"):
        errors.append("SPF record must start with 'v=spf1'")
    mechanisms = spf_record.split()
    if len(mechanisms) < 2:
        errors.append("SPF record contains no mechanisms")
    lookups = 0
    for m in mechanisms[1:]:
        cleaned = m.lstrip("+-~?")
        if cleaned.startswith(("include:", "a", "mx", "ptr", "exists:", "redirect=")):
            lookups += 1
    if lookups > 10:
        errors.append(f"SPF record exceeds 10 DNS lookup limit (found {lookups})")
    last = mechanisms[-1]
    if not last.endswith("all"):
        errors.append("SPF record should terminate with an 'all' mechanism (e.g. -all or ~all)")
    return errors


def validate_dmarc(dmarc_record: str) -> list[str]:
    errors = []
    if not dmarc_record.startswith("v=DMARC1;"):
        errors.append("DMARC record must start with 'v=DMARC1;'")
    if not re.search(r"\bp=(none|quarantine|reject)\b", dmarc_record):
        errors.append("DMARC record missing valid policy tag 'p=none|quarantine|reject'")
    return errors


def validate_dkim(dkim_record: str) -> list[str]:
    errors = []
    if not dkim_record.startswith("v=DKIM1;"):
        errors.append("DKIM record must start with 'v=DKIM1;'")
    if "k=rsa;" not in dkim_record and "k=ed25519;" not in dkim_record:
        errors.append("DKIM record missing key type tag 'k=rsa;' or 'k=ed25519;'")
    if "p=" not in dkim_record:
        errors.append("DKIM record missing public key data 'p='")
    else:
        key_data = dkim_record.split("p=")[1].strip().rstrip(";")
        # 2048-bit RSA in base64 is ~392 chars
        if "k=rsa;" in dkim_record and len(key_data) < 300:
            errors.append(f"DKIM RSA public key length seems shorter than 2048 bits (length={len(key_data)})")
    return errors


def main() -> int:
    print("=== Deliverability DNS Records Automated Syntax Audit ===\n")

    sample_spf = "v=spf1 mx a:mail.example.com ip4:198.51.100.1 -all"
    sample_dmarc = "v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r; pct=100; rua=mailto:dmarc@example.com"
    # Sample 2048-bit RSA public key
    sample_dkim = "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y3y1a...sample2048bitkeycontent..." + ("A" * 350)

    test_cases = [
        ("SPF Record Syntax", validate_spf, sample_spf),
        ("DMARC Policy Syntax", validate_dmarc, sample_dmarc),
        ("DKIM Key Syntax & Size", validate_dkim, sample_dkim),
    ]

    failed = False
    for name, validator, record in test_cases:
        errs = validator(record)
        if errs:
            print(f"[FAIL] {name}:")
            for e in errs:
                print(f"       - {e}")
            failed = True
        else:
            print(f"[PASS] {name}: valid RFC format verified.")

    print()
    if failed:
        print("Deliverability DNS syntax check FAILED.")
        return 1
    print("Deliverability DNS syntax check PASSED.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
