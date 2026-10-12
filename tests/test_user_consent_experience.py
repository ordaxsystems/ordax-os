"""UX-only consent contract: never replaces signed release or physical authorization."""
from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
UX = ROOT / "docs/contracts/user-consent-experience.json"
CREATOR = ROOT / "tools/creator/cmd/ordax-creator-app"
PUBLIC = ROOT / "sites/public/cadastro/index.html"
NATIVE = ROOT / "docs/contracts/native-installation.json"


class UserConsentExperienceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.policy = json.loads(UX.read_text(encoding="utf-8"))

    def test_one_owner_for_presentation_not_security_authority(self):
        policy = self.policy
        self.assertEqual(policy["$schema"], "prototype-ordax.user-consent-experience/1")
        self.assertEqual(policy["status"], "ux-policy-only-not-an-authorization-or-signing-authority")
        for referenced in (
            "docs/contracts/creator-consumer-flow.json",
            "docs/contracts/public-legal-readiness.json",
            "docs/contracts/physical-write-authorization.json",
            "docs/contracts/native-installation.json",
        ):
            self.assertTrue((ROOT / referenced).is_file(), referenced)
            self.assertIn(referenced, policy["authority_references"].values())
        self.assertTrue(policy["creator_portable_usb"]["physical_promotion_unchanged"])

    def test_usb_has_one_destructive_dialog_and_zero_fake_uac_promises(self):
        policy = self.policy["creator_portable_usb"]
        self.assertEqual(policy["destructive_confirmation_count"], 1)
        self.assertTrue(policy["no_separate_product_owner_consent_dialog"])
        self.assertTrue(policy["no_uac_bypass"])
        self.assertTrue(policy["system_disk_never_selectable"])
        source = (CREATOR / "physical_flow_windows.go").read_text(encoding="utf-8")
        self.assertEqual(
            source.count("messageBox(warning, creatorT(msgWriteConfirmTitle), mbYesNo|mbIconWarning|mbDefButton2)"),
            1,
        )
        self.assertIn("if messageBox(warning,", source)
        self.assertIn("!= idYes", source)
        self.assertLess(source.index("if messageBox(warning,"), source.index("executePhysicalWrite(state, target)"))
        for key in ('"device":', '"name":', '"disk":', '"size":', '"serial":'):
            self.assertIn(key, source)
        self.assertNotIn('"title":  review.Title', source)
        self.assertNotIn('"detail": review.Detail', source)
        localized = (CREATOR / "localization.go").read_text(encoding="utf-8")
        self.assertEqual(localized.count("Todos os dados deste pendrive serão apagados."), 1)
        self.assertEqual(localized.count("All data on this USB drive will be erased."), 1)
        self.assertNotIn("o Windows ainda solicitará autorização administrativa (UAC)", localized)
        self.assertNotIn("Windows will still request administrative authorization (UAC)", localized)
        self.assertIn('msgWriteConfirmTitle:         "Apagar o pendrive selecionado?"', localized)
        self.assertIn('msgWriteConfirmTitle:         "Erase the selected USB drive?"', localized)
        self.assertIn('Verb:       utf16Ptr("runas")', source)

    def test_registration_has_one_real_checkbox_and_login_does_not_repeat(self):
        self.assertEqual(self.policy["account_registration"]["legal_acceptance_control_count"], 1)
        self.assertEqual(self.policy["account_login"]["legal_acceptance_control_count"], 0)
        self.assertTrue(self.policy["account_registration"]["acceptance_receipt_server_authoritative"])
        self.assertTrue(self.policy["account_registration"]["acceptance_bound_to_exact_published_versions"])
        html = PUBLIC.read_text(encoding="utf-8")
        self.assertEqual(html.count('name="legal_acceptance"'), 1)
        self.assertIn('href="/login/"', html)
        credentials = (ROOT / "system/contracts/identity-credentials.mjs").read_text(encoding="utf-8")
        self.assertIn("sameRegistrationLegalPolicy", credentials)
        self.assertIn("value.legalAccepted !== true", credentials)

    def test_os_account_and_first_run_only_show_acceptance_during_registration(self):
        for path, marker in (
            ("system/surface/ui/account-overview-controls.mjs", "data-account-credential-mode"),
            ("system/surface/ui/first-run.mjs", "account-show-register"),
        ):
            with self.subTest(path=path):
                source = (ROOT / path).read_text(encoding="utf-8")
                self.assertIn('let credentialMode = "sign-in";', source)
                self.assertIn('credentialMode === "register"', source)
                self.assertIn('credentialMode !== "register"', source)
                self.assertIn("registrationLegalAccepted = false;", source)
                self.assertIn('credentialMode === "register" ? "new-password" : "current-password"', source)
                self.assertIn(marker, source)
                self.assertIn('...(kind === "register" ? { legalAccepted: registrationLegalAccepted } : {})'
                              if path.endswith("first-run.mjs") else
                              '...(action === "register" ? { legalAccepted: registrationLegalAccepted } : {})', source)
                self.assertEqual(source.count("dataset.firstRunRegistrationLegalAcceptance = \"\";")
                                 if path.endswith("first-run.mjs") else
                                 source.count("dataset.accountRegistrationLegalAcceptance = \"\";"), 1)

    def test_account_registration_resets_acceptance_on_policy_change(self):
        account = (ROOT / "system/surface/ui/account-overview-controls.mjs").read_text(encoding="utf-8")
        first_run = (ROOT / "system/surface/ui/first-run.mjs").read_text(encoding="utf-8")
        for source in (account, first_run):
            self.assertIn("sameRegistrationLegalPolicy(registrationPolicy, nextPolicy)", source)
            self.assertIn("registrationLegalAccepted = false;", source)
            self.assertIn("|| !registrationPolicy", source)
            self.assertIn("|| !registrationLegalAccepted", source)
        self.assertIn('register.dataset.accountIdentityAction = "register"', account)
        self.assertIn('register.dataset.accountCredentialMode = "register"', account)
        self.assertIn('signIn.dataset.accountCredentialMode = "sign-in"', account)

    def test_plugin_reuses_login_without_a_new_terms_receipt(self):
        plugin = self.policy["plugin"]
        self.assertEqual(plugin["legal_acceptance_control_count"], 0)
        self.assertEqual(plugin["logged_in"], "use-authorized-ordax-account-session")
        self.assertTrue(plugin["no_new_legal_receipt_during_plugin_login"])
        self.assertTrue(plugin["login_does_not_imply_unlimited_external_app_permissions"])
        self.assertEqual(
            plugin["external_app_data_scopes"],
            "request_separate_scoped_authorization_only_when_not_already_granted",
        )

    def test_native_installation_is_not_unlocked_by_a_ui_policy(self):
        native = json.loads(NATIVE.read_text(encoding="utf-8"))
        policy = self.policy["native_installation"]
        self.assertEqual(policy["destructive_confirmation_count"], 1)
        self.assertFalse(policy["publicly_enabled"])
        self.assertFalse(native["mvp_availability"]["destructive_operations_allowed"])
        self.assertTrue(native["post_mvp_activation_scope"]["explicit_destructive_confirmation_required"])


if __name__ == "__main__":
    unittest.main()
