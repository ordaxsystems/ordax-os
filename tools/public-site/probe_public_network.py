#!/usr/bin/env python3
"""Read-only external DNS/HTTPS smoke for the canonical OrdaX public portal.

Run from independent CI after DNS or hosting changes. This does not prove
that account registration, login, recovery, or the Vercel-to-Supabase bridge
is active. It never sends credentials or performs state-changing requests.
"""

from __future__ import annotations

import json
import re
import socket
from pathlib import Path
import ssl
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

from public_identity_state import PublicIdentityStateError, resolve_public_identity_mode
from public_legal_integrity import PublicLegalIntegrityError, verify_public_legal_integrity

CONTRACT_PATH = Path(__file__).resolve().parents[2] / "docs/contracts/public-site-deployment.json"
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
CANONICAL_HOST = CONTRACT["vercel_migration"]["target_canonical_domain"]
WWW_HOST = CONTRACT["vercel_migration"]["target_www_domain"]
CANONICAL_VERCEL_IPV4 = frozenset(CONTRACT["cloudflare_dns_migration"]["destination_apex_a_addresses"])
PATHS = ("/", "/login/", "/cadastro/", "/privacidade/", "/termos/")
TIMEOUT_SECONDS = 10


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fail(code: str) -> None:
    raise SystemExit("ORDAX_PUBLIC_NETWORK_PROOF=FAIL reason=" + code)


def resolve_v4(hostname: str) -> set[str]:
    try:
        return {row[4][0] for row in socket.getaddrinfo(
            hostname, 443, family=socket.AF_INET, type=socket.SOCK_STREAM
        )}
    except (OSError, socket.gaierror):
        fail("dns-resolution-failed:" + hostname)


def fetch(hostname: str, path: str, *, accept: str = "text/html"):
    opener = build_opener(
        ProxyHandler({}),
        HTTPSHandler(context=ssl.create_default_context()),
        NoRedirect(),
    )
    try:
        return opener.open(Request(
            f"https://{hostname}{path}",
            headers={"Accept": accept, "Accept-Encoding": "identity",
                     "User-Agent": "OrdaX-Public-Network-Proof/1"},
        ), timeout=TIMEOUT_SECONDS)
    except HTTPError as error:
        return error
    except (URLError, OSError, TimeoutError):
        fail("https-connection-failed:" + hostname + path)



def bounded_json(response, *, path: str) -> dict:
    """Read a small anonymous document; disallow HTML masquerading as JSON."""
    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
    if content_type != "application/json":
        fail("json-content-type:" + path)
    if "no-store" not in response.headers.get("Cache-Control", "").lower():
        fail("json-no-store:" + path)
    raw = response.read(128 * 1024 + 1)
    if len(raw) > 128 * 1024:
        fail("json-too-large:" + path)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeError):
        fail("invalid-json:" + path)
    if not isinstance(value, dict):
        fail("json-object-required:" + path)
    return value


