from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
ADMISSION = ROOT / "infra" / "supabase" / "functions" / "_shared" / "account_transport_admission.mjs"
NATIVE = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
PY_GATEWAY = ROOT / "services" / "public-identity" / "gateway.py"
PY_ACCOUNT = ROOT / "services" / "public-identity" / "supabase_account.py"


class SpaceMembersReadSourceTests(unittest.TestCase):
    def test_edge_route_uses_authenticated_rls_scoped_table_read(self):
        source = EDGE.read_text(encoding="utf-8")
        self.assertIn('path === "/account/space-members"', source)
        self.assertIn('.from("ordax_space_members")', source)
        self.assertIn('.select("space_id,user_id,role,state")', source)
        self.assertIn('.eq("space_id", membersRequest.spaceId)', source)
        self.assertIn('.order("user_id", { ascending: true })', source)
        self.assertIn('projectSpaceMembersPage(membersResult.data, membersRequest.spaceId)', source)

        start = source.index('if (path === "/account/space-members")')
        end = source.index('if (path === "/account/entitlements/memory-cloud")', start)
        route = source[start:end]
        self.assertNotIn("accountAdminRpc", route)
        self.assertNotIn("service_role", route)
        self.assertNotIn("owner_user_id", route)

    def test_members_route_is_not_promoted_to_public_bridge_yet(self):
        admission = ADMISSION.read_text(encoding="utf-8")
        self.assertNotIn('["/account/space-members",', admission)

    def test_provider_neutral_python_gateway_keeps_the_same_rls_boundary(self):
        gateway = PY_GATEWAY.read_text(encoding="utf-8")
        provider = PY_ACCOUNT.read_text(encoding="utf-8")
        self.assertIn('if path == "/account/space-members":', gateway)
        self.assertIn("self.account_provider.list_space_members(", gateway)
        self.assertIn('"/rest/v1/ordax_space_members"', provider)
        self.assertIn('"Authorization": f"Bearer {access_token}"', provider)
        self.assertIn('"?select=space_id,user_id,role,state"', provider)
        self.assertIn('f"&space_id=eq.{space_id}"', provider)
        self.assertIn('"&order=user_id.asc"', provider)
        self.assertNotIn("service_role", provider.lower())

    def test_native_loopback_proxies_exact_members_route(self):
        source = NATIVE.read_text(encoding="utf-8")
        self.assertIn('ACCOUNT_SPACE_MEMBERS_PATH = "/account/space-members"', source)
        self.assertIn('self.server.account_gateway.space_members(urlsplit(self.path).query)', source)
        account_set = re.search(r"if parsed_path in \{ACCOUNT_SESSION_PATH,[^\n]+\}:", source)
        self.assertIsNotNone(account_set)
        self.assertIn("ACCOUNT_SPACE_MEMBERS_PATH", account_set.group(0))


if __name__ == "__main__":
    unittest.main()
