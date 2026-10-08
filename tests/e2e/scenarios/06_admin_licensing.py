"""Admin dashboard, licensing status and resource management endpoints."""
from __future__ import annotations

import os
import urllib.error

from ._common import ScenarioResult, api_request, skip_if_unreachable


def run() -> ScenarioResult:
    admin_email = os.environ.get("MGATE_ADMIN_EMAIL")
    admin_password = os.environ.get("MGATE_ADMIN_PASSWORD")
    if not admin_email or not admin_password:
        return ScenarioResult(
            "SKIP",
            "MGATE_ADMIN_EMAIL/MGATE_ADMIN_PASSWORD not set",
        )

    try:
        status, body = api_request(
            "POST", "/api/v1/auth/login", {"email": admin_email, "password": admin_password}
        )
    except (urllib.error.URLError, OSError) as exc:
        return skip_if_unreachable(exc, "api /api/v1/auth/login", "the api component to be running")

    if status != 200 or not body or "token" not in body:
        return ScenarioResult("FAIL", f"login failed: {status} {body!r}")
    token = body["token"]

    # 1. Admin dashboard
    status, dashboard = api_request("GET", "/api/v1/admin/dashboard", token=token)
    if status != 200 or not isinstance(dashboard, dict):
        return ScenarioResult("FAIL", f"GET /api/v1/admin/dashboard failed: {status}")

    # 2. License info
    status, license_info = api_request("GET", "/api/v1/admin/license", token=token)
    if status != 200:
        return ScenarioResult("FAIL", f"GET /api/v1/admin/license failed: {status}")

    # 3. Domains list
    status, domains = api_request("GET", "/api/v1/admin/domains", token=token)
    if status != 200:
        return ScenarioResult("FAIL", f"GET /api/v1/admin/domains failed: {status}")

    # 4. Mailboxes list
    status, mailboxes = api_request("GET", "/api/v1/admin/mailboxes", token=token)
    if status != 200:
        return ScenarioResult("FAIL", f"GET /api/v1/admin/mailboxes failed: {status}")

    # 5. Statistics
    status, stats = api_request("GET", "/api/v1/admin/stats", token=token)
    if status == 404:
        status, stats = api_request("GET", "/api/v1/admin/statistics", token=token)
    if status != 200:
        return ScenarioResult("FAIL", f"GET /api/v1/admin/stats failed: {status}")

    edition = dashboard.get("license_edition", "community")
    return ScenarioResult(
        "OK",
        f"admin dashboard (edition={edition}), license, domains, mailboxes, and stats verified",
    )
