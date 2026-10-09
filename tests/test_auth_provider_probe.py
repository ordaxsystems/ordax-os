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
            "uri_allow_list": "https://ordax.com.br/auth/recover/verify,https://ordax.com.br/login/",
            "smtp_host": "smtp.resend.com",
            "smtp_port": 465,
            "smtp_user": "resend",
            "smtp_admin_email": "no-reply@auth.ordax.com.br",
            "smtp_sender_name": "OrdaX",
            "mailer_subjects_confirmation": "Confirme seu e-mail — Conta OrdaX",
            "mailer_templates_confirmation_content": '<a href="https://ordax.com.br/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email">Confirmar</a>',
            "mailer_subjects_recovery": "Redefina sua senha OrdaX",
            "mailer_templates_recovery_content": (
                '<p><a href="{{ .ConfirmationURL }}">Redefinir senha</a></p>'
            ),
        }

    def test_ready_configuration_is_sanitized_and_green(self):
        proof = MODULE.evaluate(self.base_config(), "https://ordax.com.br")
        self.assertTrue(proof["ready"])
        self.assertEqual(proof["$schema"], "prototype-ordax.auth-provider-proof/2")
        self.assertEqual(proof["project_ref"], "redacted")
        self.assertIsNone(proof["project_binding"])
        self.assertIsNone(proof["source_commit"])
        self.assertEqual(proof["observed"]["password_min_length"], 12)
        self.assertNotIn("mailer_templates_recovery_content", proof)
        self.assertNotIn("mailer_templates_confirmation_content", proof)
        self.assertNotIn("smtp_pass", str(proof))
        self.assertTrue(proof["checks"]["resend_smtp_settings"])
        self.assertTrue(proof["checks"]["branded_confirmation_template"])

    def test_project_and_commit_binding_is_deterministic_and_validated(self):
        ref, commit = "a" * 20, "b" * 40
        proof = MODULE.evaluate(
            self.base_config(), "https://ordax.com.br", project_ref=ref, commit=commit
        )
        self.assertEqual(proof["source_commit"], commit)
        self.assertRegex(proof["project_binding"], r"^[0-9a-f]{64}$")
        self.assertNotIn(ref, str(proof))
        self.assertNotEqual(proof["project_binding"], MODULE.project_binding("c" * 20))
        for invalid in ("../etc/passwd", "a" * 19, "a" * 20 + "/configuration"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                MODULE.project_binding(invalid)
        with self.assertRaises(ValueError):
            MODULE.source_commit("not-a-commit")

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

    def test_missing_wrong_or_incomplete_smtp_blocks_readiness(self):
        for field, value in (
            ("smtp_host", "smtp.evil.invalid"),
            ("smtp_port", 2525),
            ("smtp_user", "administrator"),
            ("smtp_admin_email", "no-reply@other.example"),
            ("smtp_sender_name", "Supabase Auth"),
            ("smtp_host", ""),
        ):
            with self.subTest(field=field, value=value):
                config = self.base_config()
                config[field] = value
                proof = MODULE.evaluate(config, "https://ordax.com.br")
                self.assertFalse(proof["checks"]["resend_smtp_settings"])
                self.assertFalse(proof["ready"])

    def test_default_or_unbranded_confirmation_template_blocks(self):
        for template in (
            '<a href="{{ .ConfirmationURL }}">Confirm</a>',
            '<a href="http://localhost:3000">Confirm</a>',
            '<a href="https://ordax.com.br/login/">Confirm</a>',
        ):
            with self.subTest(template=template):
                config = self.base_config()
                config["mailer_templates_confirmation_content"] = template
                proof = MODULE.evaluate(config, "https://ordax.com.br")
                self.assertFalse(proof["checks"]["branded_confirmation_template"])
                self.assertFalse(proof["ready"])

    def test_missing_signup_redirect_blocks(self):
        config = self.base_config()
        config["uri_allow_list"] = "https://ordax.com.br/auth/recover/verify"
        proof = MODULE.evaluate(config, "https://ordax.com.br")
        self.assertFalse(proof["checks"]["redirect_allowlist"])

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