def check_anonymous_account_boundary() -> None:
    """The portal must serve an honest, anonymous, non-cached session result."""
    config_path = "/config/public-site.json"
    with fetch(CANONICAL_HOST, config_path, accept="application/json") as response:
        if response.status != 200:
            fail("config-http-status")
        config = bounded_json(response, path=config_path)
    if config.get("$schema") != "prototype-ordax.public-site-runtime/1":
        fail("config-schema")
    legal = config.get("legal")
    if not isinstance(legal, dict) or type(legal.get("account_activation_ready")) is not bool:
        fail("config-legal-activation-invalid")

    session_path = "/auth/session"
    with fetch(CANONICAL_HOST, session_path, accept="application/json") as response:
        print("ORDAX_PUBLIC_SESSION_STATUS=" + str(response.status), flush=True)
        if response.status not in (200, 503):
            fail("session-http-status")
        session = bounded_json(response, path=session_path)
        session_http_status = response.status

    try:
        mode = resolve_public_identity_mode(config, session, session_http_status=session_http_status)
    except PublicIdentityStateError as exc:
        if str(exc) == "unexpected-account-gateway-failure":
            # Expose only a bounded diagnostic code, never provider/user data.
            raw_code = session.get("error")
            diagnostic = (
                raw_code if isinstance(raw_code, str)
                and re.fullmatch(r"[a-z][a-z0-9-]{0,63}", raw_code)
                else "unclassified"
            )
            print("ORDAX_PUBLIC_ACCOUNT_ERROR_CODE=" + diagnostic, flush=True)
        fail(str(exc))

    if mode == "disabled-unconfigured":
        print("ORDAX_PUBLIC_ACCOUNT_GATE=disabled-unconfigured", flush=True)
        return
    print("ORDAX_PUBLIC_ACCOUNT_GATE=" + ("supabase" if mode in ("full", "auth-only") else "gated"), flush=True)
    print("ORDAX_PUBLIC_IDENTITY_MODE=" + mode, flush=True)
    print(
        "ORDAX_PUBLIC_LEGAL_ACTIVATION="
        + ("ready" if legal["account_activation_ready"] else "not-ready"),
        flush=True,
    )


def check_public_legal_consistency() -> int:
    """One canonical digest proof for the server-owned active legal policy."""
    def retrieve(path: str, *, accept: str):
        return fetch(CANONICAL_HOST, path, accept=accept)

    try:
        state = verify_public_legal_integrity(
            "https://" + CANONICAL_HOST,
            retrieve,
            report=lambda message: print(message, flush=True),
        )
    except PublicLegalIntegrityError as exc:
        raise SystemExit("ORDAX_PUBLIC_LEGAL_INTEGRITY=FAIL reason=" + str(exc)) from exc
    print("ORDAX_PUBLIC_LEGAL_INTEGRITY=" + ("PASS" if state == "ACTIVE" else "INACTIVE"), flush=True)
    return 0


def main() -> int:
    if CONTRACT["cloudflare_dns_migration"]["destination_public_site_proxy_mode"] != "dns-only":
        fail("dns-owner-not-in-dns-only-mode")
    if (CANONICAL_HOST, WWW_HOST) != ("ordax.com.br", "www.ordax.com.br"):
        fail("noncanonical-domain")
    addresses = resolve_v4(CANONICAL_HOST)
    print("ORDAX_PUBLIC_DNS_APEX_A=" + ",".join(sorted(addresses)), flush=True)
    if addresses != CANONICAL_VERCEL_IPV4:
        fail("dns-apex-not-vercel-preferred-ipv4-pair")

    www_addresses = resolve_v4(WWW_HOST)
    print("ORDAX_PUBLIC_DNS_WWW_IPV4=" + ",".join(sorted(www_addresses)), flush=True)
    if not www_addresses:
        fail("dns-www-unavailable")

    for path in PATHS:
        with fetch(CANONICAL_HOST, path) as response:
            print(f"ORDAX_PUBLIC_HTTPS path={path} status={response.status}", flush=True)
            if response.status != 200:
                fail("unexpected-page-status:" + path)
            if "text/html" not in response.headers.get("Content-Type", "").lower():
                fail("unexpected-content-type:" + path)
            if "nosniff" not in response.headers.get("X-Content-Type-Options", ""):
                fail("missing-content-security:" + path)
            response.read(256)

    check_anonymous_account_boundary()

    with fetch(WWW_HOST, "/") as response:
        print("ORDAX_PUBLIC_WWW_STATUS=" + str(response.status), flush=True)
        if response.status != 308:
            fail("www-not-permanent-redirect")
        if response.headers.get("Location", "").rstrip("/") != "https://" + CANONICAL_HOST:
            fail("www-target-not-canonical")

    print("ORDAX_PUBLIC_NETWORK_PROOF=PASS")
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--legal-consistency"]:
        sys.exit(check_public_legal_consistency())
    if len(sys.argv) != 1:
        raise SystemExit("unsupported-network-proof-argument")
    sys.exit(main())
