"""Regression boundary for one human confirmation and non-duplicated legal acceptance.

Windows UAC is an OS permission, not an additional OrdaX legal agreement.
The first-USB operator authorization remains a separate, gated release ceremony.
"""
from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "docs/contracts/user-consent-experience.json"
CREATOR_FLOW = ROOT / "docs/contracts/creator-consumer-flow.json"
CREATOR_WINDOWS = ROOT / "tools/creator/cmd/ordax-creator-app"
REGISTRATION = ROOT / "sites/public/cadastro/index.html"
IDENTITY_GATEWAY = ROOT / "services/public-identity/gateway.py"
NATIVE_FIRST_RUN = ROOT / "system/surface/ui/first-run.mjs"


class HumanConsentExperienceTests(unittest.TestCase):
    def setUp(self):
        self.policy = json.loads(POLICY.read_text(encoding="utf-8"))

    def test_consent_policy_has_distinct_owners_without_fictional_install_acceptance(self):
        policy = self.policy
        self.assertEqual(policy["$schema"], "prototype-ordax.user-consent-experience/1")
        self.assertEqual(policy["creator_usb"]["human_destructive_confirmations_per_attempt"], 1)
        self.assertFalse(policy["creator_usb"]["app_acceptance_or_login_required"])
        self.assertFalse(policy["creator_usb"]["first_party_legal_terms_prompt"])
        self.assertEqual(policy["creator_usb"]["operator_authorization"]["purpose"],
                         "controlled first-physical-proof publication, not a consumer-facing acceptance")
        self.assertTrue(policy["creator_usb"]["windows_elevation"]["must_not_bypass_windows_uac"])
        self.assertTrue(policy["creator_usb"]["windows_elevation"]["operating_system_permission_not_ordax_consent"])
        self.assertTrue(policy["account"]["server_authoritative_receipt_required"])
        self.assertFalse(policy["account"]["same_policy_reaccepted_per_session"])
        self.assertTrue(policy["account"]["optional_for_offline_usb_usage"])
        self.assertFalse(policy["plugins"]["first_party_generic_terms_acceptance_on_every_plugin_connection"])
        self.assertTrue(policy["plugins"]["oauth_or_provider_scopes_are_independent_from_terms"])
        self.assertTrue(policy["plugins"]["sensitive_device_or_account_actions_require_specific_grants"])
        self.assertEqual(
            policy["os_first_install"]["status"],
            "separate-os-installation-document-and-receipt-not-yet-implemented",
        )
        self.assertTrue(policy["os_first_install"]["offline_local_terms_copy_required"])
        self.assertTrue(policy["os_first_install"]["durable_local_first_install_receipt_required"])
        self.assertTrue(policy["os_first_install"]["no_unreviewed_or_placeholder_legal_text_may_be_presented_as_final"])

    def test_creator_uses_one_target_specific_confirmation_and_keeps_os_elevation(self):
        source = (CREATOR_WINDOWS / "physical_flow_windows.go").read_text(encoding="utf-8")
        body = source.split("func beginPhysicalWrite()", 1)[1].split(
            "func executeLegacyPhysicalWrite(", 1
        )[0]
        self.assertEqual(body.count("messageBox("), 1)
        self.assertIn("mbYesNo|mbIconWarning|mbDefButton2", body)
        self.assertIn("creatorTValues(msgWriteConfirmBody", body)
        for field in ('"device"', '"name"', '"disk"', '"size"', '"serial"'):
            self.assertIn(field, body)
        self.assertNotIn('"title":', body)
        self.assertNotIn('"body":', body)
        self.assertNotIn('"detail":', body)
        self.assertIn("if target.SystemDisk || !target.PrototypeSafe", source)
        self.assertIn('Verb:       utf16Ptr("runas")', source)
        self.assertIn("func runElevatedAndWait(", source)

        localization = (CREATOR_WINDOWS / "localization.go").read_text(encoding="utf-8")
        dialog_pt = next(line for line in localization.splitlines()
                         if 'msgWriteConfirmBody:' in line and 'Todos os dados' in line)
        dialog_en = next(line for line in localization.splitlines()
                         if 'msgWriteConfirmBody:' in line and 'All data' in line)
        for line in (dialog_pt, dialog_en):
            self.assertNotIn("{title}", line)
            self.assertNotIn("{body}", line)
            self.assertNotIn("{detail}", line)
        self.assertIn("Deseja apagar este pendrive", dialog_pt)
        self.assertIn("Erase this USB drive", dialog_en)
        self.assertIn("Se o Windows solicitar permissão administrativa", localization)

        contract = json.loads(CREATOR_FLOW.read_text(encoding="utf-8"))
        self.assertEqual(contract["user_consent_contract"], POLICY.relative_to(ROOT).as_posix())
        self.assertEqual(contract["destructive_confirmation"]["user_visible_prompts_per_attempt"], 1)
        self.assertIn("windows_elevation_if_required_by_host", contract["normal_flow"])
        self.assertNotIn("approve_windows_uac", contract["normal_flow"])
        self.assertFalse(contract["destructive_confirmation"]["uac_bypass_or_silent_elevation_allowed"])
        self.assertTrue(contract["physical_write_gate"]["requires_live_usb_confirmation_token"])
        self.assertTrue(contract["physical_write_gate"]["requires_post_write_readback"])
        self.assertFalse(contract["physical_write_gate"]["internal_disk_write_allowed_in_mvp"])

    def test_account_acceptance_happens_at_registration_only(self):
        html = REGISTRATION.read_text(encoding="utf-8")
        gateway = IDENTITY_GATEWAY.read_text(encoding="utf-8")
        first_run = NATIVE_FIRST_RUN.read_text(encoding="utf-8")
        self.assertIn('name="legal_acceptance" value="accepted" required', html)
        self.assertIn("Li e aceito os Termos de Uso e li a Política de Privacidade.", html)
        self.assertIn('LEGAL_ACCEPTANCE_FIELD = "legal_acceptance"', gateway)
        self.assertIn('LEGAL_ACCEPTANCE_VALUE = "accepted"', gateway)
        self.assertIn("if registration:", gateway)
        self.assertIn('"legal-acceptance-required"', gateway)
        self.assertIn("begin_intent(email)", gateway)
        self.assertIn("has_registration_receipt(", gateway)
        self.assertIn('legalAccepted: registrationLegalAccepted', first_run)
        self.assertIn('kind === "register"', first_run)
        self.assertIn('sameRegistrationLegalPolicy', first_run)
        self.assertIn("Continuar sem conta", first_run)

    def test_plugin_login_is_not_a_device_permission_or_duplicated_legal_acceptance(self):
        policy = self.policy
        self.assertTrue(policy["boundaries"]["plugin_login_is_not_unlimited_device_authorization"])
        self.assertTrue(policy["boundaries"]["account_receipt_is_not_device_write_permission"])
        self.assertFalse(policy["plugins"]["first_party_generic_terms_acceptance_on_every_plugin_connection"])
        self.assertTrue(policy["plugins"]["installation_terms_acceptance_not_prerequisite_for_web_plugin_login"])
        self.assertTrue(policy["plugins"]["oauth_or_provider_scopes_are_independent_from_terms"])


if __name__ == "__main__":
    unittest.main()
