#!/usr/bin/env python3
"""Render one *opt-in*, transactionally guarded Storage + Quota destination migration.

This script NEVER connects to a database. Historical SQL files remain the only
business-logic owners; one RLS predicate is adapted to the current Account
authorization chain. Preview output ends with ROLLBACK by default.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = ROOT / "infra/supabase/product/migrations"
AUTH = ROOT / "docs/contracts/public-auth-hardening.json"
STORAGE = ROOT / "docs/contracts/user-cloud-storage.json"
QUOTA = ROOT / "docs/contracts/service-quotas.json"

SOURCES = (
    "20261007050000_service_quota_ledger_v1.sql",
    "20261007083105_service_quota_usage_reduction_v1.sql",
    "20261005171000_user_cloud_storage_foundation_v2.sql",
    "20261007015500_user_cloud_storage_private_rls_hardening_v1.sql",
    "20261007083746_user_cloud_storage_quota_reservation_link_v1.sql",
)
TRANSACTION_BEGIN = re.compile(r"(?im)^begin;\s*$")
TRANSACTION_COMMIT = re.compile(r"(?im)^commit;\s*$")

# Only this policy body may be rewritten: the destination requires both a
# verified Account session and its reviewed private Space membership helper.
LEGACY_POLICY = """using (
  (space_id is null and owner_user_id = (select auth.uid()))
  or (space_id is not null and ordax_policy.can_access_space(space_id))
);"""
DESTINATION_POLICY = """using (
  (select private.ordax_authenticated_subject_eligible_v1())
  and (
    (space_id is null and owner_user_id = (select auth.uid()))
    or (space_id is not null and private.ordax_can_access_space(space_id))
  )
);"""


def _source(name: str) -> str:
    sql = (MIGRATIONS / name).read_text(encoding="utf-8")
    if (
        [item.strip().lower() for item in TRANSACTION_BEGIN.findall(sql)] != ["begin;"]
        or [item.strip().lower() for item in TRANSACTION_COMMIT.findall(sql)] != ["commit;"]
        or re.search(r"(?m)^\s*\\(?:i|include)\b", sql)
    ):
        raise ValueError("storage-source-transaction-incompatible:" + name)
    sql = TRANSACTION_BEGIN.sub("", sql, count=1)
    return TRANSACTION_COMMIT.sub("", sql, count=1).strip()


PREFLIGHT = """
DO $ordax_preflight$
BEGIN
  -- A populated user database is EXPECTED. A partial storage installation is not.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ordax:storage-quota-destination-foundation:1',0)
  );
  IF to_regclass('auth.users') IS NULL
     OR to_regclass('public.ordax_spaces') IS NULL
     OR to_regclass('public.ordax_entitlement_grants') IS NULL
     OR to_regnamespace('private') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('private.ordax_touch_updated_at()') IS NULL
     OR to_regprocedure('private.ordax_authenticated_subject_eligible_v1()') IS NULL
     OR to_regprocedure('private.ordax_can_access_space(uuid)') IS NULL
  THEN RAISE EXCEPTION 'storage-destination-prerequisite-missing'; END IF;
  IF to_regnamespace('ordax_policy') IS NOT NULL
  THEN RAISE EXCEPTION 'storage-destination-legacy-policy-owner-drift'; END IF;

  IF to_regclass('public.ordax_user_objects') IS NOT NULL
     OR to_regclass('private.ordax_user_object_provider_refs') IS NOT NULL
     OR to_regclass('private.ordax_user_upload_reservations') IS NOT NULL
     OR to_regclass('private.ordax_service_quota_usage') IS NOT NULL
     OR to_regclass('private.ordax_service_quota_reservations') IS NOT NULL
     OR to_regprocedure('private.ordax_reserve_service_quota_v1(uuid,uuid,text,text,bigint,text,integer)') IS NOT NULL
     OR to_regprocedure('private.ordax_reduce_service_quota_usage_v1(uuid,uuid,text,text,bigint)') IS NOT NULL
     OR to_regprocedure('public.ordax_service_quota_usage_status_v1(uuid,uuid,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'storage-destination-partial-or-previous-install'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users)
  THEN RAISE EXCEPTION 'storage-destination-populated-user-guard-failed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')
     OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')
     OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role')
  THEN RAISE EXCEPTION 'storage-destination-api-roles-missing'; END IF;
