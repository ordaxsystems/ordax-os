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
        import xml.etree.ElementTree as ET
        p = ROOT / "tools/public-site/build.py"
        original_path = list(sys.path)
        try:
            sys.path.insert(0, str(p.parent))
            pspec = importlib.util.spec_from_file_location("ordax_public_logo_builder", p)
            module = importlib.util.module_from_spec(pspec)
            pspec.loader.exec_module(module)
        finally:
            sys.path[:] = original_path
        canonical = ROOT / "system/surface/ui/brand/ordax-symbol.svg"
        self.assertEqual(module.CANONICAL_SYMBOL, canonical)
        self.assertEqual(module.PUBLIC_SYMBOL_PATH, "assets/ordax-symbol.svg")
        svg = ET.fromstring(canonical.read_text(encoding="utf-8"))
        self.assertEqual(svg.tag, "{http://www.w3.org/2000/svg}svg")
        self.assertTrue(any(node.tag.endswith("path") for node in svg))
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
        for route in ("login", "cadastro", "conta"):
            html = (ROOT / f"sites/public/{route}/index.html").read_text(encoding="utf-8")
            self.assertIn('class="brand-mark"', html)
            self.assertNotIn('ordax-symbol.svg', html)
        # Marketing landing and current brand artwork are untouched by this cutover.
        landing = (ROOT / "sites/public/assets/playground.css").read_text(encoding="utf-8")
        self.assertIn('body[data-page="landing"]', landing)

    def test_publishing_requires_confirmed_project_and_never_runs_by_default(self):
        with self.assertRaises(brand.BrandError):
            brand.publish_emails(brand.SUPABASE_REF)
        with self.assertRaises(brand.BrandError):
            brand.publish_emails("unrelated-project", allow_write=True)


if __name__ == "__main__":
    unittest.main()
