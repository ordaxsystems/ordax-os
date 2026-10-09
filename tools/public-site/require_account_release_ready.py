#!/usr/bin/env python3
"""Final public-account release gate.

The public account release requires sanitized live evidence for:
- hosted Auth provider configuration;
- PostgreSQL control-plane privilege boundary;
- current-session revocation through the exact public origin and release commit.
Only after those proofs pass does this gate delegate to
`auth_activation_preflight.py require-ready` for the remaining legal,
deployment, recovery and activation checks.
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
DB_PROBE_SCHEMA = "prototype-ordax.control-plane-privilege-proof/3"
SESSION_REVOCATION_SCHEMA = "prototype-ordax.account-session-revocation-proof/1"
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
    "private_cloud_storage_rls_enabled",
    "no_authenticated_sync_table_grants",
    "no_service_role_sync_table_grants",
    "sync_policies_executor_only",
    "no_service_role_user_sync_rpc_execute",
    "no_app_role_sync_sequence_privilege",
    "no_unexpected_authenticated_write_grants",
    "no_authenticated_private_schema_usage",
    "no_authenticated_private_function_execute",
)


REQUIRED_PROVIDER_OBSERVED = frozenset((
    "password_min_length",
    "redirect_count",
    "wildcard_redirect_present",
    "cross_origin_redirect_present",
))
REQUIRED_DB_OBSERVED_COUNTERS = frozenset((
    "anon_table_grant_count",
    "anon_function_execute_count",
    "public_function_execute_count",
    "unsafe_security_definer_search_path_count",
    "authenticated_private_function_execute_count",
    "authenticated_sync_table_grant_count",
    "service_role_sync_table_grant_count",
    "non_executor_sync_policy_count",
    "service_role_user_sync_rpc_execute_count",
    "unexpected_authenticated_write_grant_count",
    "private_cloud_storage_rls_enabled_count",
    "sync_policy_count",
))
REQUIRED_DB_OBSERVED_FLAGS = frozenset((
    "anon_private_schema_usage",
    "authenticated_private_schema_usage",
    "app_role_sync_sequence_privilege",
))
PROVIDER_PROOF_FIELDS = frozenset((
    "$schema", "provider", "project_ref", "expected_origin", "checks", "observed", "ready"
))
DATABASE_PROOF_FIELDS = frozenset((
    "$schema", "provider", "project_ref", "checks", "observed", "ready"
))
SESSION_REVOCATION_PROOF_FIELDS = frozenset((
    "$schema", "status", "scope", "gateway_origin", "source_commit", "workflow_run_id",
    "two_independent_sessions", "session_a_anonymous_after_logout",
    "revoked_session_restore_rejected", "session_b_remained_authenticated",
    "credentials_persisted", "account_identifier_recorded", "sensitive_auth_material_recorded",
))


def clean_origin(raw: str) -> str:
    value = raw.strip().rstrip("/")
    parsed = urlparse(value)
    if (
        parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password
        or parsed.path not in ("", "/") or parsed.params or parsed.query or parsed.fragment
    ):
        raise ValueError("expected origin must be a clean HTTPS origin")
    return value


def clean_commit(raw: str) -> str:
    value = raw.strip().lower()
    if len(value) != 40:
        raise ValueError("expected source commit must be a 40-character SHA")
    try:
        int(value, 16)
    except ValueError as exc:
        raise ValueError("expected source commit must be hexadecimal") from exc
    return value


def validate_provider_proof(value: object, expected_origin: str) -> list[str]:
    blockers: list[str] = []
    origin = clean_origin(expected_origin)
    if not isinstance(value, dict):
        return ["provider-proof-object-required"]
    if set(value) != PROVIDER_PROOF_FIELDS:
        blockers.append("provider-proof-field-set")
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
        if set(observed) != REQUIRED_PROVIDER_OBSERVED:
            blockers.append("provider-proof-observation-set")
        count = observed.get("redirect_count")
        if type(count) is not int or count < 1:
            blockers.append("provider-proof-redirect-count")
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
    if set(value) != DATABASE_PROOF_FIELDS:
        blockers.append("database-proof-field-set")
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
        if set(observed) != REQUIRED_DB_OBSERVED_COUNTERS | REQUIRED_DB_OBSERVED_FLAGS:
            blockers.append("database-proof-observation-set")
        for name in REQUIRED_DB_OBSERVED_COUNTERS:
            count = observed.get(name)
            if type(count) is not int or count < 0:
                blockers.append(f"database-proof-observation-type-{name}")
        for name in REQUIRED_DB_OBSERVED_FLAGS:
            if type(observed.get(name)) is not bool:
                blockers.append(f"database-proof-observation-type-{name}")
        for name in (
            "anon_table_grant_count",
            "anon_function_execute_count",
            "public_function_execute_count",
            "unsafe_security_definer_search_path_count",
            "authenticated_private_function_execute_count",
            "authenticated_sync_table_grant_count",
            "service_role_sync_table_grant_count",
            "non_executor_sync_policy_count",
            "service_role_user_sync_rpc_execute_count",
            "unexpected_authenticated_write_grant_count",
        ):
            if observed.get(name) != 0:
                blockers.append(f"database-proof-{name}")
        if observed.get("private_cloud_storage_rls_enabled_count") != 2:
            blockers.append("database-proof-private_cloud_storage_rls_enabled_count")
        if observed.get("sync_policy_count") != 5:
            blockers.append("database-proof-sync_policy_count")
        if observed.get("app_role_sync_sequence_privilege") is not False:
            blockers.append("database-proof-app-role-sync-sequence-privilege")
        if observed.get("anon_private_schema_usage") is not False:
            blockers.append("database-proof-anon-private-schema-usage")
        if observed.get("authenticated_private_schema_usage") is not False:
            blockers.append("database-proof-authenticated-private-schema-usage")
    return sorted(set(blockers))


def validate_session_revocation_proof(
    value: object,
    expected_origin: str,
    expected_source_commit: str,
) -> list[str]:
    blockers: list[str] = []
    origin = clean_origin(expected_origin)
    commit = clean_commit(expected_source_commit)
    if not isinstance(value, dict):
        return ["session-revocation-proof-object-required"]
    if set(value) != SESSION_REVOCATION_PROOF_FIELDS:
        blockers.append("session-revocation-proof-field-set")
    workflow_run_id = value.get("workflow_run_id")
    if workflow_run_id is not None and (
        type(workflow_run_id) is not str
        or not workflow_run_id.isascii()
        or not workflow_run_id.isdecimal()
        or not (1 <= len(workflow_run_id) <= 20)
    ):
        blockers.append("session-revocation-proof-workflow-run-id")
    if value.get("$schema") != SESSION_REVOCATION_SCHEMA:
        blockers.append("session-revocation-proof-schema")
    if value.get("status") != "pass":
        blockers.append("session-revocation-proof-status")
    if value.get("scope") != "local":
        blockers.append("session-revocation-proof-scope")
    if value.get("gateway_origin") != origin:
        blockers.append("session-revocation-proof-origin-mismatch")
    if value.get("source_commit") != commit:
        blockers.append("session-revocation-proof-source-commit-mismatch")
    for name in (
        "two_independent_sessions",
        "session_a_anonymous_after_logout",
        "revoked_session_restore_rejected",
        "session_b_remained_authenticated",
    ):
        if value.get(name) is not True:
            blockers.append(f"session-revocation-proof-{name}")
    for name in (
        "credentials_persisted",
        "account_identifier_recorded",
        "sensitive_auth_material_recorded",
    ):
        if value.get(name) is not False:
            blockers.append(f"session-revocation-proof-{name}")
    serialized = json.dumps(value, sort_keys=True).lower()
    for forbidden in ("access_token", "refresh_token", "password", "cookie"):
        if forbidden in serialized:
            blockers.append("session-revocation-proof-sensitive-material")
            break
    return sorted(set(blockers))


def load_proof(path: Path) -> object:
    if path.stat().st_size > 64 * 1024:
        raise ValueError("proof too large")
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider-proof", required=True)
    parser.add_argument("--database-proof", required=True)
    parser.add_argument("--session-revocation-proof", required=True)
    parser.add_argument("--expected-origin", required=True)
    parser.add_argument("--expected-source-commit", required=True)
    parser.add_argument("--root", default=str(ROOT))
    args = parser.parse_args(argv)
    root = Path(args.root).resolve()
    try:
        provider_proof = load_proof(Path(args.provider_proof).resolve())
        database_proof = load_proof(Path(args.database_proof).resolve())
        session_proof = load_proof(Path(args.session_revocation_proof).resolve())
        blockers = validate_provider_proof(provider_proof, args.expected_origin)
        blockers.extend(validate_database_proof(database_proof))
        blockers.extend(
            validate_session_revocation_proof(
                session_proof,
                args.expected_origin,
                args.expected_source_commit,
            )
        )
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
    result = subprocess.run([sys.executable, str(preflight), "require-ready", "--root", str(root)], check=False)
    if result.returncode != 0:
        print("ACCOUNT_RELEASE_GATE=REPOSITORY_BLOCKED", file=sys.stderr)
        return result.returncode
    print("ACCOUNT_RELEASE_GATE=READY_ACTIVE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
