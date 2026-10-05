import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "public-site" / "probe_auth_provider.py"
SPEC = importlib.util.spec_from_file_location("probe_auth_provider", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class AuthProviderProbeTests(unittest.TestCase):
    def base_config(self):
        return {
            "mailer_autoconfirm": False,
            "password_min_length": 12,
            "site_url": "https://ordax.com.br",
            "uri_allow_list": "https://ordax.com.br/auth/recover/verify",
            "mailer_subjects_recovery": "Redefina sua senha OrdaX",
            "mailer_templates_recovery_content": (
                '<p><a href="{{ .ConfirmationURL }}">Redefinir senha</a></p>'
            ),
        }

    def test_ready_configuration_is_sanitized_and_green(self):
        proof = MODULE.evaluate(self.base_config(), "https://ordax.com.br")
        self.assertTrue(proof["ready"])
        self.assertEqual(proof["$schema"], "prototype-ordax.auth-provider-proof/1")
        self.assertEqual(proof["project_ref"], "redacted")
        self.assertEqual(proof["observed"]["password_min_length"], 12)
        self.assertNotIn("mailer_templates_recovery_content", proof)

    def test_autoconfirm_or_weak_password_blocks(self):
        config = self.base_config()
        config["mailer_autoconfirm"] = True
        config["password_min_length"] = 8
        proof = MODULE.evaluate(config, "https://ordax.com.br")
        self.assertFalse(proof["ready"])
        self.assertFalse(proof["checks"]["confirm_email"])
        self.assertFalse(proof["checks"]["password_policy"])

    def test_redirects_must_be_https_same_origin_without_wildcards(self):
        config = self.base_config()
        config["uri_allow_list"] = (
            "https://ordax.com.br/auth/recover/verify,"
            "https://evil.example/callback,"
            "https://*.ordax.com.br/callback"
        )
        proof = MODULE.evaluate(config, "https://ordax.com.br")
        self.assertFalse(proof["checks"]["redirect_allowlist"])
        self.assertTrue(proof["observed"]["wildcard_redirect_present"])
        self.assertTrue(proof["observed"]["cross_origin_redirect_present"])

    def test_recovery_template_requires_bounded_provider_link_variable(self):
        config = self.base_config()
        config["mailer_templates_recovery_content"] = "<p>Redefina sua senha.</p>"
        proof = MODULE.evaluate(config, "https://ordax.com.br")
        self.assertFalse(proof["checks"]["recovery_template"])
        self.assertFalse(proof["ready"])

    def test_origin_must_be_clean_https_origin(self):
        for value in (
            "http://ordax.com.br",
            "https://ordax.com.br/path",
            "https://user@ordax.com.br",
            "https://ordax.com.br?x=1",
        ):
            with self.assertRaises(ValueError):
                MODULE.clean_origin(value)


if __name__ == "__main__":
    unittest.main()
