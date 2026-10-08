"""Shared helpers for tests/e2e/scenarios/*.py (stdlib only)."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
# Re-exported so scenario modules only need `from ._common import ScenarioResult`.
from scenario_result import ScenarioResult  # noqa: E402


def api_base() -> str:
    base = os.environ.get("MGATE_API_BASE")
    if base:
        return base
    listen = os.environ.get("MGATE_LISTEN_API")
    if listen:
        return f"http://{listen}" if "://" not in listen else listen
    return "http://127.0.0.1:8080"


def api_request(method: str, path: str, body: dict | None = None, token: str | None = None,
                 timeout: float = 10.0) -> tuple[int, dict | None]:
    """Minimal JSON HTTP client (stdlib urllib) — returns (status_code, parsed_json_or_None).
    Never raises for HTTP-level errors (4xx/5xx); only for connection failures (caller decides
    whether "connection refused" means SKIP because the api isn't up yet)."""
    url = f"{api_base()}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return exc.code, None


def skip_if_unreachable(exc: Exception, what: str, requirement: str) -> ScenarioResult:
    return ScenarioResult("SKIP", f"{what} not reachable ({exc}) — needs {requirement}")
