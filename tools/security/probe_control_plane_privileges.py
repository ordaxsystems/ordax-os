#!/usr/bin/env python3
"""Generate a sanitized proof of live PostgreSQL privilege boundaries.

Live mode reads ORDAX_CONTROL_PLANE_DATABASE_URL, maps it to libpq environment
variables, and invokes psql without putting credentials in argv. A JSON fixture
mode exists only for deterministic CI tests. Output never contains the project
ref, DSN, role password, table contents, policy expressions, or function bodies.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

SCHEMA = "prototype-ordax.control-plane-privilege-proof/1"
ALLOWED_AUTHENTICATED_WRITES = {
    ("private", "ordax_sync_mutations", "INSERT"),
    ("private", "ordax_sync_objects", "INSERT"),
    ("private", "ordax_sync_objects", "UPDATE"),
}

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
), unexpected_auth_writes as (
  select * from auth_writes
  where not (
    (table_schema='private' and table_name='ordax_sync_mutations' and privilege_type='INSERT')
    or (table_schema='private' and table_name='ordax_sync_objects' and privilege_type in ('INSERT','UPDATE'))
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
  'unexpected_authenticated_write_grants', coalesce((
    select json_agg(json_build_object(
      'schema', table_schema,
      'table', table_name,
      'privilege', privilege_type
    ) order by table_schema, table_name, privilege_type)
    from unexpected_auth_writes
  ), '[]'::json),
  'allowed_authenticated_write_grants_present', (
    select count(*) from auth_writes
    where (table_schema, table_name, privilege_type) in (
      ('private','ordax_sync_mutations','INSERT'),
      ('private','ordax_sync_objects','INSERT'),
      ('private','ordax_sync_objects','UPDATE')
    )
  )
);
"""


def _as_nonnegative_int(value: object, name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
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
    allowed_writes = _as_nonnegative_int(
        observed.get("allowed_authenticated_write_grants_present"),
        "allowed_authenticated_write_grants_present",
    )
    unexpected = observed.get("unexpected_authenticated_write_grants")
    if not isinstance(unexpected, list):
        raise ValueError("unexpected_authenticated_write_grants must be an array")
    for item in unexpected:
        if not isinstance(item, dict) or set(item) != {"schema", "table", "privilege"}:
            raise ValueError("unexpected authenticated write grant record malformed")
    anon_private_usage = observed.get("anon_private_schema_usage")
    if not isinstance(anon_private_usage, bool):
        raise ValueError("anon_private_schema_usage must be boolean")

    checks = {
        "no_anon_table_grants": anon_table_grants == 0,
        "no_anon_function_execute": anon_function_execute == 0,
        "no_public_function_execute": public_function_execute == 0,
        "security_definer_search_path": unsafe_search_path == 0,
        "no_anon_private_schema_usage": anon_private_usage is False,
        "authenticated_write_allowlist": len(unexpected) == 0 and allowed_writes == len(ALLOWED_AUTHENTICATED_WRITES),
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
            "unexpected_authenticated_write_grant_count": len(unexpected),
            "allowed_authenticated_write_grant_count": allowed_writes,
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
    env.update(
        {
            "PGHOST": parsed.hostname,
            "PGPORT": str(parsed.port or 5432),
            "PGDATABASE": unquote(parsed.path.lstrip("/")),
            "PGUSER": unquote(parsed.username),
            "PGSSLMODE": "require",
        }
    )
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
