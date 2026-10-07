#!/usr/bin/env python3
"""Generate a sanitized proof of live PostgreSQL privilege boundaries.

Live mode reads ORDAX_CONTROL_PLANE_DATABASE_URL and invokes psql without
putting credentials in argv. Output contains counts/booleans only: never project
refs, DSNs, role passwords, table contents, policy expressions or function bodies.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

SCHEMA = "prototype-ordax.control-plane-privilege-proof/3"

SYNC_USER_RPCS = (
    "ordax_apply_sync_mutation_v1",
    "ordax_apply_sync_mutation_v2",
    "ordax_pull_sync_changes_v1",
    "ordax_list_sync_objects_v1",
    "ordax_sync_snapshot_v1",
    "ordax_sync_snapshot_page_v2",
    "ordax_account_export_v1",
)

SQL = r"""
with ordax_functions as (
  select p.oid, n.nspname, p.proname, p.prosecdef, p.proconfig,
         coalesce(p.proacl, acldefault('f', p.proowner)) as acl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private')
    and p.proname like 'ordax_%'
), auth_writes as (
  select table_schema, table_name, privilege_type
  from information_schema.role_table_grants
  where grantee = 'authenticated'
    and table_schema in ('public','private')
    and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES')
), authenticated_sync_direct_grants as (
  select table_schema, table_name, privilege_type
  from information_schema.role_table_grants
  where grantee = 'authenticated'
    and table_schema = 'private'
    and table_name in ('ordax_sync_objects','ordax_sync_mutations')
), service_sync_direct_grants as (
  select table_schema, table_name, privilege_type
  from information_schema.role_table_grants
  where grantee = 'service_role'
    and table_schema = 'private'
    and table_name in ('ordax_sync_objects','ordax_sync_mutations')
), sync_policies as (
  select policyname, roles
  from pg_policies
  where schemaname = 'private'
    and tablename in ('ordax_sync_objects','ordax_sync_mutations')
), sync_user_rpcs as (
  select f.oid
  from ordax_functions f
  where f.nspname = 'public'
    and f.proname in (
      'ordax_apply_sync_mutation_v1',
      'ordax_apply_sync_mutation_v2',
      'ordax_pull_sync_changes_v1',
      'ordax_list_sync_objects_v1',
      'ordax_sync_snapshot_v1',
      'ordax_sync_snapshot_page_v2',
      'ordax_account_export_v1'
    )
)
select json_build_object(
  'anon_table_grants', (
    select count(*) from information_schema.role_table_grants
    where grantee='anon' and table_schema in ('public','private')
  ),
  'anon_function_execute', (
    select count(*) from ordax_functions f
    where has_function_privilege('anon', f.oid, 'EXECUTE')
  ),
  'public_function_execute', (
    select count(*) from ordax_functions f
    where exists (
      select 1 from aclexplode(f.acl) a
      where a.grantee=0 and a.privilege_type='EXECUTE'
    )
  ),
  'unsafe_security_definer_search_path', (
    select count(*) from ordax_functions f
    where f.prosecdef
      and not ('search_path=""' = any(coalesce(f.proconfig, '{}'::text[])))
  ),
  'anon_private_schema_usage', has_schema_privilege('anon','private','USAGE'),
  'authenticated_private_schema_usage', has_schema_privilege('authenticated','private','USAGE'),
  'private_cloud_storage_rls_enabled_count', (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relname in ('ordax_user_object_provider_refs','ordax_user_upload_reservations')
      and c.relkind = 'r'
      and c.relrowsecurity
  ),
  'authenticated_private_function_execute', (
    select count(*) from ordax_functions f
    where f.nspname='private'
      and has_function_privilege('authenticated', f.oid, 'EXECUTE')
  ),
  'authenticated_sync_table_grants', (
    select count(*) from authenticated_sync_direct_grants
  ),
  'service_role_sync_table_grants', (
    select count(*) from service_sync_direct_grants
  ),
  'sync_policy_count', (
    select count(*) from sync_policies
  ),
  'non_executor_sync_policy_count', (
    select count(*) from sync_policies
    where cardinality(roles) <> 1
       or roles[1]::text <> 'ordax_sync_executor'
  ),
  'service_role_user_sync_rpc_execute', (
    select count(*) from sync_user_rpcs f
    where has_function_privilege('service_role', f.oid, 'EXECUTE')
  ),
  'app_role_sync_sequence_privilege', (
    has_sequence_privilege('anon', 'private.ordax_sync_mutations_change_seq_seq', 'USAGE')
    or has_sequence_privilege('anon', 'private.ordax_sync_mutations_change_seq_seq', 'SELECT')
    or has_sequence_privilege('anon', 'private.ordax_sync_mutations_change_seq_seq', 'UPDATE')
    or has_sequence_privilege('authenticated', 'private.ordax_sync_mutations_change_seq_seq', 'USAGE')
    or has_sequence_privilege('authenticated', 'private.ordax_sync_mutations_change_seq_seq', 'SELECT')
    or has_sequence_privilege('authenticated', 'private.ordax_sync_mutations_change_seq_seq', 'UPDATE')
    or has_sequence_privilege('service_role', 'private.ordax_sync_mutations_change_seq_seq', 'USAGE')
    or has_sequence_privilege('service_role', 'private.ordax_sync_mutations_change_seq_seq', 'SELECT')
    or has_sequence_privilege('service_role', 'private.ordax_sync_mutations_change_seq_seq', 'UPDATE')
  ),
  'unexpected_authenticated_write_grants', coalesce((
    select json_agg(json_build_object(
      'schema', table_schema,
      'table', table_name,
      'privilege', privilege_type
    ) order by table_schema, table_name, privilege_type)
    from auth_writes
  ), '[]'::json)
);
"""


def _as_nonnegative_int(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
    return value


def _as_bool(value: object, name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be boolean")
    return value


def evaluate(observed: object) -> dict:
    if not isinstance(observed, dict):
        raise ValueError("database observation must be an object")

    anon_table_grants = _as_nonnegative_int(observed.get("anon_table_grants"), "anon_table_grants")
    anon_function_execute = _as_nonnegative_int(observed.get("anon_function_execute"), "anon_function_execute")
    public_function_execute = _as_nonnegative_int(observed.get("public_function_execute"), "public_function_execute")
    unsafe_search_path = _as_nonnegative_int(
        observed.get("unsafe_security_definer_search_path"),
        "unsafe_security_definer_search_path",
    )
    private_cloud_storage_rls = _as_nonnegative_int(
        observed.get("private_cloud_storage_rls_enabled_count"),
        "private_cloud_storage_rls_enabled_count",
    )
    private_exec = _as_nonnegative_int(
        observed.get("authenticated_private_function_execute"),
        "authenticated_private_function_execute",
    )
    authenticated_sync_grants = _as_nonnegative_int(
        observed.get("authenticated_sync_table_grants"),
        "authenticated_sync_table_grants",
    )
    service_sync_grants = _as_nonnegative_int(
        observed.get("service_role_sync_table_grants"),
        "service_role_sync_table_grants",
    )
    sync_policy_count = _as_nonnegative_int(observed.get("sync_policy_count"), "sync_policy_count")
    non_executor_policy_count = _as_nonnegative_int(
        observed.get("non_executor_sync_policy_count"),
        "non_executor_sync_policy_count",
    )
    service_rpc_execute = _as_nonnegative_int(
        observed.get("service_role_user_sync_rpc_execute"),
        "service_role_user_sync_rpc_execute",
    )
    anon_private_usage = _as_bool(observed.get("anon_private_schema_usage"), "anon_private_schema_usage")
    auth_private_usage = _as_bool(
        observed.get("authenticated_private_schema_usage"),
        "authenticated_private_schema_usage",
    )
    sequence_exposed = _as_bool(
        observed.get("app_role_sync_sequence_privilege"),
        "app_role_sync_sequence_privilege",
    )
    unexpected = observed.get("unexpected_authenticated_write_grants")
    if not isinstance(unexpected, list):
        raise ValueError("unexpected_authenticated_write_grants must be an array")
    for item in unexpected:
        if not isinstance(item, dict) or set(item) != {"schema", "table", "privilege"}:
            raise ValueError("unexpected authenticated write grant record malformed")

    checks = {
        "no_anon_table_grants": anon_table_grants == 0,
        "no_anon_function_execute": anon_function_execute == 0,
        "no_public_function_execute": public_function_execute == 0,
        "security_definer_search_path": unsafe_search_path == 0,
        "no_anon_private_schema_usage": anon_private_usage is False,
        "private_cloud_storage_rls_enabled": private_cloud_storage_rls == 2,
        "no_authenticated_sync_table_grants": authenticated_sync_grants == 0,
        "no_service_role_sync_table_grants": service_sync_grants == 0,
        "sync_policies_executor_only": sync_policy_count == 5 and non_executor_policy_count == 0,
        "no_service_role_user_sync_rpc_execute": service_rpc_execute == 0,
        "no_app_role_sync_sequence_privilege": sequence_exposed is False,
        "no_unexpected_authenticated_write_grants": len(unexpected) == 0,
        # These two checks deliberately cover the next private-schema hardening
        # gate as well. Until Network/Memory wrappers are migrated safely, the
        # public account release remains fail-closed instead of hiding the debt.
        "no_authenticated_private_schema_usage": auth_private_usage is False,
        "no_authenticated_private_function_execute": private_exec == 0,
    }
    return {
        "$schema": SCHEMA,
        "provider": "supabase-postgres",
        "project_ref": "redacted",
        "checks": checks,
        "observed": {
            "anon_table_grant_count": anon_table_grants,
            "anon_function_execute_count": anon_function_execute,
            "public_function_execute_count": public_function_execute,
            "unsafe_security_definer_search_path_count": unsafe_search_path,
            "anon_private_schema_usage": anon_private_usage,
            "authenticated_private_schema_usage": auth_private_usage,
            "private_cloud_storage_rls_enabled_count": private_cloud_storage_rls,
            "authenticated_private_function_execute_count": private_exec,
            "authenticated_sync_table_grant_count": authenticated_sync_grants,
            "service_role_sync_table_grant_count": service_sync_grants,
            "sync_policy_count": sync_policy_count,
            "non_executor_sync_policy_count": non_executor_policy_count,
            "service_role_user_sync_rpc_execute_count": service_rpc_execute,
            "app_role_sync_sequence_privilege": sequence_exposed,
            "unexpected_authenticated_write_grant_count": len(unexpected),
        },
        "ready": all(checks.values()),
    }


def _libpq_env(database_url: str) -> dict[str, str]:
    parsed = urlparse(database_url)
    if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname or not parsed.path:
        raise ValueError("invalid PostgreSQL connection URL")
    if not parsed.username:
        raise ValueError("database URL must include a user")
    env = os.environ.copy()
    env.update({
        "PGHOST": parsed.hostname,
        "PGPORT": str(parsed.port or 5432),
        "PGDATABASE": unquote(parsed.path.lstrip("/")),
        "PGUSER": unquote(parsed.username),
        "PGSSLMODE": "require",
    })
    if parsed.password is not None:
        env["PGPASSWORD"] = unquote(parsed.password)
    return env


def live_observation(database_url: str) -> object:
    result = subprocess.run(
        ["psql", "-X", "--no-password", "-v", "ON_ERROR_STOP=1", "-At", "-c", SQL],
        env=_libpq_env(database_url),
        text=True,
        capture_output=True,
        check=False,
        timeout=20,
    )
    if result.returncode != 0:
        raise RuntimeError("database privilege probe failed")
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise RuntimeError("database privilege probe returned unexpected output")
    return json.loads(lines[0])


def load_fixture(path: Path) -> object:
    if path.stat().st_size > 64 * 1024:
        raise ValueError("database observation fixture too large")
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--observation-file")
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    try:
        if args.observation_file:
            observed = load_fixture(Path(args.observation_file).resolve())
        else:
            database_url = os.environ.get("ORDAX_CONTROL_PLANE_DATABASE_URL", "").strip()
            if not database_url:
                raise ValueError("ORDAX_CONTROL_PLANE_DATABASE_URL is required for live mode")
            observed = live_observation(database_url)
        proof = evaluate(observed)
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError, subprocess.TimeoutExpired) as exc:
        print(f"CONTROL_PLANE_PRIVILEGE_PROBE=FAIL reason={exc}", file=sys.stderr)
        return 1

    encoded = json.dumps(proof, sort_keys=True, separators=(",", ":")) + "\n"
    if args.output:
        Path(args.output).write_text(encoded, encoding="utf-8")
    else:
        sys.stdout.write(encoded)
    return 0 if proof["ready"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
