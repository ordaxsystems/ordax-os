from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"


class MemoryEntitlementEdgeSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = EDGE.read_text(encoding="utf-8")
        cls.route_marker = 'if (path === "/account/entitlements/memory-cloud") {'
        start = cls.source.index(cls.route_marker)
        end = cls.source.index('if (path === "/sync/snapshot"', start)
        cls.route = cls.source[start:end]

    def test_route_is_authenticated_account_scoped_and_read_only(self):
        self.assertIn(self.route_marker, self.source)
        self.assertIn('if (req.method !== "GET")', self.route)
        self.assertIn('session = await authenticated(req);', self.route)
        self.assertIn('error: "authentication-required"', self.route)
        self.assertIn('.eq("user_id", session.user.id)', self.route)
        self.assertIn('.eq("entitlement_key", MEMORY_CLOUD_ENTITLEMENT)', self.route)

    def test_route_reads_existing_rls_grants_without_mutation_or_service_role(self):
        self.assertIn('.from("ordax_entitlement_grants")', self.route)
        self.assertIn('.select("entitlement_value,valid_from,valid_until")', self.route)
        self.assertNotIn('.insert(', self.route)
        self.assertNotIn('.update(', self.route)
        self.assertNotIn('.delete(', self.route)
        self.assertNotIn('service_role', self.route.lower())
        self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', self.route)

    def test_server_decision_is_subject_bound_and_never_local_default(self):
        self.assertIn('subjectType: "account"', self.route)
        self.assertIn('subjectId: session.user.id', self.route)
        self.assertIn('key: MEMORY_CLOUD_ENTITLEMENT', self.route)
        self.assertIn('authority: "server"', self.route)
        self.assertNotIn('authority: "local-default"', self.route)
        self.assertIn('decision: allowed ? "allowed" : "denied"', self.route)

    def test_grant_window_and_response_bounds_fail_closed(self):
        self.assertIn('MAX_MEMORY_ENTITLEMENT_ROWS + 1', self.route)
        self.assertIn('entitlementResult.data.length > MAX_MEMORY_ENTITLEMENT_ROWS', self.route)
        self.assertIn('validUntil <= validFrom', self.route)
        self.assertIn('return error(502, "memory-entitlement-read-failed"', self.route)

    def test_public_account_gate_runs_before_entitlement_resolution(self):
        gate = self.source.index('if (publicSiteRequest(req) && !PUBLIC_SITE_ACCOUNT_ENABLED')
        route = self.source.index(self.route_marker)
        self.assertLess(gate, route)
        gated_block = self.source[gate:route]
        self.assertIn('path.startsWith("/account/")', gated_block)
        self.assertIn('"public-account-access-disabled"', gated_block)


if __name__ == "__main__":
    unittest.main()
