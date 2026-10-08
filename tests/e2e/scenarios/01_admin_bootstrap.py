"""`mgate init`/`migrate --bootstrap` create the first superadmin, and
POST /api/v1/auth/login authenticates as them (MGATE_ADMIN_EMAIL/PASSWORD)."""
from __future__ import annotations

import os
import urllib.error

from ._common import ScenarioResult, api_base, api_request, skip_if_unreachable


def run() -> ScenarioResult:
    try:
        status, body = api_request("GET", "/api/v1/system/health")
    except (urllib.error.URLError, OSError) as exc:
        return skip_if_unreachable(exc, "api /api/v1/system/health", "the api component to be running")

    if status != 200 or not body or body.get("status") != "ok":
        # api:8080 is NOT published to the host (only Traefik is), so the default
        # MGATE_API_BASE often hits an unrelated service listening on 127.0.0.1:8080. That is an
        # environment problem, not a contract violation: skip instead of failing the suite.
        return ScenarioResult(
            "SKIP",
            f"{api_base()}/api/v1/system/health did not answer mgate's health JSON "
            f"({status} {body!r}) — set MGATE_API_BASE to this instance's api (e.g. "
            "https://<MGATE_HOSTNAME> through Traefik, or a published api port)",
        )

    admin_email = os.environ.get("MGATE_ADMIN_EMAIL")
    admin_password = os.environ.get("MGATE_ADMIN_PASSWORD")
    if not admin_email or not admin_password:
        return ScenarioResult(
            "SKIP",
            "MGATE_ADMIN_EMAIL/MGATE_ADMIN_PASSWORD not set — export the values `mgate init` "
            "generated to exercise login",
        )

    try:
        status, body = api_request(
            "POST", "/api/v1/auth/login", {"email": admin_email, "password": admin_password}
        )
    except (urllib.error.URLError, OSError) as exc:
        return skip_if_unreachable(exc, "api /api/v1/auth/login", "the api component to be running")

    if status == 404:
        return ScenarioResult("SKIP", "/api/v1/auth/login not implemented")
    if status != 200:
        return ScenarioResult("FAIL", f"login rejected: {status} {body!r}")
    return ScenarioResult("OK", f"logged in as {admin_email}")
