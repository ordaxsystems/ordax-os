import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "0001_product_foundation.sql"
SEMANTICS_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261015153000_space_semantics_v1.sql"
SEMANTICS_WRITE_GUARD = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261015195800_space_semantics_write_guard_v1.sql"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "spaces.mjs"
NATIVE_HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
TRANSPORT = ROOT / "infra" / "supabase" / "functions" / "_shared" / "account_transport_admission.mjs"


def exact_route_block(source: str, route_start: str) -> str:
    start = source.index(route_start)
    next_route = source.find('\n  if (path === "', start + len(route_start))
    if next_route < 0:
        raise AssertionError(f"route following {route_start!r} was not found")
    return source[start:next_route]


class AccountSpacesSourceTests(unittest.TestCase):
    def test_edge_route_is_read_only_bounded_and_user_session_scoped(self):
        source = EDGE.read_text(encoding="utf-8")
        self.assertIn('const MAX_VISIBLE_SPACES = 64;', source)
        self.assertIn('path === "/account/spaces" && req.method === "GET"', source)
        self.assertIn('const session = await authenticated(req);', source)
        self.assertIn('.from("ordax_spaces")', source)
        self.assertIn('.from("ordax_space_profile_packs")', source)
        self.assertIn('.select("space_id,owner_user_id,name,kind,state,domain,subtype")', source)
        self.assertIn("SPACE_SEMANTIC_IDENTIFIER", source)
        self.assertIn('.limit(MAX_VISIBLE_SPACES + 1)', source)
        self.assertIn('version: 17', source)

        route = exact_route_block(
            source,
            'if (path === "/account/spaces" && req.method === "GET")',
        )
        for forbidden in (".insert(", ".update(", ".delete(", ".upsert(", ".rpc("):
            self.assertNotIn(forbidden, route)

    def test_public_web_spaces_is_only_pre_activation_account_capability(self):
        source = EDGE.read_text(encoding="utf-8")
        transport = TRANSPORT.read_text(encoding="utf-8")
        self.assertIn("isPublicAccountPreActivationRoute", source)
        self.assertIn("&& !isPublicAccountPreActivationRoute(req.method, path)", source)
        self.assertIn('["/account/spaces", Object.freeze({ method: "GET", preActivation: true })]', transport)
        self.assertIn('["/account/export", Object.freeze({ method: "GET", preActivation: false })]', transport)
        self.assertIn('["/account/entitlements/memory-cloud", Object.freeze({ method: "GET", preActivation: false })]', transport)
        self.assertIn('["/account/close", Object.freeze({ method: "POST", preActivation: false })]', transport)
        self.assertNotIn('"GET /account/spaces"', source)

    def test_supabase_rls_limits_spaces_to_owner_or_active_member(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create policy ordax_spaces_select_member", sql)
        self.assertIn("using (private.ordax_can_access_space(space_id))", sql)
        self.assertIn("m.user_id = (select auth.uid())", sql)
        self.assertIn("m.state = 'active'", sql)
        self.assertIn("s.owner_user_id = (select auth.uid())", sql)

    def test_space_semantics_migration_is_additive_paired_and_exported(self):
        sql = SEMANTICS_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("add column domain text", sql)
        self.assertIn("add column subtype text", sql)
        self.assertIn("ordax_spaces_semantic_pair_chk", sql)
        self.assertIn("ordax_spaces_domain_chk", sql)
        self.assertIn("ordax_spaces_subtype_chk", sql)
        self.assertIn("'domain', s.domain", sql)
        self.assertIn("'subtype', s.subtype", sql)
        self.assertIn("select public.ordax_request_subject_v1() as user_id", sql)
        self.assertIn("security definer", sql)
        self.assertIn("owner to ordax_account_export_executor", sql)
        self.assertIn("revoke all on function public.ordax_account_export_v1()", sql)
        self.assertIn("grant execute on function public.ordax_account_export_v1() to authenticated", sql)
        self.assertNotIn("update public.ordax_spaces", sql)
        self.assertNotIn("insert into public.ordax_spaces", sql)

    def test_space_semantics_write_guard_preserves_legacy_but_requires_canonical_new_rows(self):
        sql = SEMANTICS_WRITE_GUARD.read_text(encoding="utf-8").lower()
        self.assertIn("create or replace function private.ordax_enforce_space_semantics_write_v1()", sql)
        self.assertIn("if tg_op = 'insert'", sql)
        self.assertIn("new.domain is null or new.subtype is null", sql)
        self.assertIn("errcode = '23514'", sql)
        self.assertIn("from public, anon, authenticated, service_role;", sql)
        self.assertIn("before insert or update of domain, subtype on public.ordax_spaces", sql)
        self.assertIn("old.domain is not null", sql)
        self.assertIn("old.subtype is not null", sql)
        self.assertIn("canonical semantics cannot regress to legacy nulls", sql)
        self.assertNotIn("update public.ordax_spaces", sql)
        self.assertNotIn("delete from public.ordax_spaces", sql)
        self.assertNotIn("insert into public.ordax_spaces", sql)

    def test_surface_and_native_use_only_ordax_account_boundary(self):
        adapter = WEB_ADAPTER.read_text(encoding="utf-8")
        native = NATIVE_HOST.read_text(encoding="utf-8")
        self.assertIn('const reader = createWebJsonReader(windowRef);', adapter)
        self.assertIn('reader.read("/account/spaces")', adapter)
        self.assertNotIn('windowRef.fetch("/account/spaces"', adapter)
        self.assertNotIn("supabase", adapter.lower())
        self.assertIn('ACCOUNT_SPACES_PATH = "/account/spaces"', native)
        self.assertIn("self.server.account_gateway.spaces()", native)


if __name__ == "__main__":
    unittest.main()
