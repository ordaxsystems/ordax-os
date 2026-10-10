"""The Lovable dashboard layout must keep canonical account owners and honest availability."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "sites/public/conta/index.html"
CSS = ROOT / "sites/public/assets/account-dashboard.css"
JS = ROOT / "sites/public/assets/account-portal.js"
I18N = ROOT / "sites/public/i18n/catalog.js"

class AccountLovableDashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = HTML.read_text(encoding="utf-8")
        cls.css = CSS.read_text(encoding="utf-8")
        cls.js = JS.read_text(encoding="utf-8")
        cls.i18n = I18N.read_text(encoding="utf-8")

    def test_dashboard_composition_with_single_card_owners(self):
        self.assertEqual(self.html.count('data-account-overview-heading'), 1)
        self.assertEqual(self.html.count('class="account-profile-facts"'), 1)
        self.assertIn('Seu universo em resumo', self.html)
        for section in ("plano", "faturamento", "consumo", "seguranca"):
            self.assertEqual(self.html.count(f'id="{section}" data-account-card'), 1)
            self.assertIn(f'#{section}{{grid-column:', self.css)
        self.assertIn('grid-template-columns:repeat(12,minmax(0,1fr))', self.css)

    def test_responsive_and_navigation_hidden_state(self):
        self.assertIn('@media(max-width:1100px)', self.css)
        self.assertIn('@media(max-width:700px)', self.css)
        self.assertIn('@media(max-width:410px)', self.css)
        self.assertIn('const overviewHeading = document.querySelector("[data-account-overview-heading]")', self.js)
        self.assertIn('overviewHeading.hidden = searching || view !== "visao-geral"', self.js)
        self.assertIn('sectionFromHash', self.js)
        self.assertIn('data-account-section', self.html)
        self.assertIn('data-account-search', self.html)

    def test_auth_still_server_owned_and_no_fake_user_data(self):
        self.assertIn('data-account-state', self.html)
        self.assertIn('data-account-authenticated', self.html)
        self.assertIn('data-account-logout', self.html)
        self.assertIn('action="/auth/logout"', self.html)
        self.assertIn('data-account-hero-email', self.html)
        self.assertIn('Não confirmado', self.html)
        self.assertIn('Não verificados', self.html)
        self.assertIn('Nenhuma medição confirmada', self.html)
        self.assertNotIn('R$ 12.480', self.html)
        self.assertNotIn('999 GB', self.html)

    def test_locale_owner_contains_new_user_copy(self):
        for source in ("Informações disponíveis da conta", "Identidade", "Conta OrdaX", "Plano atual",
                       "Não confirmado", "Não verificados", "Seu universo em resumo", "Visão geral da conta"):
            self.assertIn('["' + source + '", ', self.i18n)

if __name__ == "__main__":
    unittest.main()
