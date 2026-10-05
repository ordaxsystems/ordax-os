#!/usr/bin/env python3
"""Final public-account release gate.

This gate consumes two sanitized live proofs before delegating the remaining
repository/deployment checks to `auth_activation_preflight.py require-ready`:
- hosted Auth provider configuration;
- PostgreSQL control-plane privilege boundary.
Neither proof may contain provider credentials, project refs, table contents,
policy expressions, or function bodies.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
PROBE_SCHEMA = "prototype-ordax.auth-provider-proof/1"
DB_PROBE_SCHEMA = "prototype-ordax.control-plane-privilege-proof/1"
REQUIRED_CHECKS = (
    "confirm_email",
    "password_policy",
    "production_origin",
    "redirect_allowlist",
    "recovery_template",
)
REQUIRED_DB_CHECKS = (
    "no_anon_table_grants",
    "no_anon_function_execute",
    "no_public_function_execute",
    "security_definer_search_path",
    "no_anon_private_schema_usage",
    "authenticated_write_allowlist",
)


def clean_origin(raw: str) -> str:
    value = raw.strip().rstrip("/")
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.path not in ("", "/")
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("expected origin must be a clean HTTPS origin")
    return value


def validate_provider_proof(value: object, expected_origin: str) -> list[str]:
    blockers: list[str] = []
    origin = clean_origin(expected_origin)
    if not isinstance(value, dict):
        return ["provider-proof-object-required"]
    if value.get("$schema") != PROBE_SCHEMA:
        blockers.append("provider-proof-schema")
    if value.get("provider") != "supabase":
        blockers.append("provider-proof-provider")
    if value.get("project_ref") != "redacted":
        blockers.append("provider-proof-not-sanitized")
    if value.get("expected_origin") != origin:
        blockers.append("provider-proof-origin-mismatch")
    checks = value.get("checks")
    if not isinstance(checks, dict):
        blockers.append("provider-proof-checks")
    else:
        if set(checks) != set(REQUIRED_CHECKS):
            blockers.append("provider-proof-check-set")
        for name in REQUIRED_CHECKS:
            if checks.get(name) is not True:
                blockers.append(f"provider-proof-{name}")
    if value.get("ready") is not True:
        blockers.append("provider-proof-not-ready")
    observed = value.get("observed")
    if not isinstance(observed, dict):
        blockers.append("provider-proof-observation")
    else:
        if observed.get("wildcard_redirect_present") is not False:
            blockers.append("provider-proof-wildcard-redirect")
        if observed.get("cross_origin_redirect_present") is not False:
            blockers.append("provider-proof-cross-origin-redirect")
        password_min = observed.get("password_min_length")
        if not isinstance(password_min, int) or isinstance(password_min, bool) or password_min < 12:
            blockers.append("provider-proof-password-floor")
    return sorted(set(blockers))


def validate_database_proof(value: object) -> list[str]:
    blockers: list[str] = []
    if not isinstance(value, dict):
        return ["database-proof-object-required"]
    if value.get("$schema") != DB_PROBE_SCHEMA:
        blockers.append("database-proof-schema")
    if value.get("provider") != "supabase-postgres":
        blockers.append("database-proof-provider")
    if value.get("project_ref") != "redacted":
        blockers.append("database-proof-not-sanitized")
    checks = value.get("checks")
    if not isinstance(checks, dict):
        blockers.append("database-proof-checks")
    else:
        if set(checks) != set(REQUIRED_DB_CHECKS):
            blockers.append("database-proof-check-set")
        for name in REQUIRED_DB_CHECKS:
            if checks.get(name) is not True:
                blockers.append(f"database-proof-{name}")
    if value.get("ready") is not True:
        blockers.append("database-proof-not-ready")
    observed = value.get("observed")
    if not isinstance(observed, dict):
        blockers.append("database-proof-observation")
    else:
        expected_zero = (
            "anon_table_grant_count",
            "anon_function_execute_count",
            "public_function_execute_count",
            "unsafe_security_definer_search_path_count",
            "unexpected_authenticated_write_grant_count",
        )
        for name in expected_zero:
            if observed.get(name) != 0:
                blockers.append(f"database-proof-{name}")
        if observed.get("anon_private_schema_usage") is not False:
            blockers.append("database-proof-anon-private-schema-usage")
        if observed.get("allowed_authenticated_write_grant_count") != 3:
            blockers.append("database-proof-authenticated-write-grant-count")
    return sorted(set(blockers))


def load_proof(path: Path) -> object:
    if path.stat().st_size > 64 * 1024:
        raise ValueError("proof too large")
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider-proof", required=True)
    parser.add_argument("--database-proof", required=True)
    parser.add_argument("--expected-origin", required=True)
    parser.add_argument("--root", default=str(ROOT))
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    try:
        provider_proof = load_proof(Path(args.provider_proof).resolve())
        database_proof = load_proof(Path(args.database_proof).resolve())
        blockers = validate_provider_proof(provider_proof, args.expected_origin)
        blockers.extend(validate_database_proof(database_proof))
        blockers = sorted(set(blockers))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ACCOUNT_RELEASE_GATE=FAIL reason={exc}", file=sys.stderr)
        return 1

    if blockers:
        print("ACCOUNT_RELEASE_GATE=LIVE_PROOF_BLOCKED", file=sys.stderr)
        for blocker in blockers:
            print(f"ACCOUNT_RELEASE_BLOCKER={blocker}", file=sys.stderr)
        return 1

    preflight = root / "tools" / "public-site" / "auth_activation_preflight.py"
    result = subprocess.run(
        [sys.executable, str(preflight), "require-ready", "--root", str(root)],
        check=False,
    )
    if result.returncode != 0:
        print("ACCOUNT_RELEASE_GATE=REPOSITORY_BLOCKED", file=sys.stderr)
        return result.returncode

    print("ACCOUNT_RELEASE_GATE=READY_ACTIVE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
