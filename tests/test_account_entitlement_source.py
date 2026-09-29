import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "0001_product_foundation.sql"
HARDENING = ROOT / "infra" / "supabase" / "product" / "migrations" / "0004_server_authoritative_mutations.sql"
ADAPTER = ROOT / "system" / "adapters" / "web" / "entitlements.mjs"
NATIVE_HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"


class AccountEntitlementSourceTests(unittest.TestCase):
    def test_gateway_entitlement_route_is_read_only_session_bound_and_narrow(self):
        source = EDGE.read_text(encoding="utf-8")
        self.assertIn('const ACCOUNT_ENTITLEMENT_KEYS = new Set(["memory.cloud.enabled"]);', source)
        self.assertIn('path === "/account/entitlement" && req.method === "GET"', source)
        self.assertIn('.from("ordax_entitlement_grants")', source)
        self.assertIn('.eq("user_id", session.user.id)', source)
        self.assertIn('.eq("entitlement_key", key)', source)
        self.assertIn('.limit(17)', source)
        self.assertIn('data.length > 16', source)
        self.assertIn('authority: "server"', source)
        start = source.index('if (path === "/account/entitlement" && req.method === "GET")')
        end = source.index('if (path === "/account/spaces"', start)
        route = source[start:end]
        self.assertNotIn("service_role", route.lower())
        self.assertNotIn(".insert(", route)
        self.assertNotIn(".update(", route)
        self.assertNotIn(".delete(", route)
        self.assertNotIn(".upsert(", route)
        self.assertNotIn("subjectId = url", route)
        self.assertIn("session.user.id", route)

    def test_entitlement_table_is_rls_subject_read_and_authenticated_mutation_is_revoked(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        hardening = HARDENING.read_text(encoding="utf-8").lower()
        self.assertIn("create policy ordax_entitlement_grants_select_subject", sql)
        self.assertIn("user_id = (select auth.uid())", sql)
        self.assertIn(
            "revoke insert, update, delete on table public.ordax_entitlement_grants from authenticated",
            hardening,
        )

    def test_surface_and_native_share_provider_neutral_same_origin_boundary(self):
        adapter = ADAPTER.read_text(encoding="utf-8")
        native = NATIVE_HOST.read_text(encoding="utf-8")
        self.assertIn('"/account/entitlement?key="', adapter)
        self.assertNotIn("supabase", adapter.lower())
        self.assertIn('ACCOUNT_ENTITLEMENT_PATH = "/account/entitlement"', native)
        self.assertIn("self.server.account_gateway.entitlement(keys[0])", native)

    def test_route_preserves_server_authority_and_public_rollout_is_not_implied(self):
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn('decision.authority !== "server"', adapter)
        self.assertNotIn("service_role", adapter.lower())


if __name__ == "__main__":
    unittest.main()
