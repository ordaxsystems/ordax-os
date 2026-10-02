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
        self.assertTrue(
            hardening["current_observation"]["product_leaked_password_protection_verified"]
        )
        self.assertNotIn("leaked-password-protection", blockers)
        self.assertNotIn("account-data-export-implementation", blockers)
        self.assertNotIn("email-confirmation-policy", blockers)
        self.assertNotIn("redirect-allowlist", blockers)
        self.assertNotIn("password-policy-review", blockers)
        self.assertNotIn("account-close-implementation", blockers)
        self.assertTrue(all(value is False for value in controls.values()))
        self.assertNotIn("registration-legal-receipt", blockers)
        for expected in (
            "registration-legal-policy-review",
            "registration-legal-web-binding",
            "registration-legal-native-binding",
            "registration-legal-activation",
            "account-registration-switch",
            "email-confirmation-provider-verification",
            "redirect-allowlist-provider-verification",
            "provider-password-policy-verification",
            "same-origin-adapter-deployment",
            "public-rate-limit-deployment",
            "recovery-email-template",
            "recovery-e2e-proof",
            "session-revocation-proof",
        ):
            self.assertIn(expected, blockers)
        self.assertEqual(preflight.main(["check", "--root", str(ROOT)]), 0)
        self.assertEqual(preflight.main(["require-ready", "--root", str(ROOT)]), 1)

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
