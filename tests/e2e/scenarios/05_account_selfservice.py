"""Account self-service endpoints (profile, quota, 2fa status, app-passwords, vacation, sessions)."""
from __future__ import annotations

import os
import urllib.error

from ._common import ScenarioResult, api_request, skip_if_unreachable


def run() -> ScenarioResult:
    test_domain = os.environ.get("SMOKE_TEST_DOMAIN") or os.environ.get("MGATE_HOSTNAME")
    user_password = os.environ.get("SMOKE_TEST_PASSWORD")
    if not test_domain or not user_password:
        return ScenarioResult(
            "SKIP",
            "SMOKE_TEST_DOMAIN(or MGATE_HOSTNAME)/SMOKE_TEST_PASSWORD not set — run scenario 02 first",
        )
    user_email = os.environ.get("SMOKE_TEST_MAILBOX") or f"smoketest@{test_domain}"

    try:
        status, body = api_request(
            "POST", "/api/v1/auth/login", {"email": user_email, "password": user_password}
        )
    except (urllib.error.URLError, OSError) as exc:
        return skip_if_unreachable(exc, "api /api/v1/auth/login", "the api component to be running")

    if status != 200 or not body or "token" not in body:
        return ScenarioResult("FAIL", f"login failed: {status} {body!r}")
    token = body["token"]

    # 1. Profile
    status, profile = api_request("GET", "/api/v1/account", token=token)
    if status != 200 or not profile:
        return ScenarioResult("FAIL", f"GET /api/v1/account failed: {status}")

    # 2. Quota
    status, quota = api_request("GET", "/api/v1/account/quota", token=token)
    if status != 200 or not quota:
        return ScenarioResult("FAIL", f"GET /api/v1/account/quota failed: {status}")

    # 3. 2FA status
    status, tfa = api_request("GET", "/api/v1/account/2fa", token=token)
    if status != 200:
        return ScenarioResult("FAIL", f"GET /api/v1/account/2fa failed: {status}")

    # 4. App passwords
    status, app_pws = api_request("GET", "/api/v1/account/app-passwords", token=token)
    if status != 200:
        return ScenarioResult("FAIL", f"GET /api/v1/account/app-passwords failed: {status}")

    # 5. Vacation responder
    status, vacation = api_request("GET", "/api/v1/account/vacation", token=token)
    if status != 200:
        return ScenarioResult("FAIL", f"GET /api/v1/account/vacation failed: {status}")

    # 6. Sessions
    status, sessions = api_request("GET", "/api/v1/account/sessions", token=token)
    if status != 200:
        return ScenarioResult("FAIL", f"GET /api/v1/account/sessions failed: {status}")

    return ScenarioResult("OK", "profile, quota, 2fa, app-passwords, vacation and sessions verified")
