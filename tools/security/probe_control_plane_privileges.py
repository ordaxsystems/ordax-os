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
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

# The public Auth provider proof already owns the deterministic, sanitized
# project/commit binding. Reuse it for the database evidence.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "public-site"))
from probe_auth_provider import project_binding, source_commit

SCHEMA = "prototype-ordax.control-plane-privilege-proof/5"
ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "docs/contracts/public-auth-rls-private-helpers.json"


def _load_private_rls_contract() -> dict:
    data = json.loads(CONTRACT.read_text(encoding="utf-8"))
    helpers = data["approved_authenticated_execute"]
    policies = data["approved_public_rls_policy_dependencies"]
    if (
        data["$schema"] != "prototype-ordax.auth-private-rls-helper-contract/1"
        or data["schema"] != "private"
        or data["function_owner"] != "postgres"
        or data["function_security_definer"] is not True
        or data["function_search_path"] != "empty"
        or data["private_schema_data_api_exposure_allowed"] is not False
        or data["anon_or_service_role_execute_approved_helpers_allowed"] is not False
        or len(helpers) != 5
        or len(policies) != 13
    ):
        raise ValueError("private RLS helper contract is not approved")
    if (
        len({tuple(x) for x in helpers}) != len(helpers)
        or len({tuple(x) for x in policies}) != len(policies)
    ):
        raise ValueError("private RLS helper contract contains duplicate authorizations")
    for helper in helpers:
        if (
            len(helper) != 2
            or re.fullmatch(r"ordax_[a-z0-9_]+", helper[0]) is None
            or re.fullmatch(r"(?:|target_[a-z_]+ uuid)", helper[1]) is None
        ):
            raise ValueError("invalid private helper signature")
    for policy in policies:
        if (
            len(policy) != 2
            or any(re.fullmatch(r"ordax_[a-z0-9_]+", item) is None for item in policy)
        ):
            raise ValueError("invalid private helper dependent RLS policy")
    return data


_PRIVATE_RLS = _load_private_rls_contract()
EXPECTED_AUTH_PRIVATE_HELPERS = tuple(tuple(x) for x in _PRIVATE_RLS["approved_authenticated_execute"])
EXPECTED_AUTH_PRIVATE_RLS_POLICIES = tuple(tuple(x) for x in _PRIVATE_RLS["approved_public_rls_policy_dependencies"])


