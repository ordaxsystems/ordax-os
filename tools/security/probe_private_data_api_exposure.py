#!/usr/bin/env python3
"""Read-only PostgREST exposed-schema check using a public Supabase API key.

No user records, service keys, Auth sessions or privileged SQL. A 404/PGRST205
baseline in public must precede the 406/PGRST106 private rejection. The probe
never prints or persists its publishable key and does not follow redirects.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "docs/contracts/public-auth-hardening.json"
EVIDENCE = ROOT / "docs/evidence/private-schema-data-api-exclusion-2026-10-26.json"
NONEXISTENT_RELATION = "__ordax_private_schema_probe_nonexistent"
QUERY = "?select=nonexistent&limit=0"
EXPECTED = {
    "public": {"http_status": 404, "postgrest_code": "PGRST205"},
    "private": {"http_status": 406, "postgrest_code": "PGRST106"},
}


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def canonical_ref() -> str:
    policy = json.loads(CONTRACT.read_text(encoding="utf-8"))
    dest = policy["postgresql_destination"]
    ref = dest["project_ref"]
    if (
        not isinstance(ref, str) or len(ref) != 20
        or not ref.isalpha() or not ref.islower()
        or dest["public_registration_enabled"] is not False
        or dest["functional_provider_cutover_complete"] is not False
    ):
        raise ValueError("private-schema-probe-owner-drift")
    return ref


def validate_responses(observed: object) -> list[str]:
    if not isinstance(observed, dict) or set(observed) != set(EXPECTED):
        return ["postgrest-response-shape"]
    blockers = []
    for schema in EXPECTED:
        item = observed[schema]
        if not isinstance(item, dict) or set(item) != {"http_status", "postgrest_code"}:
            blockers.append("postgrest-" + schema + "-response-shape")
        elif item != EXPECTED[schema]:
            blockers.append("postgrest-" + schema + "-profile-unexpected")
    return blockers


def check_live(project_ref: str, key: str) -> dict:
    if not key or any(ch.isspace() for ch in key):
        raise ValueError("private-schema-probe-public-key-unavailable")
    url = (
        f"https://{project_ref}.supabase.co/rest/v1/"
        + NONEXISTENT_RELATION + QUERY
    )
    opener = build_opener(RejectRedirects())
    observations = {}
    for profile in ("public", "private"):
        request = Request(url, method="GET", headers={
            "apikey": key,
            "Accept-Profile": profile,
            "Accept": "application/json",
        })
        try:
            response = opener.open(request, timeout=15)
            status = response.status
            body = response.read(4096)
            response.close()
        except HTTPError as exc:
            status = exc.code
            body = exc.read(4096)
            exc.close()
        except (URLError, TimeoutError, OSError):
            raise ValueError("private-schema-probe-unreachable") from None
        try:
            parsed = json.loads(body)
            code = parsed.get("code")
            if not isinstance(code, str):
                raise ValueError("missing-code")
        except (ValueError, TypeError, AttributeError):
            code = "INVALID_RESPONSE"
        observations[profile] = {
            "http_status": status,
            "postgrest_code": code,
        }
    return observations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--live", action="store_true")
    scope.add_argument("--fixture-json", type=Path)
    args = parser.parse_args(argv)
    try:
        ref = canonical_ref()
        if args.live:
            key = os.environ.get("ORDAX_SUPABASE_PUBLISHABLE_KEY", "")
            observed = check_live(ref, key)
            origin = "LIVE_PUBLISHABLE_KEY_NO_AUTH"
        else:
            observed = json.loads(args.fixture_json.read_text(encoding="utf-8"))
            origin = "SYNTHETIC_NOT_LIVE"
        blockers = validate_responses(observed)
        print(json.dumps({
            "$schema": "prototype-ordax.private-data-api-schema-exclusion/1",
            "scope": origin,
            "project_ref": ref,
            "public_baseline": observed.get("public") if isinstance(observed, dict) else None,
            "private_profile": observed.get("private") if isinstance(observed, dict) else None,
            "private_schema_data_api_exclusion": not blockers,
            "blockers": blockers,
            "authenticated_two_subject_isolation_verified": False,
            "public_account_release_approved": False,
            "production_mutation_performed": False,
        }, sort_keys=True))
        return 0 if not blockers else 2
    except (OSError, ValueError, KeyError, TypeError):
        print("PRIVATE_SCHEMA_DATA_API_PROBE=BLOCKED", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
