#!/usr/bin/env python3
"""Externally test the REAL OrdaX first-party OAuth consent presentation.

Only GET requests with non-existent authorization_ids; no login, consent,
client registration or user access. This is NOT the full OAuth flow.
"""
from __future__ import annotations

import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "infra/supabase/functions/_shared/account_email_confirmation.mjs"
MAX_BYTES = 98304


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: urllib.request.Request, fp: Any,
                         code: int, msg: str, headers: Any, url: str) -> None:
        return None


def canonical_origin() -> str:
    text = SOURCE.read_text(encoding="utf-8")
    match = re.search(r'export const PUBLIC_ACCOUNT_ORIGIN = "(https://[a-z0-9.-]+)";', text)
    if not match or match.group(1) != "https://ordax.com.br":
        raise ValueError("canonical_public_origin_unavailable")
    return match.group(1)


def fetch_get(url: str) -> tuple[int | None, dict[str, str], str]:
    req = urllib.request.Request(
        url, method="GET", headers={"Accept": "text/html", "User-Agent": "OrdaX-Consent-ReadOnly/1"}
    )
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        _NoRedirect(),
    )
    try:
        response = opener.open(req, timeout=15)
    except urllib.error.HTTPError as exc:
        response = exc
    except (urllib.error.URLError, TimeoutError, OSError):
        return None, {}, ""
    try:
        size = response.read(MAX_BYTES + 1)
        if len(size) > MAX_BYTES:
            return response.status, {}, ""
        headers = {k.lower(): v for k, v in response.headers.items()
                   if k.lower() in {"content-type", "content-security-policy", "cache-control",
                                    "referrer-policy", "location"}}
        return response.status, headers, size.decode("utf-8", "replace")
    finally:
        response.close()


def analyze(
    origin: str,
    actual: tuple[int | None, dict[str, str], str],
    missing: tuple[int | None, dict[str, str], str],
    invalid: tuple[int | None, dict[str, str], str],
) -> dict[str, Any]:
    status, headers, html = actual
    result = {
        "origin": origin,
        "route_http": status,
        "missing_id_http": missing[0],
        "malformed_id_http": invalid[0],
        "consent_presentation": "UNAVAILABLE",
        "oauth_consent_completed": False,
        "oauth_client_registered": False,
        "auth_session_created": False,
    }
    if (
        status == 200 and "text/html" in headers.get("content-type", "").lower()
        and "no-store" in headers.get("cache-control", "")
        and headers.get("referrer-policy") == "no-referrer"
        and "frame-ancestors 'none'" in headers.get("content-security-policy", "")
        and "base-uri 'none'" in headers.get("content-security-policy", "")
        and "createClient(" in html
        and "auth.oauth.getAuthorizationDetails(" in html
        and "auth.oauth.approveAuthorization(" in html
        and "auth.oauth.denyAuthorization(" in html
        and missing[0] == 400 and invalid[0] == 400
    ):
        result["consent_presentation"] = "LIVE_ROUTE_VALIDATED"
    return result


def main() -> int:
    origin = canonical_origin()
    prefix = origin + "/oauth/consent"
    actual = fetch_get(prefix + "?authorization_id=ORDAX_READONLY_PROBE_20261011")
    missing = fetch_get(prefix)
    invalid = fetch_get(prefix + "?authorization_id=%3Cscript%3E")
    result = analyze(origin, actual, missing, invalid)
    print(json.dumps(result, sort_keys=True))
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### OAuth consent HTTP on actual ordax.com.br\n\n")
            for key in ("route_http", "missing_id_http", "malformed_id_http", "consent_presentation"):
                f.write(f"- {key}: **{result[key]}**\n")
            f.write("\nNo authorization, login, client registration or ChatGPT plugin call was performed.\n")
    if result["consent_presentation"] != "LIVE_ROUTE_VALIDATED":
        print("LIVE_CONSENT_ROUTE=FAIL_OR_INCONCLUSIVE", file=sys.stderr)
        return 2
    print("LIVE_CONSENT_ROUTE=PASS_GET_ONLY")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
