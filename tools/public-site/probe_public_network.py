#!/usr/bin/env python3
"""Read-only external DNS/HTTPS smoke for the canonical OrdaX public portal.

Run from independent CI after DNS or hosting changes. This does not prove
that account registration, login, recovery, or the Vercel-to-Supabase bridge
is active. It never sends credentials or performs state-changing requests.
"""

from __future__ import annotations

import socket
import ssl
import sys
from urllib.error import HTTPError, URLError
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener

CANONICAL_HOST = "ordax.com.br"
WWW_HOST = "www.ordax.com.br"
CANONICAL_VERCEL_IPV4 = "76.76.21.21"
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


def fetch(hostname: str, path: str):
    opener = build_opener(
        ProxyHandler({}),
        HTTPSHandler(context=ssl.create_default_context()),
        NoRedirect(),
    )
    try:
        return opener.open(Request(
            f"https://{hostname}{path}",
            headers={"Accept": "text/html", "User-Agent": "OrdaX-Public-Network-Proof/1"},
        ), timeout=TIMEOUT_SECONDS)
    except HTTPError as error:
        return error
    except (URLError, OSError, TimeoutError):
        fail("https-connection-failed:" + hostname + path)


def main() -> int:
    addresses = resolve_v4(CANONICAL_HOST)
    print("ORDAX_PUBLIC_DNS_APEX_A=" + ",".join(sorted(addresses)), flush=True)
    if addresses != {CANONICAL_VERCEL_IPV4}:
        fail("dns-apex-not-direct-vercel")

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

    with fetch(WWW_HOST, "/") as response:
        print("ORDAX_PUBLIC_WWW_STATUS=" + str(response.status), flush=True)
        if response.status != 308:
            fail("www-not-permanent-redirect")
        if response.headers.get("Location", "").rstrip("/") != "https://" + CANONICAL_HOST:
            fail("www-target-not-canonical")

    print("ORDAX_PUBLIC_NETWORK_PROOF=PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
