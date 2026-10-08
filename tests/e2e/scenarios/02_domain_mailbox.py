"""Admin API can create a domain + mailbox. Requires scenario 01 to have produced a valid session — this scenario
re-authenticates independently so it can also run alone via `--only 02_domain_mailbox`."""
from __future__ import annotations

import os
import secrets
import urllib.error

from ._common import ScenarioResult, api_request, skip_if_unreachable


def run() -> ScenarioResult:
    admin_email = os.environ.get("MGATE_ADMIN_EMAIL")
    admin_password = os.environ.get("MGATE_ADMIN_PASSWORD")
    test_domain = os.environ.get("SMOKE_TEST_DOMAIN") or os.environ.get("MGATE_HOSTNAME")
    if not admin_email or not admin_password or not test_domain:
        return ScenarioResult(
            "SKIP",
            "MGATE_ADMIN_EMAIL/MGATE_ADMIN_PASSWORD/SMOKE_TEST_DOMAIN(or MGATE_HOSTNAME) not set",
        )

    try:
        status, body = api_request(
            "POST", "/api/v1/auth/login", {"email": admin_email, "password": admin_password}
        )
    except (urllib.error.URLError, OSError) as exc:
        return skip_if_unreachable(exc, "api /api/v1/auth/login", "the api component to be running")
    if status == 404:
        return ScenarioResult("SKIP", "/api/v1/auth/login not implemented")
    if status != 200 or not body or "token" not in body:
        return ScenarioResult("FAIL", f"login failed: {status} {body!r}")
    token = body["token"]

    status, body = api_request(
        "POST", "/api/v1/admin/domains", {"domain": test_domain}, token=token
    )
    if status == 404:
        return ScenarioResult("SKIP", "/api/v1/admin/domains not implemented")
    if status not in (200, 201, 409):  # 409 = already created by a previous run, acceptable
        return ScenarioResult("FAIL", f"domain creation failed: {status} {body!r}")

    mailbox_local = "smoketest"
    password = os.environ.get("SMOKE_TEST_PASSWORD") or "E2E-" + secrets.token_urlsafe(12)
    status, body = api_request(
        "POST",
        f"/api/v1/admin/domains/{test_domain}/mailboxes",
        {"local_part": mailbox_local, "password": password},
        token=token,
    )
    if status == 404:
        return ScenarioResult("SKIP", "mailbox creation endpoint not implemented")
    if status == 409:
        # Sync password on existing mailbox
        s, mbs = api_request("GET", "/api/v1/admin/mailboxes", token=token)
        if s == 200 and mbs and "items" in mbs:
            for item in mbs["items"]:
                if item.get("address") == f"{mailbox_local}@{test_domain}":
                    api_request("PUT", f"/api/v1/admin/mailboxes/{item['id']}/password", {"password": password}, token=token)
                    break
    elif status not in (200, 201):
        return ScenarioResult("FAIL", f"mailbox creation failed: {status} {body!r}")

    return ScenarioResult("OK", f"domain {test_domain} + mailbox {mailbox_local}@{test_domain} ready")
