#!/usr/bin/env python3
"""Operator-only runner for authenticated Cloud Memory proofs.

Flow:
1. authenticate the dedicated proof account only to resolve its Supabase subject;
2. issue one short-lived proof-only entitlement through the private operator RPC
   using direct PostgreSQL operator access;
3. execute the existing two-client atomic proof;
4. execute the bidirectional + fresh-session restore proof under the same grant;
5. revoke the exact temporary grant in a finally block.

No service-role key is accepted or used. PostgreSQL credentials stay in the
standard PG* environment variables consumed by psql and are never written to
receipts or command-line arguments by this runner.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from typing import NoReturn

ROOT = Path(__file__).resolve().parents[2]
IDENTITY_DIR = ROOT / "services" / "public-identity"
sys.path.insert(0, str(IDENTITY_DIR))

from supabase_password import SupabasePasswordProvider  # noqa: E402

SHA40 = re.compile(r"^[0-9a-f]{40}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


def fail(reason: str) -> NoReturn:
    raise SystemExit(f"CLOUD_MEMORY_OPERATOR_PROOF=FAIL reason={reason}")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        fail(f"missing-{name.lower()}")
    return value


def validate_operator_env() -> None:
    for name in ("PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"):
        required_env(name)
    if os.environ.get("PGSSLMODE", "require").strip() not in {"require", "verify-ca", "verify-full"}:
        fail("pgsslmode-must-require-tls-or-stronger")
    if shutil.which("psql") is None:
        fail("psql-not-found")


def run_psql(sql: str) -> str:
    env = dict(os.environ)
    env.setdefault("PGSSLMODE", "require")
    env.setdefault("PGCONNECT_TIMEOUT", "15")
    result = subprocess.run(
        [
            "psql",
            "--no-psqlrc",
            "--set",
            "ON_ERROR_STOP=1",
            "--tuples-only",
            "--no-align",
            "--quiet",
        ],
        input=sql.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
        timeout=30,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace").strip()
        safe = stderr.splitlines()[-1] if stderr else f"exit-{result.returncode}"
        raise RuntimeError(f"psql-failed:{safe[:240]}")
    return result.stdout.decode("utf-8", errors="strict").strip()


def issue_grant(user_id: str, ttl_seconds: int, reason: str, source_commit: str) -> str:
    if UUID.fullmatch(user_id) is None:
        raise ValueError("subject id is invalid")
    if ttl_seconds < 300 or ttl_seconds > 1800:
        raise ValueError("ttl must be between 300 and 1800 seconds")
    if len(reason) < 8 or len(reason) > 240 or "\x00" in reason:
        raise ValueError("reason is invalid")
    if SHA40.fullmatch(source_commit) is None:
        raise ValueError("source commit is invalid")
    # Inputs are passed through psql variables and quoted server-side with :'name'.
    sql = f"""\\set user_id '{user_id}'
\\set ttl '{ttl_seconds}'
\\set reason '{reason.replace("'", "''")}'
\\set source_commit '{source_commit}'
select grant_id::text
from private.ordax_issue_cloud_memory_proof_entitlement_v1(
  :'user_id'::uuid,
  :'ttl'::integer,
  :'reason'::text,
  :'source_commit'::text
);
"""
    grant_id = run_psql(sql).splitlines()[-1].strip()
    if UUID.fullmatch(grant_id) is None:
        raise RuntimeError("operator issue returned invalid grant id")
    return grant_id


def revoke_grant(grant_id: str, reason: str, source_commit: str) -> None:
    if UUID.fullmatch(grant_id) is None or SHA40.fullmatch(source_commit) is None:
        raise ValueError("revoke identity is invalid")
    sql = f"""\\set grant_id '{grant_id}'
