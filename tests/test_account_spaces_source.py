import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "0001_product_foundation.sql"
WEB_ADAPTER = ROOT / "system" / "adapters" / "web" / "spaces.mjs"
NATIVE_HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"


class AccountSpacesSourceTests(unittest.TestCase):
    def test_edge_route_is_read_only_bounded_and_user_session_scoped(self):
        source = EDGE.read_text(encoding="utf-8")
        self.assertIn('const MAX_VISIBLE_SPACES = 64;', source)
        self.assertIn('path === "/account/spaces" && req.method === "GET"', source)
        self.assertIn('const session = await authenticated(req);', source)
        self.assertIn('.from("ordax_spaces")', source)
        self.assertIn('.from("ordax_space_profile_packs")', source)
        self.assertIn('.limit(MAX_VISIBLE_SPACES + 1)', source)
        self.assertIn('version: 14', source)

        start = source.index('if (path === "/account/spaces" && req.method === "GET")')
        end = source.index('if (path === "/sync/snapshot"', start)
        route = source[start:end]
        for forbidden in (".insert(", ".update(", ".delete(", ".upsert(", ".rpc("):
            self.assertNotIn(forbidden, route)

    def test_supabase_rls_limits_spaces_to_owner_or_active_member(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create policy ordax_spaces_select_member", sql)
        self.assertIn("using (private.ordax_can_access_space(space_id))", sql)
        self.assertIn("m.user_id = (select auth.uid())", sql)
        self.assertIn("m.state = 'active'", sql)
        self.assertIn("s.owner_user_id = (select auth.uid())", sql)

    def test_surface_and_native_use_only_ordax_account_boundary(self):
        adapter = WEB_ADAPTER.read_text(encoding="utf-8")
        native = NATIVE_HOST.read_text(encoding="utf-8")
        self.assertIn('windowRef.fetch("/account/spaces"', adapter)
        self.assertNotIn("supabase", adapter.lower())
        self.assertIn('ACCOUNT_SPACES_PATH = "/account/spaces"', native)
        self.assertIn("self.server.account_gateway.spaces()", native)


if __name__ == "__main__":
    unittest.main()
