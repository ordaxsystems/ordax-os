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
        # The single canonical implementation lives in this same transaction;
        # the public wrapper still delegates rather than copying the rule.
        self.assertEqual(s.lower().count("from auth.sessions s"), 1)
        self.assertEqual(s.lower().count("join auth.users u"), 1)
        self.assertEqual(
            s.lower().count("create or replace function private.ordax_authenticated_subject_eligible_v1()"),
            1,
        )
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
        self.assertIn("0e64a11cc3d4802f7f94c1591cdadc26", s)
        self.assertEqual(len(re.findall(r"(?m)^begin;$", s)), 1)
        self.assertEqual(len(re.findall(r"(?m)^commit;$", s)), 1)
        self.assertLess(
            s.index("create or replace function private.ordax_authenticated_subject_eligible_v1()"),
            s.index("create schema ordax_policy;"),
        )
        self.assertLess(
            s.index("execute format('alter policy"),
            s.index("revoke all on function private.ordax_authenticated_subject_eligible_v1()"),
        )
        self.assertIn("eligibility/role contract drifted", s)
        self.assertIn("missing confirmed session guard", s)
        self.assertIn("eligible-subject guard not preserved in all policies", s)
        self.assertIn("private helper still directly executable", s)
        self.assertIn("wrapper ACL/security path drifted", s)
        self.assertIn("exact private policy set drifted", s)
        self.assertTrue(s.lstrip().startswith("-- Forward-only"))
        self.assertIn("\nbegin;\n", s)
        self.assertTrue(s.rstrip().endswith("commit;"))

    def test_recovered_session_guard_source_fingerprints_the_live_catalog(self):
        source = (
            ROOT / self.obs["source_recovery"]["source_path"]
        ).read_text(encoding="utf-8")
        self.assertIn("0e64a11cc3d4802f7f94c1591cdadc26", source)
        self.assertIn("pg_get_functiondef(v_oid)", source)
        self.assertIn("v_subject_user_id:=auth.uid();", source)
        self.assertIn("v_claims:=auth.jwt();", source)
        self.assertIn("join auth.users u", source)
        self.assertIn("from auth.sessions s", source)
        self.assertIn("u.confirmed_at is not null", source)
        self.assertIn("u.is_anonymous is false", source)
        self.assertIn("u.banned_until", source)
        self.assertIn("s.not_after", source)
        self.assertIn("language plpgsql", source)
        self.assertIn("volatile", source)
        self.assertIn("security definer", source)
        self.assertIn("set search_path = ''", source)
        self.assertNotIn("grant execute on function private.", source.lower())
        self.assertFalse(self.obs["source_recovery"]["source_migration_deployed"])
        self.assertFalse(self.obs["source_recovery"]["semantic_e2e_verified"])

    def test_historical_recipe_is_not_promotable_as_live_proof(self):
        historical = LEGACY.read_text(encoding="utf-8")
        self.assertIn("ordax_memory_items_insert_own", historical)
        self.assertNotIn("ordax_accounts_select_own", historical)
        self.assertIn("ordax_authenticated_subject_eligible_v1", self.source)
        self.assertIn("historical_non_applicable", json.dumps(self.obs))


if __name__ == "__main__":
    unittest.main()
