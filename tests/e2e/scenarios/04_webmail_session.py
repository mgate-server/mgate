"""Webmail session against the real gateway (`/api/v1/mail/*`, webmail:8082).

Logs in as a mailbox user through the public API (Bearer session), then exercises the gateway
end to end: anonymous requests are refused, the folder list has the special folders, a message
sent to oneself is delivered and readable, it can be deleted (to Trash, then permanently),
settings round-trip, and a contact can be created and removed. The session is closed at the end
and must no longer work.

Requires a mailbox and its password: SMOKE_TEST_USER (full address; falls back to
SMOKE_TEST_MAILBOX or smoketest@SMOKE_TEST_DOMAIN) and SMOKE_TEST_PASSWORD. SKIPs when they are
not set or the gateway is not reachable. Endpoints: MGATE_API_BASE (default
http://127.0.0.1:8080) and MGATE_WEBMAIL_BASE (default http://127.0.0.1:8082); SMOKE_TIMEOUT
bounds the wait for delivery (default 60 s).
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from ._common import ScenarioResult, api_request, skip_if_unreachable

SPECIAL_FOLDERS = ("inbox", "sent", "drafts", "trash")


def webmail_base() -> str:
    return os.environ.get("MGATE_WEBMAIL_BASE", "http://127.0.0.1:8082").rstrip("/")


def mail(method: str, path: str, token: str | None = None, body: dict | None = None,
         timeout: float = 60.0) -> tuple[int, object]:
    """`/api/v1/mail{path}` with optional Bearer session; returns (status, parsed JSON or None).
    Raises only for transport errors."""
    url = f"{webmail_base()}/api/v1/mail{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        status = exc.code
    try:
        return status, (json.loads(raw) if raw else None)
    except json.JSONDecodeError:
        return status, None


def error_code(body: object) -> str:
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        return str(body["error"].get("code", ""))
    return ""


def find_message(token: str, folder: str, subject: str) -> dict | None:
    query = urllib.parse.urlencode({"folder": folder, "per_page": 100})
    status, body = mail("GET", f"/messages?{query}", token)
    if status != 200 or not isinstance(body, dict):
        return None
    for message in body.get("messages", []):
        if isinstance(message, dict) and message.get("subject") == subject:
            return message
    return None


def wait_message(token: str, folder: str, subject: str, timeout: float) -> dict | None:
    deadline = time.monotonic() + timeout
    while True:
        found = find_message(token, folder, subject)
        if found or time.monotonic() > deadline:
            return found
        time.sleep(1.0)


def delete_everywhere(token: str, folder: str, subject: str) -> str | None:
    """Deletes a message from `folder` (it moves to Trash) and then from Trash (permanently).
    Returns an error description or None."""
    message = find_message(token, folder, subject)
    if message is None:
        return f"message not found in {folder}"
    status, body = mail("DELETE", f"/messages/{message['id']}", token)
    if status != 204:
        return f"DELETE in {folder}: HTTP {status} {error_code(body)}"
    trashed = find_message(token, "trash", subject)
    if trashed is None:
        return "deleted message did not reach Trash"
    status, body = mail("DELETE", f"/messages/{trashed['id']}", token)
    if status != 204:
        return f"DELETE in Trash: HTTP {status} {error_code(body)}"
    if find_message(token, "trash", subject) is not None:
        return "message still in Trash after the permanent delete"
    return None


def run() -> ScenarioResult:
    domain = os.environ.get("SMOKE_TEST_DOMAIN")
    user = (os.environ.get("SMOKE_TEST_USER") or os.environ.get("SMOKE_TEST_MAILBOX")
            or (f"smoketest@{domain}" if domain else ""))
    password = os.environ.get("SMOKE_TEST_PASSWORD", "")
    if not user or not password:
        return ScenarioResult(
            "SKIP", "SMOKE_TEST_USER (or SMOKE_TEST_DOMAIN) / SMOKE_TEST_PASSWORD not set — "
                    "needs an existing mailbox and its password")
    timeout = float(os.environ.get("SMOKE_TIMEOUT") or 60)

    # 1. Gateway up; anonymous requests are refused.
    try:
        status, body = mail("GET", "/health")
    except (urllib.error.URLError, OSError) as exc:
        return skip_if_unreachable(exc, webmail_base(), "the webmail component to be running")
    if status != 200 or not isinstance(body, dict) or body.get("status") != "ok":
        return ScenarioResult("FAIL", f"webmail health: HTTP {status} {body!r}")
    status, body = mail("GET", "/folders")
    if status != 401 or error_code(body) != "unauthorized":
        return ScenarioResult("FAIL", f"anonymous GET /folders: expected 401, got HTTP {status}")

    # 2. Log in as the mailbox user.
    try:
        status, body = api_request("POST", "/api/v1/auth/login",
                                   {"email": user, "password": password})
    except (urllib.error.URLError, OSError) as exc:
        return skip_if_unreachable(exc, "api /api/v1/auth/login", "the api component to be running")
    if status != 200 or not isinstance(body, dict) or not body.get("token"):
        return ScenarioResult("FAIL", f"login as {user} failed: HTTP {status}")
    token = body["token"]

    # 3. Folders.
    status, folders = mail("GET", "/folders", token)
    if status == 403 and error_code(folders) == "webmail_requires_mailbox":
        return ScenarioResult("FAIL", f"{user} is not a mailbox (admin accounts have no webmail)")
    if status != 200 or not isinstance(folders, list):
        return ScenarioResult("FAIL", f"GET /folders: HTTP {status} {error_code(folders)}")
    roles = {f.get("role") for f in folders if isinstance(f, dict)}
    missing = [r for r in SPECIAL_FOLDERS if r not in roles]
    if missing:
        return ScenarioResult("FAIL", f"special folders missing: {missing} (have {sorted(roles)})")

    # 4. Send to self, wait for delivery, read.
    marker = uuid.uuid4().hex[:12]
    subject = f"MGate e2e webmail {marker}"
    status, sent = mail("POST", "/send", token, {
        "to": [user],
        "subject": subject,
        "text": f"Sent through the webmail gateway by tests/e2e ({marker}).\n",
        "html": f"<p>Sent through the webmail gateway by <b>tests/e2e</b> ({marker}).</p>",
    }, timeout=150)
    if status != 200 or not isinstance(sent, dict) or sent.get("status") != "sent":
        return ScenarioResult("FAIL", f"POST /send: HTTP {status} {error_code(sent)}")
    if sent.get("saved_to_sent") is not True:
        return ScenarioResult("FAIL", "the sent message was not stored in Sent")
    message = wait_message(token, "inbox", subject, timeout)
    if message is None:
        return ScenarioResult("FAIL", f"message to self not delivered to INBOX within {timeout:.0f}s")
    status, detail = mail("GET", f"/messages/{message['id']}", token)
    if status != 200 or not isinstance(detail, dict):
        return ScenarioResult("FAIL", f"GET /messages/{{id}}: HTTP {status} {error_code(detail)}")
    if detail.get("subject") != subject or marker not in (detail.get("text") or ""):
        return ScenarioResult("FAIL", "delivered message does not match what was sent")
    if user.lower() not in str(detail.get("from", "")).lower():
        return ScenarioResult("FAIL", f"unexpected sender: {detail.get('from')!r}")
    reread = find_message(token, "inbox", subject)
    if not reread or reread.get("read") is not True:
        return ScenarioResult("FAIL", "opened message is not marked as read")

    # 5. Delete (Trash, then permanently), the Sent copy too.
    for folder in ("inbox", "sent"):
        problem = delete_everywhere(token, folder, subject)
        if problem:
            return ScenarioResult("FAIL", f"delete ({folder}): {problem}")

    # 6. Settings round trip (restoring the previous values).
    status, original = mail("GET", "/settings", token)
    if status != 200 or not isinstance(original, dict):
        return ScenarioResult("FAIL", f"GET /settings: HTTP {status}")
    wanted = {"remote_images": "ask", "list_density": "comfortable", "mark_read_on_open": True}
    status, _ = mail("PUT", "/settings", token, wanted)
    if status != 200:
        return ScenarioResult("FAIL", f"PUT /settings: HTTP {status}")
    status, current = mail("GET", "/settings", token)
    if status != 200 or not isinstance(current, dict) or any(
            current.get(k) != v for k, v in wanted.items()):
        return ScenarioResult("FAIL", f"settings did not round-trip: {current!r}")
    restore = {k: original[k] for k in ("remote_images", "list_density", "mark_read_on_open")
               if original.get(k) is not None}
    if {"remote_images", "list_density"} <= restore.keys():
        mail("PUT", "/settings", token, restore)

    # 7. Contacts: create, list, delete.
    contact_email = f"e2e-{marker}@example.org"
    status, contact = mail("POST", "/contacts", token,
                           {"name": "E2E Test Contact", "email": contact_email})
    if status != 201 or not isinstance(contact, dict) or not contact.get("id"):
        return ScenarioResult("FAIL", f"POST /contacts: HTTP {status} {error_code(contact)}")
    status, contacts = mail("GET", "/contacts", token)
    if status != 200 or not any(isinstance(c, dict) and c.get("email") == contact_email
                                for c in (contacts or [])):
        return ScenarioResult("FAIL", "created contact is not listed")
    status, _ = mail("DELETE", f"/contacts/{contact['id']}", token)
    if status != 204:
        return ScenarioResult("FAIL", f"DELETE /contacts/{{id}}: HTTP {status}")

    # 8. Log out: the session must stop working at the gateway too.
    status, _ = api_request("POST", "/api/v1/auth/logout", token=token)
    if status != 204:
        return ScenarioResult("FAIL", f"logout: HTTP {status}")
    status, _ = mail("GET", "/folders", token)
    if status != 401:
        return ScenarioResult("FAIL", f"GET /folders after logout: expected 401, got HTTP {status}")

    return ScenarioResult(
        "OK", f"anonymous 401, {len(folders)} folders, send/receive/read/delete, settings, "
              "contacts and logout verified")
