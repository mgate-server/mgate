"""Pro module end-to-end enforcement verification."""
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

    # 1. Check current system entitlements
    status, ent = api_request("GET", "/api/v1/system/entitlements", token=token)
    if status != 200 or not isinstance(ent, dict):
        status, ent = api_request("GET", "/api/v1/admin/license", token=token)
        is_pro = isinstance(ent, dict) and ent.get("edition") == "pro"
    else:
        is_pro = ent.get("edition") == "pro"

    # 2. Test Pro route gating (/api/v1/pro/dns-autopilot)
    status, resp = api_request("GET", "/api/v1/pro/dns-autopilot", token=token)

    if not is_pro:
        # Community edition MUST refuse with 403 pro_required
        if status != 403:
            return ScenarioResult(
                "FAIL",
                f"expected 403 pro_required in Community edition, got {status}: {resp!r}",
            )
        err_code = (
            resp.get("error", {}).get("code")
            if isinstance(resp, dict) and isinstance(resp.get("error"), dict)
            else (resp.get("error") if isinstance(resp, dict) else None)
        )
        if err_code != "pro_required":
            return ScenarioResult(
                "FAIL",
                f"expected error code 'pro_required', got {err_code!r} ({resp!r})",
            )
        return ScenarioResult(
            "OK",
            "Pro endpoint correctly rejected with 403 pro_required under Community edition",
        )

    # If Pro edition is active, verify Pro route responds (501 not implemented for backlog)
    if status != 501:
        return ScenarioResult(
            "FAIL",
            f"expected 501 Not Implemented under Pro edition, got {status}: {resp!r}",
        )

    return ScenarioResult(
        "OK",
        "verified Pro route access gating and entitlement enforcement",
    )