END;
$ordax_preflight$;""".strip()

POSTFLIGHT = """
DO $ordax_postflight$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'public.ordax_user_objects',
    'private.ordax_user_object_provider_refs',
    'private.ordax_user_upload_reservations',
    'private.ordax_service_quota_usage',
    'private.ordax_service_quota_reservations'
  ] LOOP
    IF to_regclass(target_table) IS NULL
       OR NOT EXISTS (
          SELECT 1 FROM pg_class
          WHERE oid=to_regclass(target_table) AND relrowsecurity
       )
    THEN RAISE EXCEPTION 'storage-destination-rls-or-table-missing:%',target_table;
    END IF;
    IF has_table_privilege('anon',target_table,'SELECT')
       OR has_table_privilege('authenticated',target_table,'INSERT')
       OR has_table_privilege('authenticated',target_table,'UPDATE')
       OR has_table_privilege('authenticated',target_table,'DELETE')
       OR has_table_privilege('service_role',target_table,'INSERT')
       OR has_table_privilege('service_role',target_table,'UPDATE')
       OR has_table_privilege('service_role',target_table,'DELETE')
    THEN RAISE EXCEPTION 'storage-destination-direct-mutation-privilege:%',target_table;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated','public.ordax_user_objects','SELECT')
  THEN RAISE EXCEPTION 'storage-destination-metadata-read-missing'; END IF;
  IF has_table_privilege('authenticated','private.ordax_user_upload_reservations','SELECT')
     OR has_table_privilege('service_role','private.ordax_user_upload_reservations','SELECT')
     OR has_table_privilege('authenticated','private.ordax_user_object_provider_refs','SELECT')
  THEN RAISE EXCEPTION 'storage-destination-private-provider-data-exposed'; END IF;
  IF NOT EXISTS(
     SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='ordax_user_objects'
       AND policyname='ordax_user_objects_select_authorized'
       AND roles=ARRAY['authenticated']::name[]
       AND qual LIKE '%private.ordax_authenticated_subject_eligible_v1()%'
       AND qual LIKE '%private.ordax_can_access_space(space_id)%'
  ) THEN RAISE EXCEPTION 'storage-destination-session-space-policy-drift'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='private' AND table_name='ordax_user_upload_reservations'
      AND column_name='quota_reservation_id' AND is_nullable='NO'
  ) THEN RAISE EXCEPTION 'storage-destination-quota-reservation-link-missing'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conname='ordax_user_upload_reservations_quota_reservation_id_fkey'
      AND contype='f' AND convalidated
  ) THEN RAISE EXCEPTION 'storage-destination-quota-link-fk-missing'; END IF;
  IF has_function_privilege('authenticated',
      'private.ordax_reserve_service_quota_v1(uuid,uuid,text,text,bigint,text,integer)','EXECUTE')
     OR has_function_privilege('anon',
      'private.ordax_reserve_service_quota_v1(uuid,uuid,text,text,bigint,text,integer)','EXECUTE')
     OR has_function_privilege('service_role',
      'private.ordax_reserve_service_quota_v1(uuid,uuid,text,text,bigint,text,integer)','EXECUTE')
  THEN RAISE EXCEPTION 'storage-destination-private-quota-helper-exposed'; END IF;
END;
$ordax_postflight$;""".strip()


def render(*, project_ref: str, commit: bool = False) -> str:
    auth = json.loads(AUTH.read_text(encoding="utf-8"))
    storage = json.loads(STORAGE.read_text(encoding="utf-8"))
    quota = json.loads(QUOTA.read_text(encoding="utf-8"))
    target = auth.get("postgresql_destination", {})
    if (
        target.get("project_ref") != project_ref
        or target.get("existing_auth_users_observed") is not True
        or target.get("public_registration_enabled") is not False
        or target.get("public_login_enabled") is not False
        or target.get("functional_provider_cutover_complete") is not False
        or target.get("parallel_identity_write_enabled") is not False
        or storage.get("deployment", {}).get("target_project_ref") != project_ref
        or quota.get("server_ledger", {}).get("target_project_ref") != project_ref
        or storage["deployment"]["transactional_schema_deployed"] is not False
        or quota["server_ledger"]["production_applied"] is not False
        or storage["deployment"]["replay_historical_migrations_unmodified_allowed"] is not False
        or quota["server_ledger"]["replay_historical_migrations_unmodified_allowed"] is not False
        or storage["deployment"]["legacy_rls_policy_schema_dependency_present"] is not False
        or storage["deployment"]["legacy_rls_policy_must_be_reconciled_before_installation"] is not True
    ):
        raise ValueError("storage-destination-owner-or-activation-gate-drift")
    parts = []
    for name in SOURCES:
        body = _source(name)
        if name == "20261005171000_user_cloud_storage_foundation_v2.sql":
            if body.count(LEGACY_POLICY) != 1:
                raise ValueError("storage-destination-rls-policy-source-drift")
            body = body.replace(LEGACY_POLICY, DESTINATION_POLICY)
        parts.append("-- SOURCE " + name + "\n" + body)
    return (
        "-- Generated from five canonical owner migrations (NO duplicate ledger).\n"
        "-- Target ref: " + project_ref + "; VERIFY your connection outside this artifact.\n"
        "-- Output is SQL text only; this command NEVER connects to PostgreSQL.\n"
        + ("-- EXPLICIT COMMIT BUNDLE: deploy ONLY after reviewed staging evidence.\n"
           if commit else "-- DEFAULT NON-PERSISTENT PROOF: explicit ROLLBACK.\n")
        + "BEGIN;\nSET LOCAL lock_timeout='5s';\n"
        + PREFLIGHT + "\n\n"
        + "\n\n".join(parts) + "\n\n"
        + POSTFLIGHT + "\n"
        + ("COMMIT;\n" if commit else "ROLLBACK;\n")
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-ref", required=True)
    parser.add_argument("--emit-commit-sql", action="store_true")
    parser.add_argument("--confirm-destination", default="")
    args = parser.parse_args(argv)
    try:
        if args.emit_commit_sql and args.confirm_destination != args.project_ref:
            raise ValueError("storage-destination-commit-output-requires-explicit-target")
        print(render(project_ref=args.project_ref, commit=args.emit_commit_sql), end="")
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print("STORAGE_DESTINATION_MIGRATION=BLOCKED " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
