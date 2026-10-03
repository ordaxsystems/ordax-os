#!/usr/bin/env python3
"""Verify a deployed OrdaX public-site origin without using account credentials."""

from __future__ import annotations

import argparse
import json
import ssl
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
}


def fail(reason: str) -> "NoReturn":
    raise SystemExit(f"PUBLIC_SITE_DEPLOYMENT_PROOF=FAIL reason={reason}")


def request(
    base: str,
    path: str,
    method: str = "GET",
    *,
    body: bytes | None = None,
    content_type: str | None = None,
):
    target = urljoin(base.rstrip("/") + "/", path.lstrip("/"))
    headers = {"User-Agent": "OrdaX-Public-Deployment-Proof/1"}
    if content_type:
        headers["Content-Type"] = content_type
    req = Request(target, data=body, method=method, headers=headers)
    try:
        return urlopen(req, timeout=15, context=ssl.create_default_context())
    except HTTPError as exc:
        return exc
    except (URLError, OSError, TimeoutError) as exc:
        fail(f"request:{type(exc).__name__}")


def expect_headers(response) -> None:
    for name, fragment in SECURITY_HEADERS.items():
        value = response.headers.get(name, "")
        if fragment not in value:
            fail(f"header:{name}")


def read_json(response):
    try:
        return json.loads(response.read(1024 * 1024).decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        fail("invalid-json")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    args = parser.parse_args(argv)

    origin = args.origin.rstrip("/")
    split = urlsplit(origin)
    if split.scheme != "https" or not split.netloc or split.path not in ("", "/") or split.query or split.fragment:
        fail("origin-must-be-clean-https-origin")

    landing = request(origin, "/")
    if landing.status != 200:
        fail(f"landing-status:{landing.status}")
    expect_headers(landing)
    if "no-cache" not in landing.headers.get("Cache-Control", ""):
        fail("landing-cache")

    config = request(origin, "/config/public-site.json")
    if config.status != 200 or "no-store" not in config.headers.get("Cache-Control", ""):
        fail("config-cache")
    config_payload = read_json(config)
    if config_payload.get("$schema") != "prototype-ordax.public-site-runtime/1":
        fail("config-schema")

    activation_ready = config_payload.get("legal", {}).get("account_activation_ready") is True

    for static_path in ("/recuperar/", "/recuperar/nova-senha/"):
        static_response = request(origin, static_path)
        if static_response.status != 200:
            fail(f"recovery-static-route:{static_path}:{static_response.status}")
        expect_headers(static_response)

    session = request(origin, "/auth/session")
    if session.status != 200:
        fail(f"auth-session-status:{session.status}")
    expect_headers(session)
    if "no-store" not in session.headers.get("Cache-Control", ""):
        fail("auth-session-cache")
    session_payload = read_json(session)
    if session_payload.get("$schema") != "prototype-ordax.public-identity-session/1":
        fail("auth-session-schema")
    if session_payload.get("authenticated") is not False:
        fail("unexpected-authenticated-session")
    if not activation_ready and session_payload.get("provider") != "gated":
        fail("public-account-gate-not-enforced")

    sync = request(origin, "/sync/snapshot?limit=1")
    expected_sync_status = 401 if activation_ready else 503
    if sync.status != expected_sync_status:
        fail(f"anonymous-sync-status:{sync.status}")
    if "no-store" not in sync.headers.get("Cache-Control", ""):
        fail("anonymous-sync-cache")
    sync_payload = read_json(sync)
    expected_error = "authentication-required" if activation_ready else "public-account-access-disabled"
    if sync_payload.get("error") != expected_error:
        fail("anonymous-sync-error")

    account = request(origin, "/account/export")
    expected_account_status = 401 if activation_ready else 503
    if account.status != expected_account_status:
        fail(f"anonymous-account-status:{account.status}")
    if "no-store" not in account.headers.get("Cache-Control", ""):
        fail("anonymous-account-cache")
    account_payload = read_json(account)
    if account_payload.get("error") != expected_error:
        fail("anonymous-account-gate-not-enforced")

    if not activation_ready:
        recovery = request(
            origin,
            "/auth/recover",
            "POST",
            body=b"email=deployment-proof%40invalid.example",
            content_type="application/x-www-form-urlencoded",
        )
        if recovery.status != 503:
            fail(f"public-recovery-gate-status:{recovery.status}")
        recovery_payload = read_json(recovery)
        if recovery_payload.get("error") != "public-account-access-disabled":
            fail("public-recovery-gate-not-enforced")

    missing = request(origin, "/__ordax-deployment-proof-missing")
    if missing.status != 404:
        fail(f"unknown-route-status:{missing.status}")

    print("PUBLIC_SITE_DEPLOYMENT_PROOF=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
