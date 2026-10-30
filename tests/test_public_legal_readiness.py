"""OS-owned legal and Identity readiness contracts, independent of Site presentation."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEGAL_CONTRACT = ROOT / "docs/contracts/public-legal-readiness.json"
AUTH_HARDENING = ROOT / "docs/contracts/public-auth-hardening.json"
SITE_SOURCE = ROOT / "docs/contracts/public-site-source.json"


class PublicLegalReadinessTests(unittest.TestCase):

    def test_canonical_legal_gate_is_not_ready(self):
        contract = json.loads(LEGAL_CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["status"], "legal-documents-source-ready-activation-pending")
        self.assertFalse(contract["account_activation_ready"])
        operator = contract["operator"]
        self.assertEqual(operator["legal_form"], "natural_person")
        self.assertEqual(operator["operation_phase"], "initial_individual_operator_no_company")
        self.assertEqual(operator["operating_country"], "BR")
        self.assertIsNone(operator["legal_name"])
        self.assertIsNone(operator["privacy_contact_email"])
        self.assertFalse(operator["identity_reviewed"])
        self.assertFalse(operator["privacy_contact_verified"])
        self.assertIsNone(operator["business_registration"])
        for path in (
            ROOT / "docs/legal/review/PRIVACIDADE-MINUTA.md",
            ROOT / "docs/legal/review/TERMOS-CONTA-MINUTA.md",
        ):
            draft = path.read_text(encoding="utf-8")
            self.assertIn("pessoa física", draft)
            self.assertIn("PENDENTE", draft)
        self.assertTrue(contract["documents"]["privacy"]["final"])
        self.assertTrue(contract["documents"]["terms"]["final"])
        self.assertEqual(contract["documents"]["privacy"]["version"], "2026.10.09")
        self.assertEqual(contract["documents"]["terms"]["version"], "2026.10.09")
        binding = contract["registration_binding"]
        self.assertTrue(binding["policy_activation_source_ready"])
        for stale_runtime_flag in (
            "active_legal_policy_present",
            "policy_projection_active_policy_present",
            "policy_activation_applied",
        ):
            self.assertNotIn(stale_runtime_flag, binding)
        self.assertTrue(binding["policy_activation_service_role_only"])
        self.assertFalse(binding["policy_activation_currently_allowed"])
        self.assertTrue(binding["policy_activation_requires_final_documents"])
        self.assertEqual(
            binding["policy_activation_rpc"],
            "ordax_activate_account_legal_policy_v1",
        )
        self.assertEqual(
            binding["policy_activation_manual_workflow"],
            ".github/workflows/public-legal-policy-activation.yml",
        )
        self.assertEqual(
            binding["policy_activation_receipt_schema"],
            "prototype-ordax.account-legal-policy-activation-receipt/1",
        )

    def test_development_is_independent_of_public_legal_release_gate(self):
        legal = json.loads(LEGAL_CONTRACT.read_text(encoding="utf-8"))
        identity = json.loads(
            (ROOT / "docs/contracts/public-identity.json").read_text(encoding="utf-8")
        )
        gate = legal["build_gate"]
        self.assertFalse(gate["development_requires_live_legal_policy_proof"])
        self.assertFalse(gate["usb_and_local_apps_require_public_legal_activation"])
        self.assertTrue(gate["auth_only_login_and_registration_may_precede_full_account_readiness"])
        self.assertTrue(gate["public_registration_requires_server_authoritative_policy"])
        self.assertTrue(gate["full_account_publication_requires_separate_live_legal_proof"])
        self.assertFalse(gate["placeholder_legal_acceptance_allowed"])
        self.assertTrue(identity["legal_readiness"]["auth_only_routes_may_precede_full_account_readiness"])
        self.assertTrue(identity["legal_readiness"]["full_account_publication_requires_legal_readiness"])
        self.assertFalse(legal["account_activation_ready"])
        source = json.loads(SITE_SOURCE.read_text(encoding="utf-8"))
        self.assertEqual(source["repository"], "ordaxsystems/ordax-site")
        self.assertFalse(source["production_deployment_activated"])

    def test_auth_transport_is_live_but_account_activation_gate_is_not_ready(self):
        contract = json.loads(AUTH_HARDENING.read_text(encoding="utf-8"))
        self.assertEqual(
            contract["status"],
            "web-auth-runtime-proven-public-account-activation-gated",
        )
        observation = contract["current_observation"]
        destination = contract["postgresql_destination"]
        self.assertEqual(observation["leaked_password_protection"], "enabled-product-gateway")
        self.assertTrue(observation["product_leaked_password_protection_verified"])
        self.assertFalse(observation["provider_leaked_password_protection_enabled"])
        self.assertEqual(observation["provider_leaked_password_protection_advisor"], "disabled-warn")
        self.assertTrue(observation["same_origin_session_owner_deployed"])
        self.assertTrue(observation["public_edge_provenance_e2e_verified"])
        self.assertTrue(destination["destination_service_transport_runtime_verified"])
        self.assertTrue(destination["destination_named_bridge_runtime_e2e_verified"])
        self.assertFalse(observation["public_login_enabled"])
        self.assertFalse(destination["public_registration_enabled"])
        self.assertFalse(destination["recovery_e2e_verified"])
        self.assertFalse(destination["session_revocation_e2e_verified"])


if __name__ == "__main__":
    unittest.main()
