"""Independent site contract regressions; no OS checkout, network or secrets."""
import json
import os
import subprocess
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build
from browser_smoke import responsive_breakpoint_audit
from public_release_catalog import render_catalog, validate_catalog, PublicReleaseCatalogError, _same_origin_path
from public_shell import PublicShellError, load_contract as load_public_shell, render_public_shell
from site_routes import load_routes
from site_seo import validate_origin, render_html
from smoke_static import check_css_dependencies

DEV_LOCK = build.load_dev_artifact_lock(ROOT / "contracts/dev-artifact-lock.json")
INVALID_MANIFEST_SHA256 = "0" * 64
PUBLIC_SHELL_LAYOUT_PROPERTIES = {
    "align-content", "align-items", "border", "border-top", "column-gap",
    "display", "flex", "flex-basis", "flex-direction", "flex-flow",
    "flex-grow", "flex-shrink", "flex-wrap", "gap", "grid-area",
    "grid-template-columns", "grid-template-areas", "height", "justify-content",
    "margin", "margin-inline", "margin-left", "max-height", "max-width",
    "min-height", "min-width", "overflow", "padding", "padding-inline",
    "position", "row-gap", "top", "width", "z-index",
}

class SiteContractTests(unittest.TestCase):
    def test_responsive_breakpoint_coverage_comes_from_route_css(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate = Path(tmp)
            (candidate / "assets").mkdir()
            (candidate / "index.html").write_text(
                '<link href="/assets/site.css?v=1" rel="preload stylesheet">'
                '<link rel="stylesheet" href="/assets/playground.css">',
                encoding="utf-8",
            )
            (candidate / "assets/site.css").write_text(
                "/* @media (max-width: 333px) {} */\n"
                "@media (max-width: 640px) { .item { max-width: 100px; } }\n"
                "@import url('./shared.css');\n",
                encoding="utf-8",
            )
            (candidate / "assets/shared.css").write_text(
                "@media (max-width: 760px) { .item { display: block; } }\n"
                "@media (min-width: 900px) { .item { display: grid; } }\n",
                encoding="utf-8",
            )
            (candidate / "assets/playground.css").write_text(
                "@media (max-width: 980px) { .demo { display: block; } }\n",
                encoding="utf-8",
            )

            audit = responsive_breakpoint_audit(candidate, "/")

        self.assertEqual(audit["thresholdsPx"], [640, 760, 900, 980])
        self.assertEqual(
            audit["testedWidths"],
            [639, 640, 641, 759, 761, 899, 900, 901, 979, 980, 981],
        )
        self.assertIn("/assets/playground.css", audit["ownerStylesheets"])

    def test_owner_and_routes(self):
        report = build.check_source(strict_assets=False)
        self.assertGreater(report["source_files"], 25)
        self.assertEqual(len(build.ROUTES), 11)
        self.assertEqual(len(set(build.ROUTES)), len(build.ROUTES))

    def test_desktop_windows_is_separate_from_usb_and_public_release(self):
        landing = (ROOT / "public/index.html").read_text(encoding="utf-8")
        page = (ROOT / "public/download/index.html").read_text(encoding="utf-8")
        self.assertIn('href="/download/#desktop"', landing)
        self.assertIn('id="desktop"', page)
        self.assertIn('id="creator"', page)
        self.assertLess(page.index('id="desktop"'), page.index('id="creator"'))
        self.assertIn(build.DESKTOP_EVALUATION_WORKFLOW, page)
        self.assertEqual(page.count('href="' + build.DESKTOP_EVALUATION_WORKFLOW + '"'), 1)
        self.assertIn('target="_blank" rel="noopener noreferrer"', page)
        self.assertIn("não é um download público homologado", page)
        self.assertIn("Não desative proteções do Windows", page)
        self.assertIn("A Aura local e os aplicativos externos dependem", page)
        self.assertIn("Windows x64", page)
        self.assertIn("releases/catalog.json", (ROOT / "public/assets/site.js").read_text())
        self.assertEqual(build.check_source(strict_assets=False)["source_files"] > 25, True)

    def test_landing_prioritizes_windows_and_single_download_guide_owner(self):
        landing = (ROOT / "public/index.html").read_text(encoding="utf-8")
        css = (ROOT / "public/assets/landing.css").read_text(encoding="utf-8")
        download = (ROOT / "public/download/index.html").read_text(encoding="utf-8")

        hero = landing.split('class="hero-actions"', 1)[1].split("</div>", 1)[0]
        self.assertIn('href="/download/#desktop"', hero)
        self.assertIn("Como testar no Windows", hero)

        modes = landing.split('class="landing-modes"', 1)[1].split(
            '</div><p class="landing-caption">', 1
        )[0]
        self.assertEqual(re.findall(r"<h3>(OrdaX [^<]+)</h3>", modes), [
            "OrdaX Desktop", "OrdaX Web", "OrdaX OS — USB",
            "OrdaX Mobile", "OrdaX OS — Nativo",
        ])
        self.assertEqual(
            re.findall(r'class="landing-mode-number" aria-hidden="true">(\d{2})', modes),
            ["01", "02", "03", "04", "05"],
        )
        self.assertIn('href="/download/#desktop"', modes)
        self.assertIn('href="/download/"', modes)
        self.assertIn("publicação final ainda pendente", modes)
        self.assertNotIn('class="landing-usb"', landing)
        self.assertNotIn('class="landing-start-steps"', landing)
        self.assertNotIn(".landing-usb", css)
        self.assertNotIn(".landing-start-steps", css)
        # A removed selector must not silently break the grouped narrow
        # viewport layout for the surrounding trust/safety cards.
        self.assertNotIn('body[data-page="landing"] body[data-page="landing"]', css)
        self.assertIn(
            'body[data-page="landing"] .landing-control, '
            'body[data-page="landing"] .landing-faq { grid-template-columns: minmax(0, 1fr); }',
            css,
        )
        self.assertIn('class="journey-steps"', download)
        self.assertLess(download.index('id="desktop"'), download.index('id="creator"'))

    def test_desktop_evaluation_link_allowlist_does_not_authorize_other_hosts(self):
        source = (ROOT / "scripts/build.py").read_text(encoding="utf-8")
        self.assertIn('DESKTOP_EVALUATION_WORKFLOW = "https://github.com/ordaxsystems/ordax-os/actions/workflows/windows-desktop-dev.yml?query=branch%3Amain"', source)
        self.assertIn("if p.suffix.lower() == \".html\":", source)
        self.assertIn("scrubbed.replace('href=\"' + DESKTOP_EVALUATION_WORKFLOW", source)
        self.assertNotIn("https://github.com/ordaxsystems/ordax-os/releases/download/", (ROOT / "public/download/index.html").read_text(encoding="utf-8"))

    def test_public_headers_share_one_action_and_navigation_structure(self):
        contract = load_public_shell(load_routes())
        for route in load_routes():
            source = (ROOT / "public" / route["source"]).read_text(encoding="utf-8")
            source = render_public_shell(source, route["path"], contract)
            header_match = re.search(
                r'<header class="site-header[^\"]*"[^>]*>(.*?)</header>',
                source,
                re.S,
            )
            if not header_match:
                continue  # /conta/ owns its application toolbar.

            header = header_match.group(1)
            brand_at = header.find('class="brand"')
            actions_at = header.find('class="site-actions"')
            nav_at = header.find('class="site-nav"')
            with self.subTest(route=route["path"]):
                self.assertGreaterEqual(nav_at, 0, "shared header needs one primary navigation")
                if route["path"] in contract["routes"]:
                    self.assertGreaterEqual(brand_at, 0, "shared header needs its brand first")
                    self.assertGreaterEqual(actions_at, 0)
                    self.assertLess(brand_at, actions_at)
                    self.assertLess(actions_at, nav_at)
                    nav_match = re.search(r'<nav class="site-nav"[^>]*>(.*?)</nav>', header, re.S)
                    self.assertIsNotNone(nav_match)
                    self.assertIn('<div class="site-nav-tools"></div>', nav_match.group(1))
                    self.assertRegex(nav_match.group(1), r'<div class="site-nav-links">.*?<a ')
                    self.assertNotIn("data-public-locale-slot", nav_match.group(1),
                                     "the locale runtime inserts its control before the first link")
                elif route["path"] in {"/privacidade/", "/termos/"}:
                    # The legal source bytes are Identity-hash protected. Their
                    # shared JS runtime normalizes the brand and actions.
                    self.assertGreaterEqual(brand_at, 0)
                    self.assertIn('data-auth-nav="login"', header)
                    self.assertIn('data-auth-nav="register"', header)

        for path in ("/privacidade/", "/termos/"):
            route = next(item for item in load_routes() if item["path"] == path)
            source = (ROOT / "public" / route["source"]).read_bytes()
            self.assertNotIn(b"ORDAX_PUBLIC_HEADER", source)
            self.assertNotIn(b"ORDAX_PUBLIC_FOOTER", source)

        locale = (ROOT / "public/i18n/runtime.js").read_text(encoding="utf-8")
        self.assertIn("function normalizePublicHeader()", locale)
        self.assertIn("const ensureAuthActionsGroup = actions =>", locale)
        self.assertIn('group.className = "site-auth-actions"', locale)
        self.assertIn("const addCompactRegisterLabel = actions =>", locale)
        self.assertIn('catalog.messages[SOURCE_LOCALE]?.["site.action.signup.compact"]', locale)
        self.assertIn('mobileLabel.dataset.shellLabel = "mobile"', locale)
        self.assertIn("function normalizePublicFooter()", locale)
        self.assertIn("function normalizePublicNavigation(nav)", locale)
        self.assertIn("function installResponsiveNavigation(nav, linksContainer)", locale)
        self.assertIn('toggle.setAttribute("aria-controls", nav.id)', locale)
        self.assertIn('toggle.setAttribute("aria-expanded", "false")', locale)
        self.assertIn("actions.append(toggle)", locale)
        self.assertIn('event.key === "Escape"', locale)
        self.assertIn("normalizePublicHeader();\n    normalizePublicFooter();\n    const nav =", locale)
        self.assertIn('footer?.querySelector(\':scope > a:first-child[href="/"]\')', locale)
        self.assertIn('headerBrand?.querySelector("img.brand-mark")?.getAttribute("src")', locale)
        self.assertIn("navigation.tools.prepend(host)", locale)
        self.assertIn("localeSlot.replaceWith(host)", locale)

        shared_css = (ROOT / "public/assets/site.css").read_text(encoding="utf-8")
        smoke = (ROOT / "scripts/browser_smoke.py").read_text(encoding="utf-8")
        self.assertEqual(
            len(re.findall(r"(?m)^html body\[data-page\] \.site-header\s*\{", shared_css)),
            1,
            "public header geometry belongs to the shared site shell",
        )
        self.assertIn('.site-header[data-nav-enhanced="true"] > .site-nav {', shared_css)
        self.assertRegex(
            shared_css,
            r'\.site-header\[data-nav-enhanced="true"\] > \.site-nav \{\s+position: absolute;[\s\S]*?display: none;',
        )
        self.assertIn(
            '.site-header[data-nav-enhanced="true"] > .site-nav[data-expanded="true"] {\n    display: grid;',
            shared_css,
        )
        self.assertIn('grid-template-columns: minmax(0, 1fr) max-content;', shared_css)
        self.assertIn('--public-content-top-space: clamp(32px, 4.4vw, 58px);', shared_css)
        self.assertIn('flex-wrap: wrap;', shared_css)
        self.assertIn('textDoesNotOverlapSiteControls', smoke)
        self.assertIn('.site-header > .site-actions > .site-nav-toggle', shared_css)
        self.assertIn('.site-header > .site-actions > .site-auth-actions', shared_css)
        auth_group = re.search(r"(?m)^\.site-auth-actions\s*\{([^{}]*)\}", shared_css)
        self.assertIsNotNone(auth_group)
        self.assertNotRegex(auth_group.group(1), r"(?m)^\s*(?:border|background)\s*:")
        self.assertIn("gap: clamp(8px, 1.2vw, 16px);", auth_group.group(1))
        self.assertIn(
            '.site-header > .site-actions > .site-auth-actions > [data-auth-nav="login"] {',
            shared_css,
        )
        self.assertIn(
            '.site-header > .site-actions > .site-auth-actions > [data-auth-nav="register"] {',
            shared_css,
        )
        self.assertIn("background: var(--ordax-button-bg, var(--ordax-accent, var(--accent)));", shared_css)
        self.assertIn("color: var(--ordax-button-text, var(--ordax-accent-ink, #fff));", shared_css)
        self.assertIn('.site-header > .site-actions [data-shell-label="desktop"]', shared_css)
        self.assertIn('.site-header > .site-actions [data-shell-label="mobile"]', shared_css)
        self.assertIn(
            '.site-header > .site-actions > .site-auth-actions > .nav-cta [data-shell-label] {\n  margin: 0;',
            shared_css,
        )
        self.assertIn('.site-header > .site-actions > .site-nav-toggle > span {\n    display: none;', shared_css)
        self.assertIn('.site-nav[data-expanded="true"] .public-locale-switcher > .sr-only', shared_css)
        self.assertIn("publicHeaderMobileLocaleInDisclosure", smoke)
        self.assertIn("localeCanSwitchInsideDisclosure", smoke)
        self.assertIn("menuPanelFitsViewport", smoke)
        self.assertIn("navigationLandmarksMatchLocale", smoke)
        header_layout_properties = PUBLIC_SHELL_LAYOUT_PROPERTIES - {"border", "border-top"}
        for sheet in (ROOT / "public/assets").glob("*.css"):
            if sheet.name in {"site.css", "account-dashboard.css"}:
                continue
            source = sheet.read_text(encoding="utf-8")
            for selector, block in re.findall(r"([^{}]+)\{([^{}]*)\}", source):
                if not any(component in selector for component in (
                        ".site-header", ".site-actions", ".site-auth-actions", ".site-nav", ".site-nav-tools",
                        ".site-nav-links", ".brand", ".brand-mark", ".site-nav-toggle",
                        ".public-locale-switcher", ".public-locale-select")):
                    continue
                declarations = {
                    declaration.split(":", 1)[0].strip().lower()
                    for declaration in block.split(";")
                    if ":" in declaration
                }
                if ".nav-cta" in selector:
                    declarations.discard("display")  # page-specific CTA decoration only
                with self.subTest(sheet=sheet.name, selector=selector.strip()):
                    self.assertFalse(
                        declarations & header_layout_properties,
                        "page styles may theme the header, not redefine its layout",
                    )
        account_css = (ROOT / "public/assets/account.css").read_text(encoding="utf-8")
        landing_css = (ROOT / "public/assets/landing.css").read_text(encoding="utf-8")
        self.assertIn(".sr-only {", shared_css)
        self.assertNotIn(".account-ui .sr-only", account_css)
        self.assertNotIn('body[data-page="landing"] .sr-only', landing_css)

    def test_portal_document_and_auth_layouts_have_one_stylesheet_owner(self):
        shared_css = (ROOT / "public/assets/site.css").read_text(encoding="utf-8")
        portal_css = (ROOT / "public/assets/portal.css").read_text(encoding="utf-8")
        for selector in (".page-shell", ".page-hero", ".auth-shell", ".auth-copy"):
            with self.subTest(selector=selector):
                self.assertNotRegex(
                    shared_css,
                    rf"(?<![\w-]){re.escape(selector)}(?![\w-])",
                    "portal page layout must not be redefined in the public landing stylesheet",
                )
                self.assertRegex(
                    portal_css,
                    rf"(?<![\w-]){re.escape(selector)}(?![\w-])",
                    "portal.css must remain the authoritative owner",
                )

    def test_identity_mobile_stack_preserves_document_order(self):
        account_css = (ROOT / "public/assets/account.css").read_text(encoding="utf-8")
        self.assertNotRegex(
            account_css,
            r"\border\s*:\s*\d+",
            "mobile identity layouts must not visually reorder sections away from the DOM",
        )

        expected_sections = {
            "public/login/index.html": ["account-access", "account-story"],
            "public/cadastro/index.html": ["account-access", "account-story"],
            "public/recuperar/index.html": ["account-access", "account-story"],
            "public/recuperar/nova-senha/index.html": ["account-access", "account-story"],
            "public/web/index.html": ["account-story", "account-access"],
        }
        for source_path, expected in expected_sections.items():
            markup = (ROOT / source_path).read_text(encoding="utf-8")
            actual = re.findall(r'<section class="(account-access|account-story)\b', markup)
            with self.subTest(route=source_path):
                self.assertEqual(actual, expected)

        web_markup = (ROOT / "public/web/index.html").read_text(encoding="utf-8")
        self.assertLess(web_markup.index('class="account-story"'),
                        web_markup.index('class="account-access"'))
        self.assertLess(web_markup.index('class="account-access"'),
                        web_markup.index('class="web-details"'))
        web_css = (ROOT / "public/assets/web-entry.css").read_text(encoding="utf-8")
        self.assertIn('grid-template-areas: "story access" "details access";', web_css)

    def test_public_content_gutters_and_landing_rhythm_have_single_source(self):
        shared_css = (ROOT / "public/assets/site.css").read_text(encoding="utf-8")
        portal_css = (ROOT / "public/assets/portal.css").read_text(encoding="utf-8")
        download_css = (ROOT / "public/assets/download.css").read_text(encoding="utf-8")
        account_css = (ROOT / "public/assets/account.css").read_text(encoding="utf-8")

        self.assertEqual(
            len(re.findall(r"(?m)^\s*--public-page-gutter\s*:", shared_css)), 1,
            "the responsive public content gutter has one token owner",
        )
        self.assertEqual(
            len(re.findall(r"(?m)^\s*--public-content-top-space\s*:", shared_css)), 1,
            "the public page start rhythm has one token owner",
        )
        self.assertEqual(
            len(re.findall(r"(?m)^\s*--public-section-block-space\s*:", shared_css)), 1,
            "the landing section rhythm has one token owner",
        )
        self.assertIn("padding: var(--public-page-gutter);", shared_css)
        self.assertIn("padding: 70px var(--public-page-gutter) 84px;", shared_css)
        self.assertIn(
            "padding: var(--public-section-block-space) var(--public-page-gutter);",
            shared_css,
        )
        self.assertIn("padding-inline: var(--public-page-gutter);", shared_css)
        self.assertIn("var(--public-content-top-space)", portal_css)
        self.assertIn("page-hero{max-width:920px;padding:0 0 55px}", portal_css)
        self.assertIn(
            ".download-hero{padding:32px var(--public-page-gutter) 120px;min-height:480px;display:block}",
            download_css,
            "the mobile download hero must use the shared gutter and compact vertical rhythm",
        )
        self.assertIn(
            ".art-caption{top:auto;bottom:18px;right:var(--public-page-gutter);font-size:7px}",
            download_css,
            "mobile download decoration must align to the shared page gutter",
        )
        stage_rules = re.findall(r"(?s)\.account-ui\s+\.account-stage\s*\{([^{}]*)\}", account_css)
        padded_stage_rules = [
            block for block in stage_rules if re.search(r"\bpadding(?:-inline)?\s*:", block)
        ]
        self.assertGreaterEqual(len(padded_stage_rules), 2)
        for block in padded_stage_rules:
            with self.subTest(account_stage=block[:100]):
                self.assertIn("var(--public-page-gutter)", block)

        for sheet, source, selector in (
            ("portal.css", portal_css, r"\.page-shell\s*\{([^{}]*)\}"),
            ("download.css", download_css, r"\.download-container\s*\{([^{}]*)\}"),
        ):
            blocks = re.findall(selector, source)
            self.assertTrue(blocks, f"{sheet} must own its page container")
            for block in blocks:
                with self.subTest(sheet=sheet, block=block[:80]):
                    self.assertIn("var(--public-page-gutter)", block)

    def test_public_footers_share_one_layout_source(self):
        contract = load_public_shell(load_routes())
        shared_css = (ROOT / "public/assets/site.css").read_text(encoding="utf-8")
        self.assertEqual(
            len(re.findall(r"(?m)^html body\[data-page\] footer\.site-footer\s*\{", shared_css)),
            1,
            "public footer geometry belongs to the shared site shell",
        )
        self.assertIn("@media (max-width: 1050px)", shared_css)
        footer_targets = re.search(
            r"(?s)html body\[data-page\] footer\.site-footer \.brand,.*?\{([^}]*)\}",
            shared_css,
        )
        self.assertIsNotNone(footer_targets)
        self.assertRegex(footer_targets.group(1), r"min-width:\s*44px")
        self.assertRegex(footer_targets.group(1), r"min-height:\s*44px")

        account_css = (ROOT / "public/assets/account-dashboard.css").read_text(encoding="utf-8")
        account_footer_targets = re.search(
            r"(?m)^body\.account-portal \.page-footer>div>a\{([^}]*)\}", account_css
        )
        self.assertIsNotNone(account_footer_targets)
        self.assertRegex(account_footer_targets.group(1), r"min-width:\s*44px")
        self.assertRegex(account_footer_targets.group(1), r"min-height:\s*44px")
        self.assertIn("body.account-portal .identity-bottom .text-link{min-width:44px;min-height:44px}", account_css)
        self.assertIn("body.account-portal .topbar-center>a{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px}", account_css)

        for sheet in (ROOT / "public/assets").glob("*.css"):
            if sheet.name in {"site.css", "account-dashboard.css"}:
                continue
            source = sheet.read_text(encoding="utf-8")
            for selector, block in re.findall(r"([^{}]+)\{([^{}]*)\}", source):
                if ".site-footer" not in selector:
                    continue
                declarations = {
                    declaration.split(":", 1)[0].strip().lower()
                    for declaration in block.split(";")
                    if ":" in declaration
                }
                with self.subTest(sheet=sheet.name, selector=selector.strip()):
                    self.assertFalse(
                        declarations & PUBLIC_SHELL_LAYOUT_PROPERTIES,
                        "page styles may set footer theme and type, not layout",
                    )

        for route in load_routes():
            source = (ROOT / "public" / route["source"]).read_text(encoding="utf-8")
            source = render_public_shell(source, route["path"], contract)
            with self.subTest(route=route["path"]):
                if route["path"] == "/conta/":
                    self.assertIn('<footer class="page-footer">', source)
                    self.assertNotIn('<footer class="site-footer">', source)
                else:
                    self.assertIn('<footer class="site-footer">', source)

    def test_public_shell_is_generated_from_one_contract(self):
        contract = load_public_shell(load_routes())
        expected_paths = {route["path"] for route in load_routes()} - {
            item["path"] for item in contract["exceptions"]
        }
        self.assertEqual(set(contract["routes"]), expected_paths)
        for route in load_routes():
            source = (ROOT / "public" / route["source"]).read_text(encoding="utf-8")
            rendered = render_public_shell(source, route["path"], contract)
            with self.subTest(route=route["path"]):
                if route["path"] not in contract["routes"]:
                    self.assertEqual(rendered, source)
                    continue
                header = re.search(r'<header class="site-header">(.*?)</header>', rendered, re.S)
                footer = re.search(r'<footer class="site-footer">(.*?)</footer>', rendered, re.S)
                self.assertIsNotNone(header)
                self.assertIsNotNone(footer)
                self.assertEqual(header.group(1).count('class="brand"'), 1)
                self.assertEqual(header.group(1).count('class="site-actions"'), 1)
                self.assertEqual(header.group(1).count('class="site-auth-actions"'), 1)
                self.assertEqual(header.group(1).count('class="site-nav"'), 1)
                self.assertEqual(header.group(1).count('class="site-nav-tools"'), 1)
                self.assertEqual(header.group(1).count('class="site-nav-links"'), 1)
                self.assertEqual(footer.group(1).count('aria-label="Rodapé"'), 1)
                self.assertNotIn('data-public-locale-slot', header.group(1))
                actions = contract["routes"][route["path"]]["actions"]
                expected_mobile_labels = sum("mobile_label" in item for item in actions)
                self.assertEqual(
                    header.group(1).count('data-shell-label="mobile"'),
                    expected_mobile_labels,
                    "compact action labels must be rendered from the shell contract",
                )
                if expected_mobile_labels:
                    self.assertEqual(
                        header.group(1).count('data-shell-label="desktop"'),
                        expected_mobile_labels,
                    )
                if route["path"] == "/":
                    self.assertIn(
                        '</span><span aria-hidden="true">↗</span>',
                        header.group(1),
                        "CTA spacing belongs to the shell gap, not a whitespace flex item",
                    )
                self.assertNotIn("<!-- ORDAX_PUBLIC_HEADER -->", rendered)
                self.assertNotIn("<!-- ORDAX_PUBLIC_FOOTER -->", rendered)

        landing = (ROOT / "public/index.html").read_text(encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "markers must each occur once"):
            render_public_shell(landing.replace("<!-- ORDAX_PUBLIC_HEADER -->", ""), "/", contract)

    def test_public_shell_profiles_remove_repeated_route_fragments(self):
        path = ROOT / "contracts/public-shell.json"
        raw = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(raw["$schema"], "ordax.site-public-shell/2")
        self.assertEqual(
            raw["routes"]["/cadastro/"]["actions"], {"profile": "login-primary"}
        )
        for route in ("/login/", "/cadastro/"):
            with self.subTest(route=route):
                self.assertEqual(raw["routes"][route]["navigation"], {"profile": "home-only"})
                self.assertEqual(raw["routes"][route]["footer"], {"profile": "identity"})
        for route in ("/recuperar/", "/recuperar/nova-senha/"):
            with self.subTest(route=route):
                self.assertEqual(raw["routes"][route]["navigation"], {"profile": "home-only"})
                self.assertEqual(raw["routes"][route]["footer"], {"profile": "identity-recovery"})

        expanded = load_public_shell(load_routes())
        self.assertEqual(
            expanded["routes"]["/cadastro/"]["actions"],
            raw["profiles"]["actions"]["login-primary"],
        )
        self.assertEqual(
            expanded["routes"]["/login/"]["footer"],
            raw["profiles"]["footers"]["identity"],
        )
        self.assertEqual(
            expanded["routes"]["/recuperar/"]["footer"],
            raw["profiles"]["footers"]["identity-recovery"],
        )

        raw["routes"]["/cadastro/"]["footer"] = {"profile": "missing"}
        with tempfile.TemporaryDirectory() as tmp:
            malformed = Path(tmp) / "public-shell.json"
            malformed.write_text(json.dumps(raw), encoding="utf-8")
            with self.assertRaisesRegex(PublicShellError, "unknown profile"):
                load_public_shell(load_routes(), malformed)

    def test_account_navigation_is_derived_from_section_metadata(self):
        portal = (ROOT / "public/assets/account-portal.js").read_text(encoding="utf-8")
        catalog = (ROOT / "public/i18n/catalog.js").read_text(encoding="utf-8")
        account_css = (ROOT / "public/assets/account-dashboard.css").read_text(encoding="utf-8")
        self.assertIn(
            "sections.filter(section => section.navigationGroup === group.id).map(section => section.id)",
            portal,
        )
        self.assertIn("sections.filter(section => section.mobileLabel)", portal)
        self.assertIn("sections.filter(section => section.mobileOverflow)", portal)
        self.assertNotRegex(portal, r"const mobileSections\s*=\s*Object\.freeze\(\s*\[")
        for label in ("Resumo", "Plano", "Consumo", "Segurança"):
            with self.subTest(label=label):
                self.assertIn(f'mobileLabel: "{label}"', portal)
                self.assertRegex(catalog, r'\["' + re.escape(label) + r'"\s*,')
        self.assertEqual(
            len(re.findall(r"(?m)^\s*body\.account-portal \.mobile-nav\{", account_css)),
            1,
            "mobile navigation geometry must have one responsive owner",
        )
        self.assertEqual(
            account_css.count(
                "body.account-portal .account-main{padding:82px 16px calc(100px + env(safe-area-inset-bottom))}"
            ),
            1,
            "phone account content spacing must have one mobile-shell owner",
        )
        self.assertNotIn(
            "body.account-portal .account-main{margin-left:0;padding:82px 18px 90px}",
            account_css,
            "superseded phone account spacing must not return",
        )
        self.assertIn(
            "body.account-portal .mobile-more[open]{display:block;position:fixed;inset:64px 0 calc(72px + env(safe-area-inset-bottom));height:auto;width:100%;max-width:none;max-height:none;margin:0;padding:20px;border:0;border-radius:0;background:var(--background);z-index:39;overflow:auto;overscroll-behavior:contain}",
            account_css,
            "phone overflow navigation must own its complete viewport geometry",
        )

    def test_web_product_links_respect_site_entry_gate_and_status(self):
        landing = (ROOT / "public/index.html").read_text(encoding="utf-8")
        account = (ROOT / "public/conta/index.html").read_text(encoding="utf-8")
        web = (ROOT / "public/web/index.html").read_text(encoding="utf-8")
        runtime = (ROOT / "public/assets/site.js").read_text(encoding="utf-8")
        config = json.loads((ROOT / "public/config/public-site.json").read_text(encoding="utf-8"))

        self.assertEqual(landing.count('href="/web/"'), 1)
        self.assertEqual(account.count('href="/web/"'), 3)
        self.assertNotIn('https://web.ordax.com.br/', landing + account)
        shell_source = (ROOT / "contracts/public-shell.json").read_text(encoding="utf-8")
        shell = load_public_shell(load_routes())
        footer_markup = render_public_shell(landing, "/", shell)
        footer = footer_markup.split('<footer class="site-footer">', 1)[1].split(
            "</footer>", 1
        )[0]
        self.assertNotIn('https://web.ordax.com.br/', shell_source)
        self.assertIn('href="/web/"', footer)
        self.assertEqual(footer.count('href="/web/"'), 1)
        # No exception may reauthorize direct product hosts outside /web/.
        self.assertNotIn("EXTERNAL_HREFS", (ROOT / "scripts/public_shell.py").read_text(encoding="utf-8"))
        direct_shell = json.loads(shell_source)
        direct_shell["routes"]["/"]["footer"]["navigation"] = [
            {**item, "href": "https://web.ordax.com.br/"}
            if item["label"] == "OrdaX Web" else item
            for item in direct_shell["routes"]["/"]["footer"]["navigation"]
        ]
        with tempfile.TemporaryDirectory() as tmp:
            injected = Path(tmp) / "public-shell.json"
            injected.write_text(json.dumps(direct_shell), encoding="utf-8")
            with self.assertRaisesRegex(PublicShellError, "unsafe link target"):
                load_public_shell(load_routes(), injected)
        self.assertIn('data-web-launch hidden', web)
        self.assertIs(config["product"]["web"]["enabled"], False)
        self.assertIsNone(config["product"]["web"]["entry_url"])
        gate = runtime.split("async function renderWebEntry(config)", 1)[1].split(
            "async function renderIdentity(", 1
        )[0]
        self.assertLess(gate.index("const path = productWebEntry(config)"),
                        gate.index("await verifiedIdentitySession()"))
        self.assertIn('if (!path)', gate)
        self.assertIn('state.dataset.status = "unavailable"', gate)
        self.assertIn('launch.removeAttribute("href")', gate)

    def test_identity_rejects_legacy_bearer_fragments_on_all_form_routes(self):
        source = (ROOT / "public/assets/site.js").read_text(encoding="utf-8")
        browser = (ROOT / "scripts/browser_smoke.py").read_text(encoding="utf-8")
        # Reuse the route set already required for local, read-only preview
        # instead of maintaining a competing token-route allowlist.
        self.assertIn("IDENTITY_PREVIEW_PATHS.has(window.location.pathname)", source)
        self.assertIn('window.location.hash.includes("=")', source)
        self.assertIn("window.history.replaceState", source)
        self.assertIn("for identity_route in NO_SCRIPT_ROUTES[:4]", browser)
        self.assertIn('hashPreserved: window.location.hash === \'#conteudo\'', browser)

    def test_identity_and_mcp_account_data_share_bounded_json_transport(self):
        shell = (ROOT / "public/assets/site.js").read_text(encoding="utf-8")
        portal = (ROOT / "public/assets/account-portal.js").read_text(encoding="utf-8")
        self.assertIn("const MAX_PUBLIC_JSON_BYTES = 256 * 1024", shell)
        self.assertIn("async function readJsonBytes(response", shell)
        self.assertIn('return parseJsonBytes(await readJsonBytes(response, maxBytes))', shell)
        self.assertIn('const timeoutId = setTimeout(() => deadline.abort(), 10000)', shell)
        self.assertIn('signal: deadline.signal', shell)
        self.assertIn('clearTimeout(timeoutId)', shell)
        self.assertIn('signal?.removeEventListener("abort", onAbort)', shell)
        self.assertNotIn('AbortSignal.timeout(10000)', shell)
        self.assertIn('sessionPromise = loadJson("/auth/session").then', shell)
        self.assertIn('const payload = await loadJson("/account/usage/mcp", signal)', shell)
        self.assertIn('owner !== sessionView', shell)
        self.assertIn('if (mcpUsageSession !== session)', portal)
        self.assertNotIn('session.email || "verified-session"', portal)
        self.assertIn('const bytes = await readJsonBytes(response, record.size)', shell)
        self.assertIn("account.readMcpUsage(signal)", portal)
        self.assertNotIn('fetch("/account/usage/mcp"', portal)
        self.assertNotIn("response.json()", portal)

    def test_live_auth_is_not_activated_by_static_source(self):
        data = json.loads((ROOT / "public/config/public-site.json").read_text(encoding="utf-8"))
        self.assertFalse(data["legal"]["account_activation_ready"])
        self.assertFalse(data["product"]["web"]["enabled"])
        self.assertIsNone(data["identity"]["recovery_url"])
        self.assertIsNone(data["identity"]["recovery_complete_url"])
        self.assertEqual(data["downloads"]["catalog_url"], "/releases/catalog.json")

    def test_brand_not_implicitly_read_from_os(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(build.SiteError):
                build.stage_brand(Path(tmp), Path(tmp) / "nonexistent", INVALID_MANIFEST_SHA256)
        # The Site now verifies the actual canonical OS visual sources instead
        # of excluding them and trusting historical Surface release metadata.
        exporter = (ROOT / "scripts/canonical_artifacts.py").read_text()
        self.assertIn('surface.verify_source(ROOT', exporter)
        self.assertIn('source_repository', (ROOT / "scripts/build.py").read_text())

    def test_same_commit_artifact_lock_rejects_archived_releases(self):
        self.assertEqual(DEV_LOCK, {"brand": "source-bound", "surface_preview": "source-bound"})
        doc = json.loads((ROOT / "contracts/dev-artifact-lock.json").read_text("utf-8"))
        self.assertEqual(doc["$schema"], "ordax.site-dev-artifact-lock/3")
        self.assertEqual(doc["source_repository"], "ordaxsystems/ordax-os")
        self.assertEqual(doc["source_ref"], "same-commit")
        self.assertEqual(doc["visual_source_contract"], "docs/contracts/surface-source.json")
        self.assertEqual(doc["producer"], "site/scripts/canonical_artifacts.py")
        self.assertNotIn("release_tag", str(doc))
        self.assertNotIn("ordaxsystems/ordax-surface", str(doc))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "forged.json"
            for key, invalid in (
                ("source_repository", "ordaxsystems/ordax-surface"),
                ("source_ref", "legacy-git-release"),
                ("status", "official"),
                ("producer", "tools/public-artifacts/brand.py"),
            ):
                with self.subTest(field=key):
                    path.write_text(json.dumps({**doc, key: invalid}), encoding="utf-8")
                    with self.assertRaisesRegex(build.SiteError, "canonical Dev artifact lock"):
                        build.load_dev_artifact_lock(path)

    def test_active_operational_docs_use_only_current_signed_dev_artifacts(self):
        """Retired migration inputs must not return via published runbooks."""
        docs = ("README.md", "docs/ACCESSIBILITY-GATES.md")
        for name in docs:
            with self.subTest(document=name):
                content = (ROOT / name).read_text(encoding="utf-8")
                self.assertIn("contracts/dev-artifact-lock.json", content)
                self.assertNotIn("contracts/migration-artifact-lock.json", content)
                self.assertNotIn("--migration-lock", content)
        self.assertFalse((ROOT / "contracts/migration-artifact-lock.json").exists())
        self.assertEqual(set(DEV_LOCK), {"brand", "surface_preview"})
        deployment = json.loads((ROOT.parent / "vercel.json").read_text(encoding="utf-8"))
        self.assertEqual(deployment["buildCommand"], "python3 tools/vercel/build.py")
        canonical_builder = (ROOT.parent / "tools/vercel/build.py").read_text(encoding="utf-8")
        self.assertIn('"--dev-lock", str(lock)', canonical_builder)
        self.assertIn('ROOT / "site/contracts/dev-artifact-lock.json"', canonical_builder)

    def test_site_inactive_plans_do_not_duplicate_os_entitlements(self):
        self.assertFalse((ROOT / "artifacts/offers/os-migration-70b0f7eb").exists())
        self.assertNotIn("offers", DEV_LOCK)
        self.assertIn("Planos em preparação", build.INACTIVE_PLANS_HTML)
        self.assertIn("contratação indisponível", build.INACTIVE_PLANS_HTML)
        self.assertNotIn("commercial-plan", build.INACTIVE_PLANS_HTML)

    def test_unattested_releases_cannot_enter_public_bundle(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(build.SiteError, "attested publisher"):
                build.build(Path(tmp) / "out", "0" * 40, Path(tmp),
                            Path(tmp) / "arbitrary-publications.json",
                            public_origin="https://ordax.com.br")

    def test_bundle_publication_state_is_not_a_self_authorization_flag(self):
        # Tiny self-contained bundle proves the verifier uses the already
        # canonical manifest, without staging Surface or calling any backend.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            artifact = out / "releases/catalog.json"
            artifact.parent.mkdir()
            artifact.write_text(json.dumps(render_catalog({"releases": []})), encoding="utf-8")
            config = out / "config/public-site.json"
            config.parent.mkdir()
            config.write_text('{"$schema":"prototype-ordax.public-site-runtime/1"}', encoding="utf-8")
            ledger = {
                "$schema": build.SCHEMA, "source_commit": "1" * 40,
                "artifact_class": "public-site",
                "catalog_status": "empty", "publications_sha256": None,
                "files": [
                    {"path": entry.relative_to(out).as_posix(),
                     "size": entry.stat().st_size,
                     "sha256": build.digest(entry.read_bytes())}
                    for entry in (artifact, config)
                ],
            }
            manifest = out / "public-site-manifest.json"

            def verify_with(**fields):
                manifest.write_text(json.dumps({**ledger, **fields}), encoding="utf-8")
                build.verify(out)

            verify_with()
            with self.assertRaisesRegex(build.SiteError, "publication state mismatch"):
                verify_with(catalog_status="ready")
            with self.assertRaisesRegex(build.SiteError, "empty catalog cannot have"):
                verify_with(publications_sha256="f" * 64)
            with self.assertRaisesRegex(build.SiteError, "publication state mismatch"):
                verify_with(catalog_status="missing")

    def test_build_and_staging_share_one_strict_bundle_inventory_contract(self):
        records = [
            {"path": "config/public-site.json", "size": 12, "sha256": "a" * 64},
            {"path": "releases/catalog.json", "size": 0, "sha256": "b" * 64},
            {"path": "login/index.html", "size": 24, "sha256": "c" * 64},
        ]
        manifest = {"files": records}
        self.assertEqual(set(build.validate_bundle_inventory(manifest)),
                         {row["path"] for row in records})
        for modification in (
            lambda v: v["files"].append(dict(v["files"][0])),
            lambda v: v["files"][0].update({"path": "login/../index.html"}),
            lambda v: v["files"][0].update({"path": "public-site-manifest.json"}),
            lambda v: v["files"][0].update({"size": True}),
            lambda v: v["files"][0].update({"sha256": "not-hash"}),
            lambda v: v["files"].append({"path": "login", "size": 1, "sha256": "d" * 64}),
            lambda v: v["files"].pop(0),
            lambda v: v["files"][0].update({"size": build.MAX_BUNDLE_BYTES + 1}),
        ):
            import copy
            bad = copy.deepcopy(manifest)
            modification(bad)
            with self.subTest(bad=bad), self.assertRaises(build.SiteError):
                build.validate_bundle_inventory(bad)

    def test_self_attested_ready_catalog_is_rejected_even_if_bundle_bytes_match(self):
        # Do not mistake manifest integrity for publisher authority. Simulate
        # a valid release and a matching altered manifest entirely offline.
        asset = lambda href: {"href": href, "sha256": "a" * 64, "size": 123}
        commit = "1" * 40
        published = render_catalog({"releases": [{
            "release_id": commit, "source_commit": commit,
            "version": "offline-test", "channel": "test",
            "published_at": "2026-10-24", "public_authorized": True,
            "targets": [{"id": "test-image", "label": "Test", **asset("/test.img"),
                         "public_download_authorized": True}],
            "compliance": {"public_compliance_authorized": True,
                           "sbom": asset("/test-sbom.json"),
                           "third_party_notices": asset("/test-notices.txt"),
                           "source_bundle": asset("/test-source.tar.gz")},
        }]})
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            catalog = out / "releases/catalog.json"
            catalog.parent.mkdir(parents=True)
            catalog.write_text(json.dumps(published), encoding="utf-8")
            config = out / "config/public-site.json"
            config.parent.mkdir(parents=True)
            config.write_text('{"$schema":"prototype-ordax.public-site-runtime/1"}',
                              encoding="utf-8")
            manifest = {
                "$schema": build.SCHEMA, "artifact_class": "public-site",
                "source_commit": commit,
                "catalog_status": "ready", "publications_sha256": "a" * 64,
                "files": [{"path": p.relative_to(out).as_posix(),
                           "sha256": build.digest(p.read_bytes()),
                           "size": p.stat().st_size} for p in (config, catalog)],
            }
            (out / "public-site-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            with self.assertRaisesRegex(build.SiteError, "independently attested publisher"):
                build.verify(out)

    def test_unauthorized_catalog_fails_closed(self):
        result = render_catalog({"releases": []})
        self.assertEqual(result["status"], "empty")
        self.assertEqual(result["releases"], [])
        with self.assertRaises(PublicReleaseCatalogError):
            render_catalog({"releases": [{"release_id": "0" * 40, "public_authorized": False}]})

    def test_distributed_ready_catalog_rejects_partial_or_duplicate_downloads(self):
        # Synthetic, never distributed publisher data; the real builder keeps
        # releases empty without an independently attested publisher handoff.
        asset = lambda href: {"href": href, "sha256": "a" * 64, "size": 123}
        target = {"id": "usb-amd64", "label": "Test target",
                  **asset("/downloads/test-only.img")}
        release_id = "1" * 40
        authorized_test_projection = render_catalog({"releases": [{
            "release_id": release_id,
            "source_commit": release_id,
            "version": "test-only",
            "channel": "test",
            "published_at": "2026-10-24",
            "public_authorized": True,
            "targets": [{**target, "public_download_authorized": True}],
            "compliance": {
                "public_compliance_authorized": True,
                "sbom": asset("/compliance/test-sbom.json"),
                "third_party_notices": asset("/compliance/test-notices.txt"),
                "source_bundle": asset("/compliance/test-sources.tar.gz"),
            },
        }]})
        import copy
        original = authorized_test_projection["releases"][0]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "catalog.json"
            def check(value):
                path.write_text(json.dumps(value), encoding="utf-8")
                return validate_catalog(path)
            self.assertEqual(check(authorized_test_projection), authorized_test_projection)

            for field in ("version", "channel", "published_at"):
                invalid = copy.deepcopy(authorized_test_projection)
                invalid["releases"][0][field] = "  "
                with self.subTest(field=field), self.assertRaisesRegex(
                    PublicReleaseCatalogError, field
                ):
                    check(invalid)

            invalid = copy.deepcopy(authorized_test_projection)
            invalid["releases"][0]["targets"].append(copy.deepcopy(
                invalid["releases"][0]["targets"][0]
            ))
            with self.assertRaisesRegex(PublicReleaseCatalogError, "duplicate target id"):
                check(invalid)

            invalid = copy.deepcopy(authorized_test_projection)
            invalid["releases"][0]["targets"][0]["href"] = "/downloads/%2e%2e/auth/login"
            with self.assertRaisesRegex(PublicReleaseCatalogError, "same-origin"):
                check(invalid)

    def test_published_release_links_have_unambiguous_root_paths(self):
        for value in ("/releases/ordax-1.0.img", "/downloads/x86_64/stable.iso",
                      "/compliance/source_bundle-1.0.tar.gz"):
            with self.subTest(value=value):
                self.assertTrue(_same_origin_path(value))
        for value in ("/", "//remote/path", "/../account/export",
                      "/releases/../account/export", "/releases/./x",
                      "/releases//x", r"/releases\\x",
                      "/releases/%2e%2e/secret", "/releases/%2fadmin",
                      "/releases/secret?key=1", "/releases/file#fragment",
                      "https://example.org/file", "/releases/white space"):
            with self.subTest(value=value):
                self.assertFalse(_same_origin_path(value))

    def test_path_boundaries(self):
        for value in ("/auth/login", "/download/release.bin", "/terms/"):
            self.assertTrue(build.safe_relative(value))
        for value in ("https://example.com", "//host/auth", "/../auth", "/foo?bar", "/foo#bar", r"/foo\bar"):
            self.assertFalse(build.safe_relative(value))

    def test_original_asset_provenance_is_locked(self):
        # Missing images block the distributable build; do not replace them with
        # placeholders or fake marketing graphics just to make CI green.
        result = build.check_source(strict_assets=False)
        missing = set(result["missing_source_assets"])
        self.assertTrue(missing.issubset(set(build.BINARY_PROVENANCE)))
        if missing:
            with self.assertRaises(build.SiteError):
                build.check_source(strict_assets=True)
        else:
            self.assertFalse(build.check_source(strict_assets=True)["missing_source_assets"])

    def test_route_ssot_and_sensitive_indexing(self):
        routes = load_routes()
        self.assertEqual(len(routes), 11)
        self.assertEqual(tuple(route["source"] for route in routes), build.ROUTES)
        self.assertEqual(sum(route["indexable"] for route in routes), 5)
        for route in routes:
            self.assertTrue((ROOT / "public" / route["source"]).is_file())
            if route["path"] in ("/conta/", "/login/", "/cadastro/", "/recuperar/",
                                 "/recuperar/nova-senha/", "/web/"):
                self.assertFalse(route["indexable"])

    def test_seo_origin_is_explicit_and_https_only(self):
        self.assertEqual(validate_origin("https://ordax.com.br"), "https://ordax.com.br")
        for invalid in ("http://ordax.com.br", "https://ordax.com.br/",
                        "https://ordax.com.br/path", "https://ordax.com.br?redirect=x",
                        "https://user:pass@ordax.com.br", "https://ordax..com",
                        "//ordax.com.br", "https://ordax.com.br:8443"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_origin(invalid)

    def test_verified_brand_favicon_is_added_once(self):
        routes = {record["path"]: record for record in load_routes()}
        html = '<html><head><title>Site</title><meta name="description" content="Portal"></head><body></body></html>'
        public = render_html(html, routes["/"], "https://ordax.com.br")
        self.assertEqual(public.count('rel="icon"'), 1)
        self.assertIn('href="/assets/ordax-symbol.png"', public)
        existing = html.replace('</head>', '<link rel="icon" href="/assets/ordax-symbol.png" type="image/png"></head>')
        gated = render_html(existing, routes["/conta/"], "https://ordax.com.br")
        self.assertEqual(gated.count('rel="icon"'), 1)

    def test_seo_gated_route_cannot_become_indexable(self):
        routes = {record["path"]: record for record in load_routes()}
        html = '<html><head><title>Site</title><meta name="description" content="Portal"></head><body></body></html>'
        public = render_html(html, routes["/"], "https://ordax.com.br")
        self.assertIn('<link rel="canonical" href="https://ordax.com.br/">', public)
        self.assertIn('property="og:url"', public)
        gated = render_html(html, routes["/login/"], "https://ordax.com.br")
        self.assertIn('content="noindex, nofollow"', gated)
        self.assertNotIn('rel="canonical"', gated)

    def test_landing_uses_one_fixture_and_one_main_landmark(self):
        landing = (ROOT / "public/index.html").read_text("utf-8")
        controller = (ROOT / "public/assets/playground.js").read_text("utf-8")
        self.assertNotIn('id="playground-fixture"', landing)
        self.assertIn('window.OrdaXPublicJsonTransport.loadStatic(', controller)
        self.assertIn('"/assets/playground-fixture.json", 512000', controller)
        runtime = (ROOT / "public/assets/site.js").read_text("utf-8")
        self.assertIn('window.OrdaXPublicJsonTransport = Object.freeze', runtime)
        self.assertNotIn('response.text()', controller)
        self.assertNotIn('const response = await fetch(', controller)
        self.assertIn("for (const nestedMain of screen.querySelectorAll('main'))", controller)

    def test_readonly_preview_is_same_commit_os_output_without_source_copy(self):
        self.assertEqual(DEV_LOCK["surface_preview"], "source-bound")
        self.assertFalse((ROOT / "artifacts/surface-preview/os-migration-70b0f7eb").exists())
        self.assertFalse((ROOT / "public/assets/playground-fixture.json").exists())
        self.assertFalse((ROOT / "public/assets/surface-snapshot.css").exists())
        self.assertFalse((ROOT / "public/assets/surface-snapshot.json").exists())
        source = (ROOT / "scripts/build.py").read_text(encoding="utf-8")
        self.assertIn("build_canonical_preview", source)
        self.assertNotIn("download_surface_release", source)
        self.assertFalse((ROOT / "scripts/surface_release.py").exists())
        self.assertFalse((ROOT / "scripts/brand_release.py").exists())

    def test_retired_os_surface_preview_cannot_reenter_signed_dev_bundle(self):
        """Even a correctly hashed OS-era manifest must not be accepted."""
        source = (ROOT / "scripts/build.py").read_text(encoding="utf-8")
        self.assertNotIn("ordax-public-surface-preview", source)
        self.assertNotIn("audited-migration-snapshot-not-official-surface-publication", source)
        smoke_source = (ROOT / "scripts/smoke_static.py").read_text(encoding="utf-8")
        self.assertNotIn("audited-migration-snapshot-not-official-surface-publication", smoke_source)
        with tempfile.TemporaryDirectory() as tmp:
            source_dir = Path(tmp) / "retired-os-preview"
            source_dir.mkdir()
            old_manifest = {
                "$schema": "prototype-ordax.public-surface-preview/1",
                "artifact_class": "ordax-public-surface-preview",
                "source_repository": "ordaxsystems/ordax-os",
                "source_commit": "1" * 40,
                "status": "audited-migration-snapshot-not-official-surface-publication",
                "immutable": True,
            }
            encoded = (json.dumps(old_manifest, sort_keys=True) + "\n").encode("utf-8")
            (source_dir / "manifest.json").write_bytes(encoded)
            digest = build.digest(encoded)
            out = Path(tmp) / "site-output"
            with self.assertRaisesRegex(build.SiteError, "retired OS Surface migration preview"):
                build.stage_surface_preview(out, source_dir, digest)
            self.assertFalse(out.exists())

    def test_verified_surface_images_reuse_site_bytes_without_duplicate_aliases(self):
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp)
            assets = stage / "assets"
            assets.mkdir()
            day, night = b"same-signed-image-day", b"same-signed-image-night"
            (assets / "public-surface-day.jpg").write_bytes(day)
            (assets / "public-surface-night.jpg").write_bytes(night)
            original_fixture = (b'{"html":"<img src=\\"/assets/alpine-day-Hash.jpg\\">",'
                                b'"alt":"/assets/alpine-night-Hash.jpg"}')
            payloads = {
                "assets/alpine-day-Hash.jpg": day,
                "assets/alpine-night-Hash.jpg": night,
                "assets/surface-snapshot.css": b"body{background:url(./alpine-night-Hash.jpg)}",
                "assets/playground-fixture.json": original_fixture,
            }
            self.assertEqual(build.coalesce_verified_site_images(stage, payloads), 2)
            self.assertNotIn("assets/alpine-day-Hash.jpg", payloads)
            self.assertNotIn("assets/alpine-night-Hash.jpg", payloads)
            self.assertIn(b"/assets/public-surface-day.jpg",
                          payloads["assets/playground-fixture.json"])
            self.assertIn(b"/assets/public-surface-night.jpg",
                          payloads["assets/playground-fixture.json"])
            self.assertIn(b"./public-surface-night.jpg",
                          payloads["assets/surface-snapshot.css"])
            self.assertEqual((assets / "public-surface-day.jpg").read_bytes(), day)
            self.assertEqual((assets / "public-surface-night.jpg").read_bytes(), night)
            # Same name / similar size alone cannot authorize deduplication.
            different = {"assets/alpine-day-Hash.jpg": b"changed-image"}
            self.assertEqual(build.coalesce_verified_site_images(stage, different), 0)
            self.assertIn("assets/alpine-day-Hash.jpg", different)
            # Do not remove a file when any source reference could become orphaned.
            unsafe = {"assets/alpine-day-Hash.jpg": day,
                      "assets/playground-fixture.json": b"url(alpine-day-Hash.jpg)"}
            with self.assertRaisesRegex(build.SiteError, "unmapped Surface image"):
                build.coalesce_verified_site_images(stage, unsafe)

    def test_bundle_verify_rejects_duplicate_binary_digest_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "assets").mkdir()
            (out / "config").mkdir()
            (out / "releases").mkdir()
            (out / "assets/one.jpg").write_bytes(b"duplicate-bytes")
            (out / "assets/two.jpg").write_bytes(b"duplicate-bytes")
            (out / "config/public-site.json").write_text("{}", encoding="utf-8")
            (out / "releases/catalog.json").write_text("{}", encoding="utf-8")
            manifest = {
                "$schema": build.SCHEMA, "source_commit": "1" * 40,
                "artifact_class": "public-site",
                "files": [
                    {"path": path.relative_to(out).as_posix(),
                     "sha256": build.digest(path.read_bytes()),
                     "size": path.stat().st_size}
                    for path in sorted(out.rglob("*")) if path.is_file()
                ],
            }
            (out / "public-site-manifest.json").write_text(
                json.dumps(manifest), encoding="utf-8"
            )
            with self.assertRaisesRegex(build.SiteError,
                                        "duplicate distributed binary assets"):
                build.verify(out)

    def test_delivered_css_dependencies_must_be_local_and_exist(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle = Path(tmp)
            css_dir = bundle / "assets"
            css_dir.mkdir()
            (css_dir / "font.woff2").write_bytes(b"local-font")
            sheet = css_dir / "site.css"
            sheet.write_text('a{background:url("./font.woff2")} b{background:url(data:image/svg+xml,%3csvg%3e)}')
            self.assertEqual(check_css_dependencies(bundle), 1)
            for malicious in (
                "https://tracker.example/remote.png",
                "//tracker.example/remote.png",
                "../missing.png",
                "/assets/never-published.woff2",
                "/assets/../private.png",
            ):
                with self.subTest(malicious=malicious):
                    sheet.write_text('a{background:url("' + malicious + '")}')
                    with self.assertRaises(AssertionError):
                        check_css_dependencies(bundle)
            sheet.write_text('@import url("https://tracker.example/x.css");')
            with self.assertRaisesRegex(AssertionError, "import"):
                check_css_dependencies(bundle)

    def test_account_fallback_heading_is_not_a_second_runtime_heading(self):
        markup = (ROOT / "public/conta/index.html").read_text(encoding="utf-8")
        self.assertEqual(markup.count("<h1"), 1)
        self.assertIn('<h1 class="sr-only">Minha Conta OrdaX</h1>', markup)
        runtime = (ROOT / "public/assets/account-portal.js").read_text(encoding="utf-8")
        self.assertIn('document.getElementById("account-session").innerHTML', runtime)
        self.assertIn('document.getElementById("account-content").innerHTML', runtime)

    def test_one_vercel_config_for_canonical_site_and_gateway(self):
        self.assertFalse((ROOT / "vercel.json").exists())
        config = json.loads((ROOT.parent / "vercel.json").read_text(encoding="utf-8"))
        self.assertIsNone(config["framework"])
        self.assertEqual(config["outputDirectory"], "out/vercel")
        self.assertEqual(config["buildCommand"], "python3 tools/vercel/build.py")
        self.assertEqual(config["ignoreCommand"], "sh tools/vercel/should_skip_build.sh")
        self.assertEqual(config["git"]["deploymentEnabled"], {"**": False, "main": True})
        self.assertTrue(any(
            item["source"] == "/oauth/consent"
            and item["destination"] == "/api/oauth-consent"
            for item in config["rewrites"]
        ))
        for prefix in ("auth", "sync", "account"):
            self.assertTrue(any(
                item["source"] == f"/{prefix}/:path*"
                and not item.get("has")
                and item["destination"] == f"/api/account-proxy?ordax_path=/{prefix}/:path*"
                for item in config["rewrites"]
            ))
            self.assertTrue(any(
                item["source"] == f"/{prefix}/:path*"
                and any(h["key"] == "Cache-Control" and "no-store" in h["value"]
                        for h in item["headers"])
                for item in config["headers"]
            ))
        self.assertTrue(any(
            item["source"] == "/(.*)"
            and any(h["key"] == "Content-Security-Policy" for h in item["headers"])
            for item in config["headers"]
        ))
        self.assertNotIn("stage_canonical_gateway", config["installCommand"])
        adapter = (ROOT / "api/account-proxy.mjs").read_text(encoding="utf-8")
        oauth = (ROOT / "api/oauth-consent.mjs").read_text(encoding="utf-8")
        self.assertIn('../../api/account-proxy.mjs', adapter)
        self.assertIn('../../api/oauth-consent.mjs', oauth)
        self.assertNotIn("jwtVerify", adapter)
        self.assertNotIn("createClient", adapter)
        self.assertNotIn("approveAuthorization", oauth)
        self.assertNotIn("createClient", oauth)
        self.assertEqual(
            json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["dependencies"],
            {"@vercel/oidc": "4.0.0"},
        )
        self.assertFalse((ROOT / ".env.production").exists())
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((ROOT.parent / "package-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(package["engines"], {"node": "24.x"})
        self.assertEqual(lock["packages"]["site"]["engines"], package["engines"])
        self.assertFalse((ROOT / "package-lock.json").exists())
        workflow = (ROOT.parent / ".github/workflows/public-site-candidate.yml").read_text(encoding="utf-8")
        self.assertIn("branches: [main]", workflow)
        self.assertIn("site/**", workflow)
        self.assertIn("python3 tools/vercel/build.py", workflow)
        self.assertNotIn("tests.test_external_site_source", workflow)

    def test_one_canonical_vercel_ignore_gate(self):
        config = json.loads((ROOT.parent / "vercel.json").read_text(encoding="utf-8"))
        self.assertEqual(config["ignoreCommand"], "sh tools/vercel/should_skip_build.sh")
        wrapper = (ROOT.parent / "tools/vercel/should_skip_build.sh").read_text(encoding="utf-8")
        self.assertIn("site/scripts/build_impact.py --vercel", wrapper)
        self.assertIn("VERCEL_GIT_PREVIOUS_SHA", wrapper)
        self.assertNotIn("HEAD^", wrapper)

    def test_ci_candidate_uses_current_os_revision(self):
        workflow = (ROOT.parent / ".github/workflows/public-site-candidate.yml").read_text(encoding="utf-8")
        self.assertIn("branches: [main]", workflow)
        self.assertIn("site/**", workflow)
        self.assertIn("VERCEL_GIT_COMMIT_SHA: " + chr(36) + "{{ github.sha }}", workflow)
        self.assertIn("python3 tools/vercel/build.py", workflow)
        self.assertNotIn("ordax-site.git", workflow)

    def test_site_is_not_native_web_surface(self):
        paths = (ROOT / "public").rglob("*")
        self.assertFalse(any("node_modules" in x.parts or ".env.production" in x.parts for x in paths))
        self.assertFalse((ROOT / "public/system").exists())
        self.assertFalse((ROOT / "public/tools/surface-web").exists())

if __name__ == "__main__":
    unittest.main()
