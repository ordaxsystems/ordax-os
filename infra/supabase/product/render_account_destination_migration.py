#!/usr/bin/env python3
"""Render one transactional Account Sync/Export cutover from canonical SQL sources.

Does not connect to a database or apply migrations. Supabase deployment must
apply the generated text as ONE migration, never the intermediate statements
separately, after CI and operator-side project identity verification.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OWNER = ROOT / "infra" / "supabase" / "product"
PLAN = OWNER / "account_destination_migration_plan.json"
MIGRATIONS = OWNER / "migrations"
TX_BEGIN = re.compile(r"^begin;\r?$", re.MULTILINE | re.IGNORECASE)
TX_COMMIT = re.compile(r"^commit;\r?$", re.MULTILINE | re.IGNORECASE)


def render(*, project_ref: str) -> str:
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    if (
        plan.get("$schema") != "prototype-ordax.postgres-account-cutover-plan/1"
        or plan.get("destination_project_ref") != project_ref
        or plan.get("allowed_only_while_public_auth_disabled") is not True
        or plan.get("requires_no_existing_auth_users") is not True
        or plan.get("requires_absent_sync_tables_and_export_rpc") is not True
        or plan.get("parallel_identity_write_allowed") is not False
        or plan.get("public_gateway_deploy_allowed") is not False
        or plan.get("source_owner") != "infra/supabase/product/migrations"
        or plan.get("historical_export_skipped") != "20260925031000_account_data_export_v1.sql"
    ):
        raise ValueError("destination-cutover-plan-untrusted")
    ordered = plan.get("ordered_source_files")
    if not isinstance(ordered, list) or len(ordered) != 9 or len(set(ordered)) != 9:
        raise ValueError("destination-cutover-source-set-invalid")
    expected = (
        "20260925004439_account_sync_objects_v1.sql",
        "20260925004832_account_sync_private_store_v1.sql",
        "20260925013355_account_sync_incremental_cursor_v1.sql",
        "20260925013524_account_sync_atomic_snapshot_v1.sql",
        "20260930140051_account_sync_paginated_snapshot_v2.sql",
        "20261008085000_account_data_export_project_id_v1.sql",
        "20261005025500_sync_private_least_privilege_v2.sql",
        "20261007070000_account_export_executor_v1.sql",
        "20261007071500_account_export_subject_bridge_v1.sql",
    )
    if tuple(ordered) != expected:
        raise ValueError("destination-cutover-source-order-mismatch")

    segments = []
    for name in ordered:
        if Path(name).name != name or not re.fullmatch(r"\d{14}_[a-z0-9_]+\.sql", name):
            raise ValueError("destination-cutover-invalid-source-path")
        sql = (MIGRATIONS / name).read_text(encoding="utf-8")
        begin_count = len(TX_BEGIN.findall(sql))
        commit_count = len(TX_COMMIT.findall(sql))
        if begin_count != commit_count or begin_count > 1:
            raise ValueError(f"migration-transaction-wrapper-incompatible:{name}")
        if begin_count:
            sql = TX_BEGIN.sub("", sql, count=1)
            sql = TX_COMMIT.sub("", sql, count=1)
        if re.search(r"^\s*\\(?:i|include)\b", sql, re.MULTILINE):
            raise ValueError(f"migration-external-include-not-allowed:{name}")
        segments.append(f"-- SOURCE {name}\n{sql.strip()}")

    preflight = """
DO $preflight$
BEGIN
  IF to_regclass('private.ordax_sync_objects') IS NOT NULL
    OR to_regclass('private.ordax_sync_mutations') IS NOT NULL
    OR to_regprocedure('public.ordax_account_export_v1()') IS NOT NULL
    OR to_regprocedure('public.ordax_sync_snapshot_page_v2(bigint,text,text,integer)') IS NOT NULL
  THEN
    RAISE EXCEPTION 'account-cutover-destination-not-empty';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'account-cutover-users-present';
  END IF;
END;
$preflight$;""".strip()
    proof = """
DO $proof$
BEGIN
  IF (SELECT count(*) FROM pg_roles
      WHERE rolname IN ('ordax_sync_executor','ordax_account_export_executor')
      AND NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper AND NOT rolinherit) <> 2
  THEN RAISE EXCEPTION 'account-cutover-privileged-executor'; END IF;
  IF has_table_privilege('authenticated','private.ordax_sync_objects','SELECT')
    OR has_table_privilege('service_role','private.ordax_sync_objects','SELECT')
    OR has_table_privilege('anon','private.ordax_sync_objects','SELECT')
  THEN RAISE EXCEPTION 'account-cutover-sync-table-exposed'; END IF;
  IF has_function_privilege('anon','public.ordax_account_export_v1()','EXECUTE')
    OR has_function_privilege('service_role','public.ordax_account_export_v1()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.ordax_account_export_v1()','EXECUTE')
  THEN RAISE EXCEPTION 'account-cutover-export-grants-invalid'; END IF;
  IF has_function_privilege('anon','public.ordax_request_subject_v1()','EXECUTE')
    OR has_function_privilege('authenticated','public.ordax_request_subject_v1()','EXECUTE')
  THEN RAISE EXCEPTION 'account-cutover-subject-bridge-exposed'; END IF;
  IF pg_get_functiondef('public.ordax_account_export_v1()'::regprocedure)
       NOT LIKE '%m.project_id%'
    OR pg_get_functiondef('public.ordax_account_export_v1()'::regprocedure)
       LIKE '%m.project_ref%'
  THEN RAISE EXCEPTION 'account-cutover-memory-project-identity-drift'; END IF;
  IF EXISTS (SELECT 1 FROM auth.users)
  THEN RAISE EXCEPTION 'account-cutover-users-created-during-apply'; END IF;
END;
$proof$;""".strip()
    return (
        "-- Generated exclusively from infra/supabase/product/account_destination_migration_plan.json\n"
        f"-- Destination Supabase project: {project_ref}\n"
        "-- Apply atomically as ONE Supabase migration; this text carries no runtime secrets.\n"
        "BEGIN;\nSET LOCAL lock_timeout='5s';\n"
        + preflight + "\n\n"
        + "\n\n".join(segments) + "\n\n"
        + proof + "\nCOMMIT;\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-ref", required=True)
    args = parser.parse_args(argv)
    try:
        output = render(project_ref=args.project_ref)
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"ACCOUNT_DESTINATION_MIGRATION=BLOCKED {exc}", file=sys.stderr)
        return 1
    sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
