import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "infra/supabase/product/migrations/20261026182000_public_policy_subject_guard_boundary_v1.sql"
EVIDENCE = ROOT / "docs/evidence/live-identity-policy-boundary-2026-10-26.json"
LEGACY = ROOT / "infra/supabase/product/migrations/20261005031500_policy_predicate_boundary_v1.sql"


class LiveIdentityPolicyBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = SQL.read_text(encoding="utf-8")
        cls.obs = json.loads(EVIDENCE.read_text(encoding="utf-8"))

    def test_owner_evidence_and_exact_live_policy_set(self):
        proof = self.obs
        self.assertEqual(proof["observed"]["policies_with_private_auth_function_references"], 15)
        self.assertEqual(proof["observed"]["policies_with_private_can_access_function_references"], 13)
        self.assertFalse(proof["deployment"]["applied_to_live_db"])
        self.assertFalse(proof["deployment"]["authenticated_e2e_verified"])
        self.assertFalse(proof["deployment"]["public_account_enabled"])
        self.assertFalse(proof["observed"]["private_ssot_subject_guard_source_in_current_ordax_os_repo"])
        head = self.source.split("expected_refs constant text[] := array[", 1)[1].split("];", 1)[0]
        declared = re.findall(r"'(ordax_[a-z_]+\.ordax_[a-z_]+)'", head)
        self.assertEqual(len(declared), len(set(declared)))
        self.assertEqual(declared, proof["observed"]["current_public_policy_calls"])
        self.assertEqual(len(declared), 15)
        self.assertIn("exact private policy set drifted", self.source)

    def test_no_exposure_or_duplicated_eligibility_business_rule(self):
        s = self.source
        self.assertIn("create function ordax_policy.authenticated_subject_eligible()", s)
        self.assertRegex(
            s.lower(),
            r"create function ordax_policy\.authenticated_subject_eligible\(\)[\s\S]*?"
            r"language sql volatile security definer set search_path = ''",
        )
        self.assertIn("select private.ordax_authenticated_subject_eligible_v1();", s)
        for forbidden in ("join auth.sessions s", "join auth.users u", "select 1 from auth.sessions"):
            self.assertNotIn(forbidden, s.lower())
        for name in (
            "can_access_space", "can_admin_space", "can_access_project", "can_access_product_device"
        ):
            self.assertIn(f"select private.ordax_{name}(target_", s)
            self.assertIn(f"grant execute on function ordax_policy.{name}(uuid) to authenticated;", s)
        self.assertIn("grant usage on schema ordax_policy to authenticated;", s)
        self.assertIn("revoke usage on schema private from authenticated;", s)
        self.assertIn("has_schema_privilege('authenticated','private','USAGE')", s)
        self.assertNotRegex(s.lower(), r"grant\s+.*\s+to\s+(?:anon|public|service_role)\s*;")

    def test_rewrite_preserves_using_with_check_and_live_session_gate(self):
        s = self.source
        self.assertIn("expression_using := p.qual;", s)
        self.assertIn("expression_check := p.with_check;", s)
        self.assertIn("'private.' || target_names[i] || '('", s)
        self.assertIn("'ordax_policy.' || replacement_names[i] || '('", s)
        self.assertIn("p.cmd='SELECT'", s)
        self.assertIn("p.cmd='UPDATE'", s)
        self.assertIn("with check (%s)", s.lower())
        self.assertIn("auth.sessions", s)
        self.assertIn("u.confirmed_at is not null", s)
        self.assertIn("eligibility/role contract drifted", s)
        self.assertIn("missing confirmed session guard", s)
        self.assertIn("eligible-subject guard not preserved in all policies", s)
        self.assertIn("private helper still directly executable", s)
        self.assertIn("wrapper ACL/security path drifted", s)
        self.assertIn("exact private policy set drifted", s)
        self.assertTrue(s.lstrip().startswith("-- Forward-only"))
        self.assertIn("\nbegin;\n", s)
        self.assertTrue(s.rstrip().endswith("commit;"))

    def test_historical_recipe_is_not_promotable_as_live_proof(self):
        historical = LEGACY.read_text(encoding="utf-8")
        self.assertIn("ordax_memory_items_insert_own", historical)
        self.assertNotIn("ordax_accounts_select_own", historical)
        self.assertIn("ordax_authenticated_subject_eligible_v1", self.source)
        self.assertIn("historical_non_applicable", json.dumps(self.obs))


if __name__ == "__main__":
    unittest.main()
