from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra/supabase/product/migrations/20261017102000_space_members_read_authority_v1.sql"


def source() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_members_read_is_bounded_and_uses_canonical_authority():
    sql = source()
    assert "create or replace function public.ordax_list_space_members_v1" in sql
    assert "security definer" in sql
    assert "set search_path = ''" in sql
    assert "ordax_policy.can_access_space(p_space_id)" in sql
    assert "p_limit < 1 or p_limit > 128" in sql
    assert "order by m.user_id asc" in sql
    assert "p_after_user_id is null or m.user_id > p_after_user_id" in sql


def test_members_read_exposes_no_mutation_and_is_authenticated_only():
    sql = source()
    body = re.search(
        r"create or replace function public\.ordax_list_space_members_v1.*?\$\$;(.*?)commit;",
        sql,
        re.S | re.I,
    )
    assert body is not None
    lowered = body.group(0).lower()
    for forbidden in ("insert into public.ordax_space_members", "update public.ordax_space_members", "delete from public.ordax_space_members"):
        assert forbidden not in lowered
    assert "revoke all on function public.ordax_list_space_members_v1(uuid, uuid, integer)" in lowered
    assert "from public, anon, authenticated, service_role" in lowered
    assert "grant execute on function public.ordax_list_space_members_v1(uuid, uuid, integer)" in lowered
    assert "to authenticated" in lowered


def test_members_read_returns_only_contract_fields():
    sql = source().lower()
    match = re.search(r"returns table\s*\((.*?)\)\s*language", sql, re.S)
    assert match is not None
    fields = [line.strip().split()[0].rstrip(",") for line in match.group(1).splitlines() if line.strip()]
    assert fields == ["space_id", "user_id", "role", "state"]
