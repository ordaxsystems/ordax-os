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
        self.assertIn('window.history.replaceState(null, "", window.location.pathname + window.location.search)', js)
        self.assertNotIn('window.location.hash.slice', js)

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
