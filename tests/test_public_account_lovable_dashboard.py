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

    def test_logout_is_visible_at_profile_level_only_for_verified_sessions(self):
        site = (ROOT / "sites/public/assets/site.js").read_text(encoding="utf-8")
        self.assertEqual(self.html.count('data-account-logout'), 1)
        self.assertLess(
            self.html.index('data-account-logout'),
            self.html.index('<details class="account-session-disclosure"'),
        )
        self.assertIn('class="account-logout-shortcut" action="/auth/logout" method="post" data-account-logout hidden', self.html)
        self.assertIn('>Sair da conta</button>', self.html)
        self.assertIn(".account-logout-shortcut[hidden]{display:none}", self.css)
        self.assertIn('logoutForm.hidden = true;', site)
        self.assertIn('logoutForm.hidden = false;', site)
        self.assertIn('if (session.authenticated === true)', site)
        self.assertIn('logout.disabled = false;', site)
        self.assertNotIn('window.localStorage', self.html)

    def test_collapsible_desktop_navigation_and_dynamic_breadcrumb(self):
        self.assertEqual(self.html.count('data-account-sidebar-toggle'), 1)
        self.assertIn('aria-controls="account-navigation" aria-expanded="true"', self.html)
        self.assertIn('data-sidebar-collapse-label', self.html)
        self.assertIn('data-sidebar-expand-label', self.html)
        self.assertIn('data-account-breadcrumb-current', self.html)
        self.assertIn('data-account-breadcrumb-details hidden', self.html)
        self.assertIn('function setSidebarCollapsed(collapsed)', self.js)
        self.assertIn('sidebarToggle?.addEventListener("click"', self.js)
        self.assertIn('setSidebarCollapsed(false)', self.js)
        self.assertIn('breadcrumbDetails.hidden = !detailed', self.js)
        self.assertIn('link.textContent.trim().replace', self.js)
        self.assertIn('@media(min-width:901px)', self.css)
        self.assertIn('@media(max-width:900px)', self.css)
        self.assertIn('grid-template-columns:76px minmax(0,1fr)', self.css)

    def test_personal_email_comes_only_from_canonical_verified_session(self):
        site = (ROOT / "sites/public/assets/site.js").read_text(encoding="utf-8")
        self.assertEqual(self.html.count('data-account-profile-email'), 1)
        self.assertEqual(self.html.count('data-account-profile-identity'), 1)
        self.assertIn('data-account-profile-identity hidden', self.html)
        self.assertIn('profileEmail.textContent = email.textContent;', site)
        self.assertIn('profileIdentity.hidden = false;', site)
        self.assertGreaterEqual(site.count('profileEmail.textContent = "";'), 2)
        self.assertGreaterEqual(site.count('profileIdentity.hidden = true;'), 2)
        self.assertIn('if (session.authenticated === true)', site)
        self.assertIn('action="/auth/logout"', self.html)
        self.assertNotIn('data-account-profile-name', self.html)
        self.assertNotIn('data-account-profile-plan', self.html)

    def test_new_labels_are_translated_and_asset_versions_advance(self):
        for label in ("Recolher navegação", "Expandir navegação", "Localização na conta",
                      "Informação da sessão autenticada"):
            self.assertIn('["' + label + '", ', self.i18n)
        self.assertIn('/assets/account-dashboard.css?v=account-6', self.html)
        self.assertIn('/assets/account-portal.js?v=account-3', self.html)
        self.assertIn('/assets/site.js?v=account-4', self.html)


    def test_lovable_layout_keeps_single_canonical_card_and_chart(self):
        self.assertEqual(self.html.count('data-account-dashboard-activity '), 1)
        self.assertEqual(self.html.count('data-account-dashboard-chart-slot'), 1)
        self.assertEqual(self.html.count('class="account-usage-visual"'), 1)
        self.assertIn('account-dashboard-activity" data-account-dashboard-activity aria-labelledby="account-dashboard-activity-title" hidden', self.html)
        self.assertIn('const usageChart = document.querySelector(".account-usage-visual")', self.js)
        self.assertIn('const usageChartDetailHost = usageChart?.parentElement', self.js)
        self.assertIn('chartHost.append(usageChart)', self.js)
        self.assertIn('activity.hidden = !onOverview', self.js)
        for selector in ('#plano{grid-column:span 4;order:1', '#consumo{grid-column:span 4;order:2',
                         '#faturamento{grid-column:span 4;order:3', '#seguranca{grid-column:span 4;order:5'):
            self.assertIn(selector, self.css)
        self.assertIn('.account-dashboard-activity{grid-column:span 8;order:4', self.css)
        self.assertIn('url("/assets/ordax-landscape.png") center 56%/cover no-repeat', self.css)
        self.assertIn('href="#plano" data-account-section>Ver assinatura', self.html)
        self.assertIn('href="#faturamento" data-account-section>Pagamentos e faturas', self.html)
        self.assertIn('href="#seguranca" data-account-section class="account-summary-security-link"', self.html)

    def test_lovable_responsive_and_accessible_navigation_are_not_regressed(self):
        self.assertIn('class="account-workspace-label"', self.html)
        self.assertIn('class="account-search-shortcut"', self.html)
        self.assertIn('account-sidebar-collapsed', self.css)
        self.assertIn('@media(max-width:1100px)', self.css)
        self.assertIn('@media(max-width:900px)', self.css)
        self.assertIn('@media(max-width:700px)', self.css)
        self.assertIn('@media(max-width:410px)', self.css)
        self.assertIn('event.key.toLowerCase() === "k"', self.js)
        self.assertIn('data-account-search', self.html)
        self.assertIn('data-account-breadcrumb-current', self.html)
        self.assertEqual(self.html.count('data-account-authenticated'), 1)
        self.assertEqual(self.html.count('data-account-logout'), 1)

    def test_locale_owner_contains_new_user_copy(self):
        for source in ("Informações disponíveis da conta", "Identidade", "Conta OrdaX", "Plano atual",
                       "Não confirmado", "Não verificados", "Seu universo em resumo", "Visão geral da conta"):
            self.assertIn('["' + source + '", ', self.i18n)

if __name__ == "__main__":
    unittest.main()
