"""Contract and accessibility checks for the OrdaX public Account identity family."""

from __future__ import annotations

import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "sites/public"
SHARED = PUBLIC / "assets/account.css"

IDENTITY_PAGES = {
    "login": ("login", True),
    "cadastro": ("register", True),
    "recuperar": ("recover", True),
    "recuperar/nova-senha": ("recover-complete", False),
}
PAGE_IDS = {
    "login": "login",
    "cadastro": "cadastro",
    "recuperar": "recuperar",
    "recuperar/nova-senha": "recuperar-nova-senha",
}


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
        self.links = []
        self.forms = []
        self.inputs = []

    def handle_starttag(self, name, attrs):
        values = dict(attrs)
        self.tags.append((name, values))
        if name == "a":
            self.links.append(values)
        if name == "form":
            self.forms.append(values)
        if name == "input":
            self.inputs.append(values)


class PublicAccountEntryUxTests(unittest.TestCase):
    def read(self, route):
        html = (PUBLIC / route / "index.html").read_text(encoding="utf-8")
        parsed = PageParser()
        parsed.feed(html)
        return html, parsed

    def test_shared_css_is_the_single_owner_for_identity_family(self):
        self.assertTrue(SHARED.is_file())
        self.assertFalse((PUBLIC / "assets/login.css").exists())
        self.assertFalse((PUBLIC / "assets/cadastro.css").exists())
        css = SHARED.read_text(encoding="utf-8")
        for part in (
            ".account-ui",
            ".account-stage",
            ".account-story",
            ".account-access",
            ".account-card",
            ".account-nav-actions",
            ".account-benefits",
            ".account-quicklinks",
            ".account-ui .identity-form[hidden]",
            ".account-ui [hidden]",
            'grid-template-areas:"story access"',
            "display:flex;flex-direction:column;min-height:0",
            ".account-access{order:1",
            ".account-story{order:2",
            "@media(max-width:780px)",
            "@media(max-width:440px)",
            "@media(prefers-reduced-motion:reduce)",
            ":focus-visible",
        ):
            self.assertIn(part, css)
        for obsolete in (
            ".login-stage", ".signup-stage", ".login-card", ".signup-card",
            ".login-nav-actions", ".signup-nav-actions",
        ):
            self.assertNotIn(obsolete, css)

        for route in IDENTITY_PAGES:
            html, parsed = self.read(route)
            styles = [
                tag["href"] for name, tag in parsed.tags
                if name == "link" and tag.get("rel") == "stylesheet"
            ]
            self.assertIn("/assets/site.css", styles)
            self.assertEqual(
                [value for value in styles if "account.css" in value],
                ["/assets/account.css?v=account-ux-4"],
            )
            self.assertNotIn("/assets/portal.css", styles)
            self.assertTrue(any(
                name == "body" and tag.get("data-page") == PAGE_IDS[route]
                and "account-ui" in tag.get("class", "").split()
                for name, tag in parsed.tags
            ))
            self.assertTrue(any(
                name == "header" and "account-header" in tag.get("class", "").split()
                for name, tag in parsed.tags
            ))
            self.assertTrue(any(
                name == "main" and "account-stage" in tag.get("class", "").split()
                for name, tag in parsed.tags
            ))
            self.assertFalse(any(
                name == "nav" and "site-nav" in tag.get("class", "").split()
                for name, tag in parsed.tags
            ))
            self.assertNotIn('login.css', html)
            self.assertNotIn('cadastro.css', html)

    def test_navigation_is_real_same_origin_and_available_without_js(self):
        required = {
            "login": {"/", "/cadastro/", "/recuperar/", "/privacidade/", "/termos/"},
            "cadastro": {"/", "/login/", "/recuperar/", "/privacidade/", "/termos/"},
            "recuperar": {"/", "/login/", "/privacidade/", "/termos/"},
            "recuperar/nova-senha": {"/", "/login/", "/recuperar/", "/privacidade/", "/termos/"},
        }
        for route, paths in required.items():
            _, parsed = self.read(route)
            anchors = {anchor.get("href") for anchor in parsed.links}
            self.assertTrue(paths.issubset(anchors), (route, paths - anchors))
            self.assertTrue(any(
                name == "nav" and tag.get("class") == "account-quicklinks"
                and bool(tag.get("aria-label"))
                for name, tag in parsed.tags
            ))
            self.assertTrue(all(
                anchor.get("href", "").startswith(("/", "#"))
                for anchor in parsed.links
                if "href" in anchor
            ), route)
            self.assertTrue(all(
                "href" not in anchor
                for anchor in parsed.links
                if "data-registration-privacy" in anchor or "data-registration-terms" in anchor
            ), route)

    def test_pages_preserve_server_owned_form_gates(self):
        for route, (kind, needs_turnstile) in IDENTITY_PAGES.items():
            _, parsed = self.read(route)
            self.assertEqual(len(parsed.forms), 1)
            form = parsed.forms[0]
            self.assertEqual(form.get("data-identity-form"), kind)
            self.assertEqual(form.get("method"), "post")
            self.assertIn("hidden", form)
            self.assertNotIn("action", form)
            self.assertTrue(any(
                name == "div" and tag.get("data-identity-state") == kind
                for name, tag in parsed.tags
            ))
            self.assertTrue(any(
                name == "p" and "data-identity-notice" in tag
                and "hidden" in tag
                for name, tag in parsed.tags
            ))
            self.assertTrue(all("disabled" in tag for tag in parsed.inputs))
            self.assertEqual(any(
                name == "div" and "data-turnstile" in tag
                for name, tag in parsed.tags
            ), needs_turnstile)
            self.assertTrue(any(
                name == "main" and tag.get("id") == "conteudo"
                for name, tag in parsed.tags
            ))

        html, register = self.read("cadastro")
        self.assertIn("data-registration-legal", html)
        self.assertIn('name="legal_acceptance"', html)
        self.assertIn("Use pelo menos 12 caracteres.", html)
        self.assertTrue(any(
            field.get("name") == "legal_acceptance" and field.get("required") is None
            for field in register.inputs
        ))
        recovery, _ = self.read("recuperar")
        recovery_complete, _ = self.read("recuperar/nova-senha")
        self.assertIn("Recuperação ainda não configurada", recovery)
        self.assertIn("Conclusão da recuperação ainda não ativada", recovery_complete)
        self.assertIn('name="password_confirmation"', recovery_complete)

    def test_shared_visual_layout_keeps_loading_and_auth_separate(self):
        css = SHARED.read_text(encoding="utf-8")
        self.assertNotRegex(css, r"(?i)@import\s|https?://")
        self.assertIn(".account-ui [hidden]{display:none!important}", css)
        for route in IDENTITY_PAGES:
            html, _ = self.read(route)
            self.assertIn('href="/assets/account.css?v=account-ux-4"', html)
            self.assertIn('class="account-benefits"', html)
            self.assertIn('class="account-side-footer"', html)
            self.assertIn('class="account-quicklinks"', html)
            self.assertIn('class="account-card"', html)


if __name__ == "__main__":
    unittest.main()
