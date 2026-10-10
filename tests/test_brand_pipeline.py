from pathlib import Path
import importlib.util
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "tools/brand/build.py"
spec = importlib.util.spec_from_file_location("ordax_brand_pipeline", PATH)
brand = importlib.util.module_from_spec(spec)
spec.loader.exec_module(brand)


class BrandPipelineTests(unittest.TestCase):
    def test_live_surface_tokens_are_only_palette_owner(self):
        dark, light = brand.load_colors()
        self.assertTrue(dark["--ordax-bg"].startswith("#"))
        self.assertNotEqual(dark["--ordax-bg"], light["--ordax-bg"])
        css = brand.render_site_css()
        self.assertIn('--ordax-bg: ' + dark["--ordax-bg"], css)
        self.assertIn('--ordax-bg: ' + light["--ordax-bg"], css)
        self.assertNotIn("url(", css)
        self.assertNotIn("https://", css)

    def test_rendered_email_templates_match_versioned_outputs(self):
        brand.check_emails()
        for name in brand.SUPPORTED_TEMPLATES:
            content = brand.render_email(name)
            self.assertIn("{{ .TokenHash }}", content)
            self.assertNotIn("{{ .ConfirmationURL }}", content)
            self.assertNotIn("{{ .RedirectTo }}", content)
            self.assertNotIn("[[ordax-", content)
            self.assertNotIn("access_token", content)

    def test_symbol_styles_are_derived_once_and_reject_external_assets(self):
        import re
        css = brand.render_site_identity_css()
        self.assertEqual(css, brand.render_site_css() + "\n" + brand.SYMBOL_CSS.read_text(encoding="utf-8"))
        self.assertEqual(set(re.findall(r'url\("([^"]+)"\)', css)), {'./ordax-symbol.png'})
        for name in ("site", "account", "portal", "playground", "download"):
            source = (ROOT / "sites/public/assets" / (name + ".css")).read_text(encoding="utf-8")
            self.assertNotRegex(source, r'\.brand-mark\s+(?:span|i)\s*\{')
        with tempfile.TemporaryDirectory() as tmp:
            changed = Path(tmp) / "symbol.css"
            for url in ('https://example.invalid/logo.png', '../other-symbol.png', 'data:image/png;base64,AAAA'):
                changed.write_text(brand.SYMBOL_CSS.read_text(encoding="utf-8").replace('./ordax-symbol.png', url), encoding="utf-8")
                with self.assertRaises(brand.BrandError):
                    brand.render_site_identity_css(symbol_path=changed)

    def test_token_change_derives_css_and_email_without_editing_templates(self):
        sample = brand.TOKENS.read_text(encoding="utf-8")
        old_dark = brand.load_colors()[0]["--ordax-bg"]
        with tempfile.TemporaryDirectory() as tmp:
            changed = Path(tmp) / "tokens.css"
            changed.write_text(sample.replace("--ordax-bg: " + old_dark, "--ordax-bg: #010203", 1), encoding="utf-8")
            self.assertIn("--ordax-bg: #010203;", brand.render_site_css(changed))
            email = brand.render_email("confirmation", tokens_path=changed)
            self.assertIn("background:#010203", email)
            self.assertNotEqual(email, brand.render_email("confirmation"))

    def test_unknown_and_unsafe_template_placeholders_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / "src").mkdir()
            src = (brand.TEMPLATES / "src/confirmation.html").read_text(encoding="utf-8")
            (path / "src/confirmation.html").write_text(src.replace("[[ordax-bg]]", "[[ordax-does-not-exist]]"), encoding="utf-8")
            with self.assertRaises(brand.BrandError):
                brand.render_email("confirmation", templates_dir=path)
            (path / "src/confirmation.html").write_text(src.replace("{{ .TokenHash }}", "{{ .ConfirmationURL }}"), encoding="utf-8")
            with self.assertRaises(brand.BrandError):
                brand.render_email("confirmation", templates_dir=path)

    def test_public_site_builder_does_not_shadow_other_build_modules(self):
        import sys
        before = sys.modules.get("build")
        path_before = list(sys.path)
        public_path = ROOT / "tools/public-site/build.py"
        public_spec = importlib.util.spec_from_file_location("ordax_public_builder_isolation", public_path)
        public = importlib.util.module_from_spec(public_spec)
        # This builder also imports its neighboring release/fixture helpers;
        # give it the normal script directory for this isolated test only.
        try:
            sys.path.insert(0, str(public_path.parent))
            public_spec.loader.exec_module(public)
        finally:
            sys.path[:] = path_before
        self.assertIs(sys.modules.get("build"), before)
        self.assertEqual(sys.path, path_before)
        self.assertEqual(public.render_site_css(), brand.render_site_css())

    def test_public_logo_is_derived_from_surface_without_a_duplicate_asset(self):
        import sys
        p = ROOT / "tools/public-site/build.py"
        original_path = list(sys.path)
        try:
            sys.path.insert(0, str(p.parent))
            pspec = importlib.util.spec_from_file_location("ordax_public_logo_builder", p)
            module = importlib.util.module_from_spec(pspec)
            pspec.loader.exec_module(module)
        finally:
            sys.path[:] = original_path
        canonical = ROOT / "system/surface/ui/brand/ordax-symbol.png"
        self.assertEqual(module.CANONICAL_SYMBOL, canonical)
        self.assertEqual(module.PUBLIC_SYMBOL_PATH, "assets/ordax-symbol.png")
        self.assertEqual(canonical.read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
        self.assertFalse((ROOT / "sites/public" / module.PUBLIC_SYMBOL_PATH).exists())
        self.assertIn("shutil.copyfile(CANONICAL_SYMBOL, stage / PUBLIC_SYMBOL_PATH)", p.read_text(encoding="utf-8"))

    def test_web_auth_and_portal_consume_surface_ssot_without_logo_replacement(self):
        css = brand.render_site_css()
        for token in ("surface", "border-soft", "selected-bg", "focus",
                      "warning", "danger", "radius-lg", "motion-fast"):
            self.assertIn(f"--ordax-{token}: ", css)
        for filename in ("account.css", "portal.css"):
            stylesheet = (ROOT / "sites/public/assets" / filename).read_text(encoding="utf-8")
            self.assertIn("var(--ordax-bg)", stylesheet)
            self.assertIn("var(--ordax-panel)", stylesheet)
            self.assertIn("var(--ordax-text)", stylesheet)
            self.assertIn("var(--ordax-muted)", stylesheet)
            self.assertIn("var(--ordax-border)", stylesheet)
            self.assertIn("var(--ordax-accent)", stylesheet)
            self.assertNotIn("--account-bg:#", stylesheet)
            self.assertNotIn("--canvas:#080f19", stylesheet)
            self.assertIn(".brand-mark", stylesheet)
        for route in ("login", "cadastro"):
            html = (ROOT / f"sites/public/{route}/index.html").read_text(encoding="utf-8")
            self.assertIn('class="brand-mark"', html)
            self.assertNotIn('ordax-symbol.png', html)
        # Marketing landing and current brand artwork are untouched by this cutover.
        landing = (ROOT / "sites/public/assets/playground.css").read_text(encoding="utf-8")
        self.assertIn('body[data-page="landing"]', landing)

    def test_account_concept_uses_canonical_visual_assets_and_no_second_palette(self):
        import re
        token_css = brand.render_site_identity_css()
        definitions = set(re.findall(r"(--ordax-[a-z-]+):", token_css))
        for asset in ("account-dashboard.css", "web-entry.css"):
            css = (ROOT / "sites/public/assets" / asset).read_text(encoding="utf-8")
            self.assertNotRegex(css, r"#[0-9a-fA-F]{3,8}\b|oklch\(|rgba?\(|hsla?\(")
            self.assertNotRegex(css, r"--ordax-[a-z-]+\s*:")
            references = set(re.findall(r"var\((--ordax-[a-z-]+)", css))
            self.assertFalse(references - definitions, (asset, references - definitions))
            self.assertIn("var(--ordax-font)", css)
        for route in ("conta", "web"):
            markup = (ROOT / f"sites/public/{route}/index.html").read_text(encoding="utf-8")
            self.assertTrue('src="/assets/ordax-symbol.png"' in markup or 'class="ordax-symbol"' in markup)
            self.assertIn('/assets/ordax-font.css', markup)
        font = brand.render_site_font_css()
        canonical = re.search(r"@font-face\s*\{[^{}]+\}", brand.TOKENS.read_text(encoding="utf-8")).group()
        self.assertIn(canonical, font)
        self.assertNotIn("https://", font)

    def test_account_and_portal_materials_follow_surface_semantics(self):
        import re
        account = (ROOT / "sites/public/assets/account.css").read_text(encoding="utf-8")
        portal = (ROOT / "sites/public/assets/portal.css").read_text(encoding="utf-8")
        # Important visible layers must not contain a second literal palette.
        def rule_body(source, selector):
            for match in re.finditer(r"([^{}]+)\{([^{}]*)\}", source):
                candidate = re.sub(r"/\*.*?\*/", "", match.group(1), flags=re.S).strip()
                if candidate == selector:
                    return match.group(2)
            self.fail("missing css rule: " + selector)

        for source, selectors in (
            (account, (
                ":is(.login-stage,.signup-stage)", ":is(.login-card,.signup-card)",
                ".account-ui .identity-state", ".account-ui .identity-submit",
                '.account-ui .identity-state[data-status="ready"]',
                '.account-ui .identity-state[data-status="unavailable"]',
                ".account-ui .registration-legal",
            )),
            (portal, (
                ".auth-shell", ".auth-card", ".identity-state",
                ".identity-field input", ".release-card", ".status-panel",
            )),
        ):
            for selector in selectors:
                body = rule_body(source, selector)
                for declaration in re.findall(r"(?:background|border-color|color):[^;]+;", body):
                    self.assertNotRegex(declaration, r"#[0-9a-fA-F]{3,8}\b", selector)
                    self.assertIn("var(--ordax-", declaration, selector)
        self.assertIn("var(--ordax-success-bg)", account)
        self.assertIn("var(--ordax-warning-bg)", account)
        self.assertIn("var(--ordax-button-bg)", account)
        self.assertIn("var(--ordax-radius-xl)", portal)
        self.assertIn("url('/assets/aurora-titanium.png')", account)
        self.assertIn("url('/assets/aurora-titanium.png')", portal)
        # The existing mark and marketing site have not been altered.
        for source in (account, portal):
            self.assertIn(".brand-mark", source)
        self.assertIn('body[data-page="landing"]',
                      (ROOT / "sites/public/assets/playground.css").read_text(encoding="utf-8"))

    def test_download_materials_share_surface_ssot_without_logo_swap(self):
        import re
        css = (ROOT / "sites/public/assets/download.css").read_text(encoding="utf-8")
        for name in ("bg", "panel", "text", "muted", "accent", "focus",
                     "warning", "warning-bg", "button-bg", "button-text"):
            self.assertIn(f"var(--ordax-{name})", css)
        self.assertEqual(css.count("url('/assets/download-hero.png')"), 2)
        self.assertIn('[data-page="download"] .brand-mark', css)
        html = (ROOT / "sites/public/download/index.html").read_text(encoding="utf-8")
        self.assertIn('data-download-status', html)
        self.assertIn('class="brand-mark"', html)
        self.assertNotIn('ordax-symbol.png', html)
        for selector in ('body[data-page="download"]', '.download-hero-art',
                         '.creator-card,.release-explainer', '.catalog-status',
                         '.journey-steps li', '.erase-notice', '.integrity-panel',
                         '[data-page="download"] .button-primary'):
            rules = [m.group(2) for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css)
                     if re.sub(r"/\*.*?\*/", "", m.group(1), flags=re.S).strip() == selector]
            self.assertTrue(rules, selector)
            for decl in re.findall(r"(?:background|border-color|color):[^;]+;", rules[0]):
                self.assertNotRegex(decl, r"#[0-9a-fA-F]{3,8}\b", selector)
                self.assertIn('var(--ordax-', decl, selector)

    def test_publishing_requires_confirmed_project_and_never_runs_by_default(self):
        with self.assertRaises(brand.BrandError):
            brand.publish_emails(brand.SUPABASE_REF)
        with self.assertRaises(brand.BrandError):
            brand.publish_emails("unrelated-project", allow_write=True)


if __name__ == "__main__":
    unittest.main()
