"""Private RLS helper allowlist has one owner and never auto-approves rollout."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE_PATH = ROOT / "tools/security/probe_control_plane_privileges.py"
GATE_PATH = ROOT / "tools/public-site/require_account_release_ready.py"

spec = importlib.util.spec_from_file_location("ordax_private_rls_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
gate_spec = importlib.util.spec_from_file_location("ordax_private_rls_gate", GATE_PATH)
gate = importlib.util.module_from_spec(gate_spec)
gate_spec.loader.exec_module(gate)


class PrivateRlsHelperContractTests(unittest.TestCase):
    def test_exact_helpers_and_all_account_rls_consumers(self):
        owner = json.loads((ROOT / "docs/contracts/public-auth-hardening.json").read_text())
        contract = json.loads((ROOT / owner["postgresql_destination"]["private_rls_helper_contract"]).read_text())
        self.assertEqual(
            tuple(tuple(x) for x in contract["approved_authenticated_execute"]),
            probe.EXPECTED_AUTH_PRIVATE_HELPERS,
        )
        self.assertEqual(
            tuple(tuple(x) for x in contract["approved_public_rls_policy_dependencies"]),
            probe.EXPECTED_AUTH_PRIVATE_RLS_POLICIES,
        )
        self.assertEqual(len(probe.EXPECTED_AUTH_PRIVATE_HELPERS), 5)
        self.assertEqual(len(probe.EXPECTED_AUTH_PRIVATE_RLS_POLICIES), 15)
        self.assertIn(("ordax_accounts", "ordax_accounts_select_own"), probe.EXPECTED_AUTH_PRIVATE_RLS_POLICIES)
        self.assertIn(("ordax_accounts", "ordax_accounts_update_own"), probe.EXPECTED_AUTH_PRIVATE_RLS_POLICIES)
        self.assertFalse(contract["private_schema_data_api_exposure_allowed"])
        self.assertFalse(contract["public_account_activation_allowed"])

    def test_unverified_runtime_proofs_block_release_independently_of_sql(self):
        blockers = gate.validate_private_rls_runtime_review(ROOT)
        self.assertIn("private-rls-data-api-exclusion-unverified", blockers)
        self.assertIn("private-rls-two-subject-e2e-unverified", blockers)

    def test_runtime_flags_must_be_proven_separately(self):
        owner = json.loads((ROOT / "docs/contracts/public-auth-hardening.json").read_text())
        cpath = owner["postgresql_destination"]["private_rls_helper_contract"]
        private = json.loads((ROOT / cpath).read_text())
        with tempfile.TemporaryDirectory() as tmp:
            fake = Path(tmp)
            file = fake / cpath
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(json.dumps(private), encoding="utf-8")
            target = fake / "docs/contracts/public-auth-hardening.json"
            target.write_text(json.dumps(owner), encoding="utf-8")
            self.assertEqual(len(gate.validate_private_rls_runtime_review(fake)), 2)
            private["private_schema_data_api_exclusion_verified"] = True
            file.write_text(json.dumps(private), encoding="utf-8")
            self.assertEqual(
                gate.validate_private_rls_runtime_review(fake),
                ["private-rls-two-subject-e2e-unverified"],
            )
            private["two_subject_authenticated_negative_isolation_verified"] = True
            file.write_text(json.dumps(private), encoding="utf-8")
            self.assertEqual(gate.validate_private_rls_runtime_review(fake), [])
            private["private_schema_data_api_exposure_allowed"] = True
            file.write_text(json.dumps(private), encoding="utf-8")
            self.assertIn(
                "private-rls-private-schema-exposure-not-denied",
                gate.validate_private_rls_runtime_review(fake),
            )


if __name__ == "__main__":
    unittest.main()