# These are the six RLS policies created by the owner Sync and Account Export
# migrations. The export executor is deliberately distinct from Sync executor.
EXPECTED_SYNC_POLICIES = (
    ("ordax_sync_objects", "ordax_sync_objects_select_own", "ordax_sync_executor"),
    ("ordax_sync_objects", "ordax_sync_objects_insert_own", "ordax_sync_executor"),
    ("ordax_sync_objects", "ordax_sync_objects_update_own", "ordax_sync_executor"),
    ("ordax_sync_mutations", "ordax_sync_mutations_select_own", "ordax_sync_executor"),
    ("ordax_sync_mutations", "ordax_sync_mutations_insert_own", "ordax_sync_executor"),
    ("ordax_sync_objects", "ordax_sync_objects_export_own", "ordax_account_export_executor"),
)


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
  select tablename, policyname, roles
  from pg_policies
  where schemaname = 'private'
    and tablename in ('ordax_sync_objects','ordax_sync_mutations')
), auth_private_helpers as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as identity_args,
         p.prosecdef, p.proconfig, p.proowner::regrole::text as function_owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and has_function_privilege('authenticated',p.oid,'EXECUTE')
), auth_private_policy_dependencies as (
  select p.tablename, p.policyname, p.roles
  from pg_policies p
  where p.schemaname='public'
    and exists (
      select 1 from (
        /* EXACT_PRIVATE_HELPER_NAMES */
      ) a(proname)
      where strpos(
        coalesce(p.qual,'') || coalesce(p.with_check,''),
        'private.' || a.proname || '('
      ) > 0
    )
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
  'authenticated_private_schema_create', has_schema_privilege('authenticated','private','CREATE'),
  'private_cloud_storage_rls_enabled_count', (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relname in ('ordax_user_object_provider_refs','ordax_user_upload_reservations')
      and c.relkind = 'r'
      and c.relrowsecurity
  ),
  'authenticated_private_function_execute', (select count(*) from auth_private_helpers),
  'unexpected_authenticated_private_function_execute', (
    select count(*) from auth_private_helpers f
    where not exists (
      select 1 from (
        /* EXACT_PRIVATE_HELPERS */
      ) approved(proname, identity_args)
      where f.proname=approved.proname and f.identity_args=approved.identity_args
    )
    or f.function_owner <> 'postgres'
    or f.prosecdef is not true
    or not ('search_path=""'=any(coalesce(f.proconfig, '{}'::text[])))
    or has_function_privilege('anon',f.oid,'EXECUTE')
    or has_function_privilege('service_role',f.oid,'EXECUTE')
  ),
  'authenticated_private_rls_dependency_count', (
    select count(*) from auth_private_policy_dependencies
  ),
  'unexpected_authenticated_private_rls_dependency_count', (
    select count(*) from auth_private_policy_dependencies p
    where cardinality(p.roles) <> 1 or p.roles[1]::text <> 'authenticated'
       or not exists (
         select 1 from (
           /* EXACT_PRIVATE_RLS_POLICIES */
         ) approved(tablename, policyname)
         where p.tablename=approved.tablename and p.policyname=approved.policyname
       )
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
  'unexpected_sync_policy_count', (
    select count(*) from sync_policies p
    where cardinality(p.roles) <> 1
       or not exists (
         select 1 from (
           /* EXACT_SYNC_POLICIES */
         ) expected(tablename, policyname, role_name)
         where p.tablename = expected.tablename
           and p.policyname = expected.policyname
           and p.roles[1]::text = expected.role_name
       )
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

# Keep the SQL verification set and the Python assertion bound to one owner.
def _sql_values(rows: tuple[tuple[str, ...], ...]) -> str:
    # All input values are restricted to validated source-controlled identifiers.
    return "values " + ", ".join(
        "(" + ",".join("'" + value + "'" for value in row) + ")" for row in rows
    )


SQL = SQL.replace("/* EXACT_SYNC_POLICIES */", _sql_values(EXPECTED_SYNC_POLICIES))
SQL = SQL.replace("/* EXACT_PRIVATE_HELPERS */", _sql_values(EXPECTED_AUTH_PRIVATE_HELPERS))
SQL = SQL.replace(
    "/* EXACT_PRIVATE_HELPER_NAMES */",
    _sql_values(tuple((name,) for name, _args in EXPECTED_AUTH_PRIVATE_HELPERS)),
)
SQL = SQL.replace(
    "/* EXACT_PRIVATE_RLS_POLICIES */",
    _sql_values(EXPECTED_AUTH_PRIVATE_RLS_POLICIES),
)


def _as_nonnegative_int(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
    return value


def _as_bool(value: object, name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be boolean")
    return value


def evaluate(observed: object, *, project_ref: str | None = None, commit: str | None = None) -> dict:
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
    unexpected_private_exec = _as_nonnegative_int(
        observed.get("unexpected_authenticated_private_function_execute"),
        "unexpected_authenticated_private_function_execute",
    )
    private_policy_count = _as_nonnegative_int(
        observed.get("authenticated_private_rls_dependency_count"),
        "authenticated_private_rls_dependency_count",
    )
    unexpected_private_policies = _as_nonnegative_int(
        observed.get("unexpected_authenticated_private_rls_dependency_count"),
        "unexpected_authenticated_private_rls_dependency_count",
    )
    private_create = _as_bool(
        observed.get("authenticated_private_schema_create"),
        "authenticated_private_schema_create",
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
    unexpected_policy_count = _as_nonnegative_int(
        observed.get("unexpected_sync_policy_count"),
        "unexpected_sync_policy_count",
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
        "sync_policies_executor_only": sync_policy_count == len(EXPECTED_SYNC_POLICIES) and unexpected_policy_count == 0,
        "no_service_role_user_sync_rpc_execute": service_rpc_execute == 0,
        "no_app_role_sync_sequence_privilege": sequence_exposed is False,
        "no_unexpected_authenticated_write_grants": len(unexpected) == 0,
        # These two checks deliberately cover the next private-schema hardening
        # gate as well. Until Network/Memory wrappers are migrated safely, the
        # public account release remains fail-closed instead of hiding the debt.
        "authenticated_private_schema_rls_usage": auth_private_usage is True,
        "no_authenticated_private_schema_create": private_create is False,
        "authenticated_private_helpers_exact": (
            private_exec == len(EXPECTED_AUTH_PRIVATE_HELPERS)
            and unexpected_private_exec == 0
        ),
        "authenticated_private_rls_dependencies_exact": (
            private_policy_count == len(EXPECTED_AUTH_PRIVATE_RLS_POLICIES)
            and unexpected_private_policies == 0
        ),
    }
    return {
        "$schema": SCHEMA,
        "provider": "supabase-postgres",
        "project_ref": "redacted",
        "project_binding": project_binding(project_ref) if project_ref is not None else None,
        "source_commit": source_commit(commit) if commit is not None else None,
        "checks": checks,
        "observed": {
            "anon_table_grant_count": anon_table_grants,
            "anon_function_execute_count": anon_function_execute,
            "public_function_execute_count": public_function_execute,
            "unsafe_security_definer_search_path_count": unsafe_search_path,
            "anon_private_schema_usage": anon_private_usage,
            "authenticated_private_schema_usage": auth_private_usage,
            "authenticated_private_schema_create": private_create,
            "private_cloud_storage_rls_enabled_count": private_cloud_storage_rls,
            "authenticated_private_function_execute_count": private_exec,
            "unexpected_authenticated_private_function_execute_count": unexpected_private_exec,
            "authenticated_private_rls_dependency_count": private_policy_count,
            "unexpected_authenticated_private_rls_dependency_count": unexpected_private_policies,
            "authenticated_sync_table_grant_count": authenticated_sync_grants,
            "service_role_sync_table_grant_count": service_sync_grants,
            "sync_policy_count": sync_policy_count,
            "unexpected_sync_policy_count": unexpected_policy_count,
            "service_role_user_sync_rpc_execute_count": service_rpc_execute,
            "app_role_sync_sequence_privilege": sequence_exposed,
            "unexpected_authenticated_write_grant_count": len(unexpected),
        },
        "ready": all(checks.values()),
    }


def validate_database_target(database_url: str, expected_ref: str) -> None:
    # The project ref is checked against the canonical repo-owned destination.
    # Direct connection: db.<ref>.supabase.co / postgres.
    # Transaction/session pooler: *.pooler.supabase.com / postgres.<ref>.
    project_binding(expected_ref)  # syntax guard for the expected ref
    parsed = urlparse(database_url)
    host = (parsed.hostname or "").lower()
    user = unquote(parsed.username or "")
    direct = host == f"db.{expected_ref}.supabase.co" and user == "postgres"
    pooler = host.endswith(".pooler.supabase.com") and user == f"postgres.{expected_ref}"
    if not (direct or pooler):
        raise ValueError("database-connection-project-does-not-match-canonical-destination")


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
            hardening = json.loads(
                (Path(__file__).resolve().parents[2] / "docs/contracts/public-auth-hardening.json")
                .read_text(encoding="utf-8")
            )
            expected_ref = hardening["postgresql_destination"]["project_ref"]
            requested_ref = os.environ.get("SUPABASE_PROJECT_REF", "").strip()
            if expected_ref != requested_ref:
                raise ValueError("database-project-does-not-match-canonical-destination")
            validate_database_target(database_url, requested_ref)
            commit = source_commit(os.environ.get("GITHUB_SHA", "").strip())
            observed = live_observation(database_url)
        proof = evaluate(
            observed,
            project_ref=requested_ref if not args.observation_file else None,
            commit=commit if not args.observation_file else None,
        )
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
