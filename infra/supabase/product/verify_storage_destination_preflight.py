#!/usr/bin/env python3
"""Fail-closed, read-only preflight for the populated OrdaX Storage destination.

Never applies migrations, alters tables, reads user records or prints credentials.
Live mode accepts only a connection to the canonical Supabase project over TLS.
Fixture mode is explicitly not evidence of remote readiness.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[3]
OWNER = ROOT / "docs/contracts/public-auth-hardening.json"
STORAGE = ROOT / "docs/contracts/user-cloud-storage.json"
QUOTA = ROOT / "docs/contracts/service-quotas.json"
RENDERER = ROOT / "infra/supabase/product/render_storage_quota_destination_migration.py"
VERSIONED = ROOT / "infra/supabase/product/migrations/20261026222222_storage_quota_populated_destination_v1.sql"
VERSION = VERSIONED.name.split("_", 1)[0]

# Exact dependencies in the canonical migration's transaction preflight.
REQUIRED_TRUE = (
    "project_users_present",
    "base_spaces_present",
    "base_entitlements_present",
    "private_schema_present",
    "auth_uid_present",
    "touch_trigger_present",
    "session_helper_present",
    "space_helper_present",
)
REQUIRED_FALSE = (
    "obsolete_policy_schema_present",
    "metadata_table_present",
    "provider_refs_table_present",
    "upload_reservations_table_present",
    "quota_usage_table_present",
    "quota_reservations_table_present",
    "quota_reserve_rpc_present",
    "quota_reduce_rpc_present",
    "quota_status_rpc_present",
    "target_migration_version_present",
)
TABLE_COLUMNS = {
    "metadata_table_present": "public.ordax_user_objects",
    "provider_refs_table_present": "private.ordax_user_object_provider_refs",
    "upload_reservations_table_present": "private.ordax_user_upload_reservations",
    "quota_usage_table_present": "private.ordax_service_quota_usage",
    "quota_reservations_table_present": "private.ordax_service_quota_reservations",
}
FUNCTION_COLUMNS = {
    "auth_uid_present": "auth.uid()",
    "touch_trigger_present": "private.ordax_touch_updated_at()",
    "session_helper_present": "private.ordax_authenticated_subject_eligible_v1()",
    "space_helper_present": "private.ordax_can_access_space(uuid)",
    "quota_reserve_rpc_present": "private.ordax_reserve_service_quota_v1(uuid,uuid,text,text,bigint,text,integer)",
    "quota_reduce_rpc_present": "private.ordax_reduce_service_quota_usage_v1(uuid,uuid,text,text,bigint)",
    "quota_status_rpc_present": "public.ordax_service_quota_usage_status_v1(uuid,uuid,text)",
}


def owner_ref() -> str:
    hardening = json.loads(OWNER.read_text(encoding="utf-8"))
    storage = json.loads(STORAGE.read_text(encoding="utf-8"))
    quota = json.loads(QUOTA.read_text(encoding="utf-8"))
    dest = hardening["postgresql_destination"]
    ref = dest["project_ref"]
    if (
        not isinstance(ref, str)
        or re.fullmatch(r"[a-z]{20}", ref) is None
        or storage["deployment"]["target_project_ref"] != ref
        or quota["server_ledger"]["target_project_ref"] != ref
        or dest["existing_auth_users_observed"] is not True
        or dest["functional_provider_cutover_complete"] is not False
        or dest["public_registration_enabled"] is not False
        or dest["public_login_enabled"] is not False
        or dest["parallel_identity_write_enabled"] is not False
        or storage["deployment"]["transactional_schema_deployed"] is not False
        or quota["server_ledger"]["production_applied"] is not False
        or storage["deployment"]["public_rollout_enabled"] is not False
        or quota["server_ledger"]["public_allocation_enabled"] is not False
    ):
        raise ValueError("storage-preflight-owner-or-activation-drift")
    tables = set(storage["deployment"]["observed_tables"]) | set(
        quota["server_ledger"]["observed_tables"]
    )
    if tables != set(TABLE_COLUMNS.values()):
        raise ValueError("storage-preflight-table-source-of-truth-drift")
    return ref


def check_versioned_sql(ref: str) -> str:
    spec = importlib.util.spec_from_file_location("storage_canonical_renderer", RENDERER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    expected = module.render(project_ref=ref, commit=True).encode("utf-8")
    found = VERSIONED.read_bytes()
    if expected != found:
        raise ValueError("storage-preflight-versioned-sql-drift")
    if not re.fullmatch(r"20\d{12}", VERSION):
        raise ValueError("storage-preflight-invalid-version")
    return hashlib.sha256(found).hexdigest()


def query() -> str:
    # Identifiers and function signatures are source-controlled constants.
    fields = [
        ("project_users_present", "exists(select 1 from auth.users)"),
        ("base_spaces_present", "to_regclass('public.ordax_spaces') is not null"),
        ("base_entitlements_present", "to_regclass('public.ordax_entitlement_grants') is not null"),
        ("private_schema_present", "to_regnamespace('private') is not null"),
        ("obsolete_policy_schema_present", "to_regnamespace('ordax_policy') is not null"),
    ]
    for key, relation in TABLE_COLUMNS.items():
        fields.append((key, f"to_regclass('{relation}') is not null"))
    for key, signature in FUNCTION_COLUMNS.items():
        fields.append((key, f"to_regprocedure('{signature}') is not null"))
    fields.append((
        "target_migration_version_present",
        "exists(select 1 from supabase_migrations.schema_migrations "
        f"where version='{VERSION}')",
    ))
    return "select json_build_object(\n" + ",\n".join(
        f"  '{key}', ({expression})" for key, expression in fields
    ) + "\n);\n"


def validate_observation(record: object) -> list[str]:
    if not isinstance(record, dict):
        return ["observation-not-object"]
    keys = set(REQUIRED_TRUE + REQUIRED_FALSE)
    if set(record) != keys:
        return ["observation-unexpected-or-missing-fields"]
    failures: list[str] = []
    for field in REQUIRED_TRUE:
        if record[field] is not True:
            failures.append("prerequisite-" + field)
    for field in REQUIRED_FALSE:
        if record[field] is not False:
            failures.append("already-applied-or-conflicting-" + field)
    return failures


def secure_pg_env(database_url: str, ref: str) -> dict[str, str]:
    parsed = urlparse(database_url)
    host = (parsed.hostname or "").lower()
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    try:
        port = parsed.port or 5432
    except ValueError as exc:
        raise ValueError("storage-preflight-invalid-database-port") from exc
    direct = host == f"db.{ref}.supabase.co" and user == "postgres"
    pooler = host.endswith(".pooler.supabase.com") and user == f"postgres.{ref}"
    if (
        parsed.scheme not in ("postgresql", "postgres")
        or not (direct or pooler)
        or parsed.path != "/postgres"
        or parsed.params or parsed.query or parsed.fragment
        or port not in (5432, 6543)
        or not password
    ):
        raise ValueError("storage-preflight-wrong-project-or-connection")
    # Use protocol env variables, never a DSN on the process command line.
    env = {k: v for k, v in os.environ.items()
           if not k.upper().startswith("PG") and k != "ORDAX_STORAGE_DESTINATION_DATABASE_URL"}
    env.update(
        PGHOST=host, PGPORT=str(port), PGUSER=user, PGPASSWORD=password,
        PGDATABASE="postgres", PGSSLMODE="require", PGCONNECT_TIMEOUT="10",
    )
    return env


def read_live(ref: str) -> object:
    dsn = os.environ.get("ORDAX_STORAGE_DESTINATION_DATABASE_URL", "")
    if not dsn:
        raise ValueError("storage-preflight-database-secret-unavailable")
    env = secure_pg_env(dsn, ref)
    result = subprocess.run(
        ["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", query()],
        env=env, text=True, capture_output=True, timeout=25, check=False,
    )
    if result.returncode:
        # psql stderr can contain connection details: never echo it.
        raise ValueError("storage-preflight-read-only-query-failed")
    rows = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if len(rows) != 1:
        raise ValueError("storage-preflight-unexpected-query-result")
    return json.loads(rows[0])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--live", action="store_true")
    mode.add_argument("--fixture-json", type=Path)
    mode.add_argument("--print-query", action="store_true")
    args = parser.parse_args(argv)
    try:
        ref = owner_ref()
        fingerprint = check_versioned_sql(ref)
        if args.print_query:
            print(query(), end="")
            return 0
        if args.fixture_json:
            observation = json.loads(args.fixture_json.read_text(encoding="utf-8"))
            scope = "SYNTHETIC_FIXTURE_NOT_LIVE"
        else:
            observation = read_live(ref)
            scope = "READ_ONLY_LIVE_DATABASE_CATALOG"
        errors = validate_observation(observation)
        print(json.dumps({
            "schema": "ordax.storage-destination-preflight/1",
            "scope": scope,
            "target_project_binding": hashlib.sha256(ref.encode()).hexdigest(),
            "migration_version": VERSION,
            "migration_sql_sha256": fingerprint,
            "catalog_preconditions_match": not errors,
            "blockers": errors,
            "production_ddl_performed": False,
            "public_activation_approved": False,
            "live_two_subject_e2e_proven": False,
        }, sort_keys=True))
        return 0 if not errors else 2
    except (OSError, KeyError, ValueError, TypeError, TimeoutError, subprocess.TimeoutExpired,
            json.JSONDecodeError) as exc:
        # never log DSNs, raw SQL errors, user records or credentials.
        print("STORAGE_DESTINATION_PREFLIGHT=BLOCKED " + type(exc).__name__, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