\\set reason '{reason.replace("'", "''")}'
\\set source_commit '{source_commit}'
select grant_id::text
from private.ordax_revoke_cloud_memory_proof_entitlement_v1(
  :'grant_id'::uuid,
  :'reason'::text,
  :'source_commit'::text
);
"""
    returned = run_psql(sql).splitlines()[-1].strip()
    if returned.lower() != grant_id.lower():
        raise RuntimeError("operator revoke returned unexpected grant id")


def run_proof_body(script_name: str, env: dict[str, str], label: str) -> int:
    result = subprocess.run(
        [sys.executable, str(ROOT / f"tools/cloud-memory/{script_name}")],
        env=env,
        check=False,
        timeout=180,
    )
    if result.returncode != 0:
        print(f"CLOUD_MEMORY_OPERATOR_{label}=FAIL", file=sys.stderr)
    else:
        print(f"CLOUD_MEMORY_OPERATOR_{label}=PASS")
    return result.returncode


def main() -> int:
    validate_operator_env()
    project_url = required_env("ORDAX_SUPABASE_URL")
    publishable_key = required_env("ORDAX_SUPABASE_PUBLISHABLE_KEY")
    email = required_env("ORDAX_MEMORY_PROOF_ACCOUNT_EMAIL")
    password = required_env("ORDAX_MEMORY_PROOF_ACCOUNT_PASSWORD")
    source_commit = required_env("ORDAX_MEMORY_PROOF_SOURCE_COMMIT").lower()
    if SHA40.fullmatch(source_commit) is None:
        fail("invalid-source-commit")
    try:
        ttl_seconds = int(os.environ.get("ORDAX_MEMORY_PROOF_ENTITLEMENT_TTL_SECONDS", "600"))
    except ValueError:
        fail("invalid-entitlement-ttl")
    if ttl_seconds < 300 or ttl_seconds > 1800:
        fail("invalid-entitlement-ttl")

    identity = SupabasePasswordProvider(project_url, publishable_key)
    bootstrap_token: str | None = None
    grant_id: str | None = None
    proof_status = 1

    try:
        auth = identity.sign_in_with_password(email, password)
        if auth.session is None or UUID.fullmatch(auth.subject_id or "") is None:
            fail("proof-account-auth-invalid")
        subject_id = auth.subject_id
        bootstrap_token = auth.session.access_token
        # This session exists only to resolve the server-issued subject. It is
        # deliberately ended before the independent proof sessions begin.
        identity.sign_out(bootstrap_token)
        bootstrap_token = None

        grant_id = issue_grant(
            subject_id,
            ttl_seconds,
            "cloud Memory authenticated bidirectional restore proof",
            source_commit,
        )
        print("CLOUD_MEMORY_OPERATOR_ENTITLEMENT=ISSUED_TEMPORARY")
        env = dict(os.environ)
        env["GITHUB_SHA"] = source_commit

        proof_status = run_proof_body(
            "prove_authenticated_atomic_sync.py",
            env,
            "ATOMIC_BODY",
        )
        if proof_status != 0:
            return proof_status

        proof_status = run_proof_body(
            "prove_authenticated_bidirectional_restore.py",
            env,
            "BIDIRECTIONAL_RESTORE_BODY",
        )
        return proof_status
    finally:
        if bootstrap_token is not None:
            try:
                identity.sign_out(bootstrap_token)
            except Exception:
                print("CLOUD_MEMORY_OPERATOR_BOOTSTRAP_SIGNOUT=FAIL", file=sys.stderr)
        if grant_id is not None:
            try:
                revoke_grant(
                    grant_id,
                    "cloud Memory authenticated bidirectional restore proof complete",
                    source_commit,
                )
                print("CLOUD_MEMORY_OPERATOR_ENTITLEMENT=REVOKED")
            except Exception as exc:
                print(
                    f"CLOUD_MEMORY_OPERATOR_ENTITLEMENT_REVOKE=FAIL type={type(exc).__name__}",
                    file=sys.stderr,
                )
                if proof_status == 0:
                    raise


if __name__ == "__main__":
    raise SystemExit(main())
