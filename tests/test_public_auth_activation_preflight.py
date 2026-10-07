import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools" / "public-site" / "auth_activation_preflight.py"

spec = importlib.util.spec_from_file_location("ordax_auth_activation_preflight", MODULE)
preflight = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(preflight)

REQUIRED = (
    preflight.LEGAL,
    preflight.HARDENING,
    preflight.PROVIDER_POLICY,
    preflight.DEPLOYMENT,
    preflight.IDENTITY,
    preflight.LIFECYCLE,
    preflight.RUNTIME,
    preflight.EDGE,
    preflight.REFERENCE_GATEWAY,
    preflight.LIFECYCLE_EDGE,
)


class PublicAuthActivationPreflightTests(unittest.TestCase):
    def fixture_root(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        for relative in REQUIRED:
            source = ROOT / relative
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        return temporary, root

    def test_current_repository_is_coherently_safe_disabled_with_explicit_blockers(self):
        blockers, controls = preflight.readiness(ROOT)
        self.assertTrue(blockers)
        hardening = preflight.load_json(ROOT, preflight.HARDENING)
        deployment = preflight.load_json(ROOT, preflight.DEPLOYMENT)
        provider_policy = preflight.load_json(ROOT, preflight.PROVIDER_POLICY)
        self.assertTrue(
            hardening["current_observation"]["product_leaked_password_protection_verified"]
        )
        self.assertEqual(
            provider_policy["redirect_policy"]["origin"],
            "https://ordax-os-public.vercel.app",
        )
        self.assertEqual(
            provider_policy["redirect_policy"]["recovery_verify_url"],
            "https://ordax-os-public.vercel.app/auth/recover/verify",
        )
        self.assertFalse(provider_policy["provider_verification"]["production_origin"])
        self.assertTrue(deployment["public_edge_gateway"]["deployed"])
        self.assertTrue(deployment["public_edge_gateway"]["oidc_source_ready"])
        self.assertTrue(deployment["public_edge_gateway"]["oidc_deployed"])
        self.assertIn("provider-leaked-password-protection", blockers)
        self.assertNotIn("product-leaked-password-protection", blockers)
        self.assertNotIn("account-data-export-implementation", blockers)
        self.assertNotIn("email-confirmation-policy", blockers)
        self.assertNotIn("email-confirmation-provider-verification", blockers)
        self.assertNotIn("redirect-allowlist", blockers)
        self.assertNotIn("password-policy-review", blockers)
        self.assertNotIn("account-close-implementation", blockers)
        self.assertNotIn("public-edge-gateway-deployment", blockers)
        self.assertNotIn("public-edge-oidc-source", blockers)
        self.assertNotIn("public-edge-oidc-deployment", blockers)
        self.assertTrue(all(value is False for value in controls.values()))
        self.assertNotIn("registration-legal-receipt", blockers)
        self.assertNotIn("registration-provider-bypass-guard", blockers)
        for expected in (
            "registration-legal-policy-review",
            "registration-legal-web-binding",
            "registration-legal-native-binding",
            "registration-legal-activation",
            "account-registration-switch",
            "legacy-account-legal-receipt-reconciliation",
            "redirect-allowlist-provider-verification",
            "provider-password-policy-verification",
            "public-edge-provenance-proof",
            "vercel-same-origin-adapter-deployment",
            "vercel-public-edge-routing",
            "same-origin-adapter-deployment",
            "public-rate-limit-deployment",
            "recovery-email-template",
            "recovery-e2e-proof",
            "session-revocation-proof",
            "bot-protection-production-secret",
            "bot-protection-e2e-proof",
        ):
            self.assertIn(expected, blockers)
        self.assertEqual(preflight.main(["check", "--root", str(ROOT)]), 0)
        self.assertEqual(preflight.main(["require-ready", "--root", str(ROOT)]), 1)

    def test_legacy_account_legal_reconciliation_is_mandatory(self):
        temporary, root = self.fixture_root()
        try:
            hardening_path = root / preflight.HARDENING
            hardening = preflight.load_json(root, preflight.HARDENING)
            hardening["current_observation"][
                "legacy_account_legal_receipt_reconciliation_verified"
            ] = False
            hardening_path.write_text(
                __import__("json").dumps(hardening, indent=2) + "\n",
                encoding="utf-8",
            )
            blockers, _ = preflight.readiness(root)
            self.assertIn("legacy-account-legal-receipt-reconciliation", blockers)
        finally:
            temporary.cleanup()

    def test_registration_provider_bypass_guard_is_mandatory(self):
        temporary, root = self.fixture_root()
        try:
            hardening_path = root / preflight.HARDENING
            hardening = preflight.load_json(root, preflight.HARDENING)
            hardening["current_observation"]["registration_provider_bypass_guard_verified"] = False
            hardening_path.write_text(
                __import__("json").dumps(hardening, indent=2) + "\n",
                encoding="utf-8",
            )
            blockers, _ = preflight.readiness(root)
            self.assertIn("registration-provider-bypass-guard", blockers)
        finally:
            temporary.cleanup()

    def test_edge_presence_and_oidc_source_alone_cannot_satisfy_public_rollout(self):
        temporary, root = self.fixture_root()
        try:
            deployment_path = root / preflight.DEPLOYMENT
            deployment = preflight.load_json(root, preflight.DEPLOYMENT)
            deployment["public_edge_gateway"]["deployed"] = True
            deployment["public_edge_gateway"]["oidc_source_ready"] = True
            deployment["public_edge_gateway"]["oidc_deployed"] = False
            deployment["public_edge_gateway"]["runtime_provenance_e2e_verified"] = False
            deployment["vercel_adapter"]["status"] = "oidc-source-ready-not-deployed"
            deployment["routing"]["vercel_adapter_routed_to_public_edge_gateway"] = False
            deployment_path.write_text(
                __import__("json").dumps(deployment, indent=2) + "\n",
                encoding="utf-8",
            )
            blockers, _ = preflight.readiness(root)
            self.assertNotIn("public-edge-gateway-deployment", blockers)
            self.assertNotIn("public-edge-oidc-source", blockers)
            self.assertIn("public-edge-oidc-deployment", blockers)
            self.assertIn("public-edge-provenance-proof", blockers)
            self.assertIn("vercel-same-origin-adapter-deployment", blockers)
            self.assertIn("vercel-public-edge-routing", blockers)
        finally:
            temporary.cleanup()

    def test_partial_activation_is_rejected(self):
        temporary, root = self.fixture_root()
        try:
            edge = root / preflight.EDGE
            edge.write_text(
                edge.read_text(encoding="utf-8").replace(
                    "const PUBLIC_SITE_ACCOUNT_ENABLED = false;",
                    "const PUBLIC_SITE_ACCOUNT_ENABLED = true;",
                ),
                encoding="utf-8",
            )
            python = root / preflight.REFERENCE_GATEWAY
            python.write_text(
                python.read_text(encoding="utf-8").replace(
                    "PUBLIC_SITE_ACCOUNT_ENABLED = False",
                    "PUBLIC_SITE_ACCOUNT_ENABLED = True",
                ),
                encoding="utf-8",
            )
            self.assertEqual(preflight.main(["check", "--root", str(root)]), 1)
        finally:
            temporary.cleanup()

    def test_registration_switch_must_match_edge_and_reference_gateway(self):
        temporary, root = self.fixture_root()
        try:
            edge = root / preflight.EDGE
            edge.write_text(
                edge.read_text(encoding="utf-8").replace(
                    "const ACCOUNT_REGISTRATION_ENABLED = false;",
                    "const ACCOUNT_REGISTRATION_ENABLED = true;",
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "activation switch mismatch"):
                preflight.readiness(root)
        finally:
            temporary.cleanup()

    def test_lifecycle_and_gateway_close_switches_must_match(self):
        temporary, root = self.fixture_root()
        try:
            lifecycle = root / preflight.LIFECYCLE_EDGE
            lifecycle.write_text(
                lifecycle.read_text(encoding="utf-8").replace(
                    "const ACCOUNT_CLOSE_ENABLED = false;",
                    "const ACCOUNT_CLOSE_ENABLED = true;",
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "lifecycle/gateway activation switch mismatch"):
                preflight.readiness(root)
        finally:
            temporary.cleanup()

    def test_edge_and_reference_activation_switches_must_match(self):
        temporary, root = self.fixture_root()
        try:
            edge = root / preflight.EDGE
            edge.write_text(
                edge.read_text(encoding="utf-8").replace(
                    "const ACCOUNT_RECOVERY_REQUEST_ENABLED = false;",
                    "const ACCOUNT_RECOVERY_REQUEST_ENABLED = true;",
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "activation switch mismatch"):
                preflight.readiness(root)
        finally:
            temporary.cleanup()


if __name__ == "__main__":
    unittest.main()
