#!/usr/bin/env python3
"""Final public-account release gate.

This gate consumes the sanitized proof produced by probe_auth_provider.py and
then delegates the remaining repository/deployment checks to
`auth_activation_preflight.py require-ready`. It never accepts provider state
from hand-edited policy booleans as a substitute for a live proof.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
PROBE_SCHEMA = "prototype-ordax.auth-provider-proof/1"
REQUIRED_CHECKS = (
    "confirm_email",
    "password_policy",
    "production_origin",
    "redirect_allowlist",
    "recovery_template",
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


def load_proof(path: Path) -> object:
    if path.stat().st_size > 64 * 1024:
        raise ValueError("provider proof too large")
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider-proof", required=True)
    parser.add_argument("--expected-origin", required=True)
    parser.add_argument("--root", default=str(ROOT))
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    proof_path = Path(args.provider_proof).resolve()
    try:
        proof = load_proof(proof_path)
        blockers = validate_provider_proof(proof, args.expected_origin)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ACCOUNT_RELEASE_GATE=FAIL reason={exc}", file=sys.stderr)
        return 1

    if blockers:
        print("ACCOUNT_RELEASE_GATE=PROVIDER_BLOCKED", file=sys.stderr)
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
