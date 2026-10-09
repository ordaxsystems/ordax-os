import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_SITE_TOOLS = ROOT / "tools" / "public-site"
sys.path.insert(0, str(PUBLIC_SITE_TOOLS))
BUILD_PATH = PUBLIC_SITE_TOOLS / "build.py"
LEGAL_CONTRACT = ROOT / "docs" / "contracts" / "public-legal-readiness.json"
AUTH_HARDENING = ROOT / "docs" / "contracts" / "public-auth-hardening.json"
SITE = ROOT / "sites" / "public"


def load_build():
    spec = importlib.util.spec_from_file_location("ordax_public_site_build_legal", BUILD_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


build = load_build()


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
        self.assertFalse(binding["policy_activation_applied"])
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

    def test_auth_hardening_gate_is_not_ready(self):
        contract = json.loads(AUTH_HARDENING.read_text(encoding="utf-8"))
        self.assertEqual(contract["status"], "public-auth-disabled-bridge-unprovisioned-legal-pending")
        observation = contract["current_observation"]
        self.assertEqual(observation["leaked_password_protection"], "enabled-product-gateway")
        self.assertTrue(observation["product_leaked_password_protection_verified"])
        self.assertFalse(observation["provider_leaked_password_protection_enabled"])
        self.assertEqual(observation["provider_leaked_password_protection_advisor"], "disabled-warn")
        self.assertFalse(observation["public_login_enabled"])

    def test_runtime_config_matches_not_ready_gate(self):
        config = json.loads((SITE / "config" / "public-site.json").read_text(encoding="utf-8"))
        self.assertFalse(config["legal"]["account_activation_ready"])
        self.assertEqual(config["legal"]["privacy_url"], "/privacidade/")
        self.assertEqual(config["legal"]["terms_url"], "/termos/")
        self.assertEqual(config["identity"]["login_url"], "/auth/login")
        self.assertEqual(config["identity"]["register_url"], "/auth/register")
        self.assertTrue(config["legal"]["auth_only_source_enabled"])

    def test_identity_urls_cannot_be_enabled_without_auth_only_or_full_readiness(self):
        with tempfile.TemporaryDirectory() as tmp:
            copied = Path(tmp) / "public"
            shutil.copytree(SITE, copied)
            config_path = copied / "config" / "public-site.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config["identity"]["login_url"] = "/auth/login"
            config["identity"]["register_url"] = "/auth/register"
            config["legal"]["auth_only_source_enabled"] = False
            config_path.write_text(json.dumps(config), encoding="utf-8")

            with self.assertRaises(build.PublicSiteError) as caught:
                build.validate_source(copied)
            self.assertIn("identity URLs must remain null", str(caught.exception))

    def test_auth_only_does_not_open_recovery_or_cloud_routes(self):
        with tempfile.TemporaryDirectory() as tmp:
            copied = Path(tmp) / "public"
            shutil.copytree(SITE, copied)
            config_path = copied / "config" / "public-site.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config["identity"]["recovery_url"] = "/auth/recover"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(
                build.PublicSiteError, "auth-only source cannot silently enable password recovery"
            ):
                build.validate_source(copied)

    def test_legal_ready_alone_cannot_activate_accounts_while_auth_hardening_is_pending(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            copied = root / "public"
            shutil.copytree(SITE, copied)

            config_path = copied / "config" / "public-site.json"
            config = json.loads(config_path.read_text(encoding="utf-8"))
            config["legal"]["account_activation_ready"] = True
            config["identity"]["login_url"] = "/auth/login"
            config["identity"]["register_url"] = "/auth/register"
            config_path.write_text(json.dumps(config), encoding="utf-8")

            legal_path = root / "legal.json"
            legal = json.loads(LEGAL_CONTRACT.read_text(encoding="utf-8"))
            legal["status"] = "ready"
            legal["account_activation_ready"] = True
            for name in ("privacy", "terms"):
                legal["documents"][name]["final"] = True
                legal["documents"][name]["version"] = "test-v1"
                legal["documents"][name]["effective_date"] = "2099-01-01"
            legal_path.write_text(json.dumps(legal), encoding="utf-8")

            original_legal = build.LEGAL_READINESS
            original_hardening = build.AUTH_HARDENING
            try:
                build.LEGAL_READINESS = legal_path
                build.AUTH_HARDENING = AUTH_HARDENING
                with self.assertRaises(build.PublicSiteError) as caught:
                    build.validate_source(copied)
            finally:
                build.LEGAL_READINESS = original_legal
                build.AUTH_HARDENING = original_hardening

            self.assertIn("auth hardening must be ready", str(caught.exception))

    def test_readiness_pages_do_not_claim_final_legal_status(self):
        privacy = (SITE / "privacidade" / "index.html").read_text(encoding="utf-8")
        terms = (SITE / "termos" / "index.html").read_text(encoding="utf-8")
        self.assertIn("Política de Privacidade", privacy)
        self.assertIn("Termos de Uso", terms)
        self.assertIn("Versão:", privacy)
        self.assertIn("O aceite é feito pelo próprio usuário", terms)


if __name__ == "__main__":
    unittest.main()
