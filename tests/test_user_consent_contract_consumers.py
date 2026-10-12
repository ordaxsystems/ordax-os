"""Complementary consumers of the existing OrdaX consent UX SSOT.

Only validates references. Identity, physical-write, and Native installation
authorities remain owned by their existing contracts.
"""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
USER_CONSENT = "docs/contracts/user-consent-experience.json"


class UserConsentContractConsumersTests(unittest.TestCase):
    def test_account_and_native_reuse_existing_consent_ux_contract(self):
        source = json.loads((ROOT / USER_CONSENT).read_text(encoding="utf-8"))
        self.assertEqual(source["$schema"], "prototype-ordax.user-consent-experience/1")

        for contract_path in (
            "docs/contracts/public-legal-readiness.json",
            "docs/contracts/native-installation.json",
        ):
            with self.subTest(contract=contract_path):
                contract = json.loads((ROOT / contract_path).read_text(encoding="utf-8"))
                self.assertEqual(contract["user_consent_contract"], USER_CONSENT)
                self.assertNotIn("consent_experience_contract", contract)

    def test_links_never_promote_legal_registration_or_native_write(self):
        legal = json.loads((ROOT / "docs/contracts/public-legal-readiness.json").read_text(encoding="utf-8"))
        native = json.loads((ROOT / "docs/contracts/native-installation.json").read_text(encoding="utf-8"))
        self.assertFalse(legal["account_activation_ready"])
        self.assertFalse(legal["registration_binding"]["registration_activation_allowed"])
        self.assertFalse(native["mvp_availability"]["available"])
        self.assertFalse(native["mvp_availability"]["destructive_operations_allowed"])
        self.assertFalse(native["mvp_availability"]["internal_disk_write_allowed"])
        self.assertTrue(native["post_mvp_activation_scope"]["explicit_destructive_confirmation_required"])


if __name__ == "__main__":
    unittest.main()
