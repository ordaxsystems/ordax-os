"""OrdaX Account overview visual migration: branded layout, no simulated account facts.

The public Account portal consumes the existing same-origin identity/session
implementation. Lovable supplies presentation reference only.
"""

from __future__ import annotations

import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = ROOT / "sites/public/conta/index.html"
STYLES = ROOT / "sites/public/assets/account-dashboard.css"
SCRIPT = ROOT / "sites/public/assets/account-portal.js"


class AccountMarkup(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict[str, str | None]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.tags.append((tag, dict(attrs)))

    def includes(self, tag: str, attr: str, value: str | None = None) -> bool:
        return any(
            name == tag and attr in attributes
            and (value is None or attributes[attr] == value)
            for name, attributes in self.tags
        )


class AccountOverviewMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = ACCOUNT.read_text(encoding="utf-8")
        cls.css = STYLES.read_text(encoding="utf-8")
        cls.js = SCRIPT.read_text(encoding="utf-8")
        cls.parsed = AccountMarkup()
        cls.parsed.feed(cls.html)

    def test_branded_overview_uses_canonical_assets_and_single_page_title(self):
        self.assertEqual(self.html.count("<h1>Minha Conta"), 1)
        self.assertTrue(self.parsed.includes("span", "class", "ordax-symbol account-heading-mark"))
        self.assertIn("UMA CONTA. TODOS OS SEUS MUNDOS.", self.html)
        self.assertIn('url("/assets/ordax-landscape.png")', self.css)
        self.assertIn(".account-content[data-view=\"visao-geral\"] .account-heading", self.css)
        self.assertIn("var(--ordax-brand-blue)", self.css)
        self.assertIn("@media(max-width:900px)", self.css)
        self.assertIn("@media(max-width:600px)", self.css)

    def test_usage_visual_is_explicitly_unavailable_without_fake_numbers(self):
        self.assertTrue(self.parsed.includes("div", "class", "account-usage-visual"))
        self.assertIn('aria-label="Atividade de consumo: dados não disponíveis"', self.html)
        self.assertIn("Nenhuma medição confirmada", self.html)
        self.assertIn("Os consumos, quotas, créditos e limites são mostrados somente quando confirmados", self.html)
        self.assertIn(".account-usage-visual-grid", self.css)
        self.assertNotIn('aria-valuenow=', self.html)
        self.assertNotIn("R$ 12.480", self.html)

    def test_real_identity_and_navigation_remain_in_existing_owners(self):
        self.assertTrue(self.parsed.includes("form", "data-account-logout"))
        self.assertTrue(self.parsed.includes("div", "data-account-state"))
        self.assertTrue(self.parsed.includes("section", "data-account-authenticated"))
        self.assertTrue(self.parsed.includes("section", "data-account-anonymous"))
        self.assertTrue(self.parsed.includes("input", "data-account-search"))
        self.assertTrue(self.parsed.includes("main", "data-account-content"))
        self.assertIn('action="/auth/logout"', self.html)
        self.assertIn('href="/login/"', self.html)
        self.assertIn('href="/cadastro/"', self.html)
        self.assertIn("sectionFromHash", self.js)
        self.assertNotIn("https://cdn.", self.css)


if __name__ == "__main__":
    unittest.main()
