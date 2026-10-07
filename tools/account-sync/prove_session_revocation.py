#!/usr/bin/env python3
"""Prove OrdaX current-session revocation without persisting credentials or tokens.

Two independent sessions sign in to the same account. Session A signs out with
local scope through the deployed OrdaX gateway. The proof then verifies that:
- A is anonymous after logout;
- A's captured refresh token can no longer restore a session;
- B remains authenticated, proving logout is per-session rather than global.

Credentials are accepted only through environment variables. Tokens stay in
memory and are never printed.
"""

from __future__ import annotations

import http.cookiejar
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_GATEWAY_FILE = os.path.join(ROOT, "system", "services", "account", "gateway-base-url")
ACCESS_COOKIE = "ordax_access"
REFRESH_COOKIE = "ordax_refresh"


def fail(reason: str) -> "NoReturn":
    raise SystemExit(f"ACCOUNT_SESSION_REVOCATION_PROOF=FAIL reason={reason}")


class Client:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.jar))

    def request(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        content_type: str | None = None,
        cookie_header: str | None = None,
    ):
        headers = {
            "Accept": "application/json",
            "User-Agent": "OrdaX-Session-Revocation-Proof/1",
        }
        if content_type:
            headers["Content-Type"] = content_type
        if cookie_header:
            headers["Cookie"] = cookie_header
        req = Request(self.base_url + path, data=body, headers=headers, method=method)
        opener = build_opener() if cookie_header else self.opener
        try:
            with opener.open(req, timeout=20) as response:
                raw = response.read(1024 * 1024)
                status = response.status
        except HTTPError as exc:
            raw = exc.read(1024 * 1024)
            status = exc.code
        except (URLError, OSError, TimeoutError) as exc:
            fail(f"gateway-unreachable:{type(exc).__name__}")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            fail(f"invalid-json:{status}")
        return status, payload

    def login(self, email: str, password: str) -> None:
        body = urlencode({"email": email, "password": password}).encode("utf-8")
        status, payload = self.request(
            "POST",
            "/auth/login",
            body=body,
            content_type="application/x-www-form-urlencoded",
        )
        if status != 200 or payload.get("authenticated") is not True:
            fail(f"login:{status}")

    def session(self):
        status, payload = self.request("GET", "/auth/session")
        if status != 200:
            fail(f"session:{status}")
        return payload

    def cookie_value(self, name: str) -> str:
        for item in self.jar:
            if item.name == name:
                return item.value
        fail(f"cookie-missing:{name}")

    def logout(self) -> None:
        status, payload = self.request(
            "POST",
            "/auth/logout",
            body=b"",
            content_type="application/json",
        )
        if status != 200 or payload.get("signedOut") is not True:
            fail(f"logout:{status}")

    def session_with_refresh_token(self, refresh_token: str):
        return self.request(
            "GET",
            "/auth/session",
            cookie_header=f"{REFRESH_COOKIE}={refresh_token}",
        )


def canonical_public_origin(value: str) -> str:
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        fail("invalid-gateway-origin")
    return f"https://{parsed.netloc}"


def gateway_url() -> str:
    override = os.environ.get("ORDAX_ACCOUNT_GATEWAY_BASE_URL", "").strip()
    if override:
        return canonical_public_origin(override)
    try:
        with open(DEFAULT_GATEWAY_FILE, "r", encoding="utf-8") as handle:
            value = handle.read().strip()
    except OSError:
        fail("gateway-config-missing")
    # The default Native gateway is intentionally not acceptable for a public
    # release proof. A release proof must name the public same-origin boundary.
    parsed = urlsplit(value)
    if parsed.path not in ("", "/"):
        fail("public-gateway-origin-required")
    return canonical_public_origin(value)


def write_receipt(path: str, base_url: str) -> None:
    if not path:
        return
    parsed = urlsplit(base_url)
    source_commit = os.environ.get("GITHUB_SHA", "").strip()
    if len(source_commit) != 40:
        source_commit = None
    else:
        try:
            int(source_commit, 16)
        except ValueError:
            source_commit = None

    payload = {
        "$schema": "prototype-ordax.account-session-revocation-proof/1",
        "status": "pass",
        "scope": "local",
        "gateway_origin": f"{parsed.scheme}://{parsed.netloc}",
        "source_commit": source_commit,
        "workflow_run_id": os.environ.get("GITHUB_RUN_ID") or None,
        "two_independent_sessions": True,
        "session_a_anonymous_after_logout": True,
        "revoked_session_restore_rejected": True,
        "session_b_remained_authenticated": True,
        "credentials_persisted": False,
        "account_identifier_recorded": False,
        "sensitive_auth_material_recorded": False,
    }
    output = Path(path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(f".{output.name}.tmp-{os.getpid()}")
    temp.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    os.replace(temp, output)


def main() -> int:
    email = os.environ.get("ORDAX_PROOF_ACCOUNT_EMAIL", "").strip()
    password = os.environ.get("ORDAX_PROOF_ACCOUNT_PASSWORD", "")
    if not email or not password:
        print("ACCOUNT_SESSION_REVOCATION_PROOF=SKIP reason=credentials-not-provided")
        return 2

    base_url = gateway_url()

    client_a = Client(base_url)
    client_b = Client(base_url)

    client_a.login(email, password)
    client_b.login(email, password)
    if client_a.session().get("authenticated") is not True:
        fail("session-a-not-authenticated")
    if client_b.session().get("authenticated") is not True:
        fail("session-b-not-authenticated")

    refresh_a = client_a.cookie_value(REFRESH_COOKIE)
    client_a.logout()

    if client_a.session().get("authenticated") is not False:
        fail("session-a-still-authenticated-after-logout")

    status, stale = client_a.session_with_refresh_token(refresh_a)
    if status != 200 or stale.get("authenticated") is not False:
        fail("revoked-refresh-token-restored-session")

    if client_b.session().get("authenticated") is not True:
        fail("session-b-was-revoked-by-local-logout")

    client_b.logout()
    write_receipt(
        os.environ.get("ORDAX_SESSION_REVOCATION_RECEIPT_PATH", "").strip(),
        base_url,
    )
    print("ACCOUNT_SESSION_REVOCATION_PROOF=PASS scope=local")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
