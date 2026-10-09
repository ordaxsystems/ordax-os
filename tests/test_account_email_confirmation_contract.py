"""Canonical signup-confirmation gateway and branded email contract."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INNER = ROOT / "infra/supabase/functions/ordax-account-gateway/index.ts"
SHARED = ROOT / "infra/supabase/functions/_shared/account_email_confirmation.mjs"
TEMPLATE = ROOT / "infra/supabase/identity/email-templates/confirmation.html"
PUBLIC_JS = ROOT / "sites/public/assets/site.js"

class SignupConfirmationContractTests(unittest.TestCase):
    def test_one_server_owned_callback_without_browser_credentials(self):
        inner = INNER.read_text(encoding="utf-8")
        shared = SHARED.read_text(encoding="utf-8")
        js = PUBLIC_JS.read_text(encoding="utf-8")
        self.assertIn('emailRedirectTo: PUBLIC_SIGNUP_REDIRECT', inner)
        self.assertIn('"GET /auth/confirm"', inner)
        self.assertIn('parseSignupConfirmation(url, PUBLIC_CONFIRMATION_PATH)', inner)
        self.assertIn('auth.verifyOtp({ token_hash: tokenHash, type: "email" })', inner)
        self.assertIn('revokeCurrentSession(result.data.session.access_token)', inner)
        self.assertIn('"https://ordax.com.br"', shared)
        self.assertIn('EMAIL_TOKEN_HASH_RE = /^[0-9a-f]{32,128}$/i;', shared)
        self.assertNotIn('EMAIL_TOKEN_HASH_RE = /^[0-9a-f]{64}$/i;', shared)
        self.assertIn('window.history.replaceState(null, "", window.location.pathname + window.location.search)', js)
        self.assertNotIn('window.location.hash.slice', js)

    def test_password_recovery_uses_same_origin_hash_only_and_remains_gated(self):
        html = (ROOT / "infra/supabase/identity/email-templates/recovery.html").read_text(encoding="utf-8")
        inner = INNER.read_text(encoding="utf-8")
        shared = SHARED.read_text(encoding="utf-8")
        self.assertIn("https://ordax.com.br/auth/recover/verify?token_hash={{ .TokenHash }}&amp;type=recovery", html)
        self.assertNotIn("{{ .ConfirmationURL }}", html)
        self.assertNotIn("{{ .RedirectTo }}", html)
        self.assertIn("PUBLIC_RECOVERY_VERIFY_URL", shared)
        self.assertIn("parseRecoveryLink(url, PUBLIC_RECOVERY_VERIFY_PATH)", inner)
        self.assertIn("const ACCOUNT_RECOVERY_REQUEST_ENABLED = false;", inner)
        self.assertIn("const ACCOUNT_RECOVERY_COMPLETION_ENABLED = false;", inner)
        self.assertIn("return PUBLIC_RECOVERY_VERIFY_URL;", inner)

    def test_branded_email_links_to_canonical_token_hash_route(self):
        html = TEMPLATE.read_text(encoding="utf-8")
        self.assertIn('lang="pt-BR"', html)
        self.assertIn('OrdaX', html)
        self.assertIn('https://ordax.com.br/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email', html)
        self.assertNotIn('localhost', html)
        self.assertNotIn('.ConfirmationURL', html)
        self.assertNotIn('access_token', html)
        self.assertNotIn('refresh_token', html)

if __name__ == "__main__":
    unittest.main()
