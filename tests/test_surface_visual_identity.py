from pathlib import Path
import re
import hashlib
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system" / "surface" / "ui"
WEB_INDEX = ROOT / "system" / "composition" / "web" / "index.html"
NATIVE_INDEX = ROOT / "system" / "composition" / "native" / "index.html"
APPEARANCE = ROOT / "system" / "services" / "preferences" / "appearance.mjs"
DESKTOP_IDENTITY = ROOT / "docs" / "DESKTOP-IDENTITY.md"
BROWSER_SMOKE = ROOT / "tools" / "surface-web" / "browser-smoke.mjs"
PROJECTS_CSS = ROOT / "system" / "apps" / "projects" / "projects.css"
INTERNET_CSS = ROOT / "system" / "apps" / "internet" / "internet.css"
SETTINGS_CSS = SURFACE / "settings.css"
ACCOUNT_CSS = SURFACE / "account.css"
SYSTEM_CSS = SURFACE / "system.css"
LOCK_CSS = SURFACE / "local-session-lock.css"
INTER_FONT = SURFACE / "fonts" / "inter-latin-wght-normal.woff2"
INTER_SOURCE = ROOT / "third_party" / "fonts" / "Inter-Latin-Variable-SOURCE.md"
INTER_LICENSE = ROOT / "third_party" / "licenses" / "Inter-OFL-1.1.txt"


class SurfaceVisualIdentityTests(unittest.TestCase):
    def test_midnight_ice_tokens_are_canonical(self):
        tokens = (SURFACE / "tokens.css").read_text(encoding="utf-8")
        self.assertNotIn("#ed4b25", tokens)
        for declaration in (
            "--ordax-bg: #0a0f1f",
            "--ordax-app-bg: #111827",
            "--ordax-panel: #161f33",
            "--ordax-text: #e3f0ff",
            "--ordax-accent: #8dbbff",
            "--ordax-bg: #edf3fc",
            "--ordax-app-bg: #f8fbff",
            "--ordax-panel: #ffffff",
            "--ordax-text: #14213b",
            "--ordax-accent: #235ac0",
            "--ordax-font: Inter, system-ui, \"Segoe UI\", sans-serif",
            "--ordax-font-display: Inter, system-ui, \"Segoe UI\", sans-serif",
            "--ordax-motion-fast: 150ms",
            "--ordax-motion-base: 200ms",
            "--ordax-motion-slow: 250ms",
        ):
            self.assertIn(declaration, tokens)

    def test_identity_preserves_theme_default_and_public_values(self):
        appearance = APPEARANCE.read_text(encoding="utf-8")
        self.assertIn('defaultValue: "light"', appearance)
        self.assertIn('{ value: "light", label: "Claro" }', appearance)
        self.assertIn('{ value: "dark", label: "Escuro" }', appearance)

    def test_semantic_states_and_light_theme_remain_independent(self):
        tokens = (SURFACE / "tokens.css").read_text(encoding="utf-8")
        self.assertIn('[data-ordax-theme="light"]', tokens)
        self.assertIn("--ordax-success:", tokens)
        self.assertIn("--ordax-warning:", tokens)
        self.assertIn("--ordax-danger:", tokens)
        self.assertIn('[data-ordax-theme="dark"][data-ordax-contrast="high"]', tokens)
        self.assertIn("prefers-reduced-motion", tokens)

    def test_shared_identity_layers_are_loaded_by_web_and_native(self):
        identity = SURFACE / "identity.css"
        self.assertTrue(identity.is_file())
        self.assertFalse((SURFACE / "app-identity.css").exists())

        css = identity.read_text(encoding="utf-8")
        self.assertIn("var(--ordax-accent)", css)
        self.assertIn("var(--ordax-panel)", css)
        self.assertIn(".ordax-window", css)
        self.assertIn(".ordax-rail", css)
        self.assertIn(".ordax-launcher-panel", css)
        self.assertIn("prefers-reduced-motion", css)

        for index in (WEB_INDEX, NATIVE_INDEX):
            html = index.read_text(encoding="utf-8")
            self.assertIn('../../surface/ui/identity.css', html)
            self.assertNotIn('../../surface/ui/app-identity.css', html)
            self.assertIn('name="theme-color" content="#edf3fc"', html)

    def test_refreshed_shell_keeps_launcher_dock_and_panels_anchored(self):
        css = (SURFACE / "identity.css").read_text(encoding="utf-8")
        for declaration in (
            ".ordax-launcher {",
            "top: auto;",
            "transform: translateX(-50%);",
            ".ordax-launcher-app .ordax-app-mark {",
            ".ordax-statusbar {",
            ".ordax-running-app[data-active=\"true\"] {",
            ".ordax-quick-panel-layer {",
            ".ordax-quick-panel-header {",
        ):
            self.assertIn(declaration, css)

    def test_local_session_lock_uses_product_tokens_without_legacy_warm_fallback(self):
        css = LOCK_CSS.read_text(encoding="utf-8")
        for legacy in ("#efede6", "#f8f6ef"):
            self.assertNotIn(legacy, css)
        for declaration in (
            "var(--ordax-bg-start)",
            "var(--ordax-panel)",
            "var(--ordax-button-bg)",
            "var(--ordax-button-text)",
            "var(--ordax-focus)",
            "prefers-reduced-motion",
        ):
            self.assertIn(declaration, css)

    def test_account_and_system_views_follow_shared_surface_materials(self):
        account = ACCOUNT_CSS.read_text(encoding="utf-8")
        system = SYSTEM_CSS.read_text(encoding="utf-8")
        for css in (account, system):
            for declaration in (
                "var(--ordax-panel)",
                "var(--ordax-accent)",
                "var(--ordax-border-soft)",
                "var(--ordax-focus)",
                "var(--ordax-motion-fast)",
                "prefers-reduced-motion",
            ):
                self.assertIn(declaration, css)
        self.assertIn("var(--ordax-button-bg)", account)
        self.assertIn("var(--ordax-button-text)", account)
        self.assertIn(".ordax-account-navigation-item[data-active=\"true\"]", account)
        self.assertIn(".ordax-system-navigation-item[data-active=\"true\"]", system)
        self.assertIn("box-shadow: 0 0 10px", system)

    def test_projects_consumes_semantic_tokens_in_component_css(self):
        css = PROJECTS_CSS.read_text(encoding="utf-8")
        for declaration in (
            "color: var(--ordax-text)",
            "color: var(--ordax-muted)",
            "border: 1px solid var(--ordax-border-soft)",
            "border-radius: var(--ordax-radius-lg)",
            "background: color-mix(in srgb, var(--ordax-panel) 66%, transparent)",
            "box-shadow: var(--ordax-shadow-soft)",
            "border: 1px solid var(--ordax-border)",
            "outline: 2px solid var(--ordax-focus)",
            "var(--ordax-accent)",
            "prefers-reduced-motion",
        ):
            self.assertIn(declaration, css)


    def test_internet_consumes_semantic_tokens_in_component_css(self):
        css = INTERNET_CSS.read_text(encoding="utf-8")
        for legacy in ("#ed4b25", "#9d2f18", "#5f5b54", "#efede6", "#171613"):
            self.assertNotIn(legacy, css)
        self.assertNotIn("border-color: var(--ordax-danger)", css)
        self.assertGreaterEqual(css.count("border-color: var(--ordax-focus)"), 2)
        for declaration in (
            "background: var(--ordax-app-bg)",
            "color: var(--ordax-text)",
            "var(--ordax-accent)",
            "var(--ordax-muted)",
            "var(--ordax-focus)",
            "background: var(--ordax-button-bg)",
            "color: var(--ordax-button-text)",
            "var(--ordax-danger)",
        ):
            self.assertIn(declaration, css)

    def test_settings_previews_match_canonical_light_and_dark_palettes(self):
        css = SETTINGS_CSS.read_text(encoding="utf-8")
        previews = css[css.index('.ordax-settings-theme-preview {'):]
        self.assertNotRegex(previews, r'#[a-fA-F0-9]{3,8}\b')
        for token in ('app-bg', 'rail-bg', 'accent', 'text', 'muted'):
            self.assertIn(f'var(--ordax-{token})', previews)
        tokens = (SURFACE / 'tokens.css').read_text(encoding='utf-8')
        for theme in ('light', 'dark'):
            self.assertIn(f'[data-theme-preview="{theme}"]', tokens)

    def test_accessible_palette_contrast_in_both_materials(self):
        css = (SURFACE / 'tokens.css').read_text(encoding='utf-8')
        blocks = list(re.finditer(r'([^{}]+)\{([^{}]+)\}', css))

        def palette(selector):
            block = next(m[2] for m in blocks if selector in m[1])
            return dict(re.findall(r'--ordax-([\w-]+):\s*(#[a-fA-F0-9]{6})\s*;', block))

        def luminance(hex_color):
            rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
            linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb]
            return sum(c * w for c, w in zip(linear, (.2126, .7152, .0722)))

        def contrast(first, second):
            low, high = sorted((luminance(first), luminance(second)))
            return (high + .05) / (low + .05)

        for theme in ('dark', 'light'):
            standard = palette(f'[data-theme-preview="{theme}"]')
            for high_contrast in (False, True):
                colors = {**standard}
                if high_contrast:
                    colors.update(palette(f'[data-ordax-theme="{theme}"][data-ordax-contrast="high"]'))
                for background in ('bg', 'app-bg', 'panel', 'surface', 'rail-bg'):
                    for foreground in ('text', 'muted', 'faint'):
                        with self.subTest(theme=theme, high=high_contrast, bg=background, fg=foreground):
                            self.assertGreaterEqual(contrast(colors[foreground], colors[background]),
                                                    7 if high_contrast else 4.5)
                    self.assertGreaterEqual(contrast(colors['focus'], colors[background]), 3)
                    for state in ('success', 'warning', 'danger', 'accent'):
                        self.assertGreaterEqual(contrast(colors[state], colors[background]), 4.5)
                self.assertGreaterEqual(contrast(colors['button-text'], colors['button-bg']), 4.5)

    def test_approved_symbol_is_pinned_and_shared_without_a_duplicate_asset(self):
        symbol = SURFACE / 'brand' / 'ordax-symbol.png'
        data = symbol.read_bytes()
        self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(hashlib.sha256(data).hexdigest(),
                         '4720934dbb15c8e615e585c8e96f7498f8558a90467b63e150d45af7a5005fb9')
        self.assertEqual(int.from_bytes(data[16:20], 'big'), 1254)
        self.assertEqual(int.from_bytes(data[20:24], 'big'), 1254)
        self.assertEqual(data[25], 6)  # RGBA preserves the supplied transparent background.
        self.assertFalse((SURFACE / 'brand' / 'ordax-symbol.svg').exists())
        for stylesheet in ('identity.css', 'boot-screen.css'):
            css = (SURFACE / stylesheet).read_text(encoding='utf-8')
            self.assertIn('background: url("./brand/ordax-symbol.png")', css)
            self.assertIn('@media (forced-colors: active)', css)
            self.assertIn('[data-ordax-contrast="high"]', css)
        provenance = (SURFACE / 'brand' / 'ARTWORK-SOURCE.md').read_text(encoding='utf-8')
        self.assertIn(hashlib.sha256(data).hexdigest(), provenance)

    def test_original_wallpaper_is_pinned_and_shared_without_copying_reference_board(self):
        wallpaper = (SURFACE / 'brand' / 'midnight-landscape.png').read_bytes()
        self.assertEqual(wallpaper[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(hashlib.sha256(wallpaper).hexdigest(),
                         '805969ce2fb30001842a545c2dead4516285bcc4973a8673f66aa3599d2601ce')
        css = (SURFACE / 'identity.css').read_text(encoding='utf-8')
        self.assertIn('url("./brand/midnight-landscape.png")', css)
        self.assertNotRegex(css, r'#[a-fA-F0-9]{3,8}\b')
        provenance = (SURFACE / 'brand' / 'ARTWORK-SOURCE.md').read_text(encoding='utf-8')
        self.assertIn(hashlib.sha256(wallpaper).hexdigest(), provenance)
        self.assertIn('No text, logo, interface', provenance)

    def test_browser_smoke_exercises_shared_identity_layers(self):
        smoke = BROWSER_SMOKE.read_text(encoding="utf-8")
        self.assertIn("'system/surface/ui/identity.css'", smoke)
        self.assertNotIn("'system/surface/ui/app-identity.css'", smoke)
        self.assertIn("'system/apps/internet/internet.css'", smoke)

    def test_inter_font_is_local_offline_and_source_bound(self):
        tokens = (SURFACE / "tokens.css").read_text(encoding="utf-8")
        self.assertIn('@font-face', tokens)
        self.assertIn('url("./fonts/inter-latin-wght-normal.woff2")', tokens)
        self.assertTrue(INTER_FONT.is_file())
        self.assertEqual(INTER_FONT.stat().st_size, 48256)
        source = INTER_SOURCE.read_text(encoding="utf-8")
        self.assertIn("d946f2f5f48bb73bb238d189d3b182c98dcbca10", source)
        self.assertIn("d15208de03cd1ad7c5199f0a0ce915fe841e4722", source)
        self.assertIn("3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62", source)

    def test_inter_license_is_tracked_with_third_party_licenses(self):
        license_text = INTER_LICENSE.read_text(encoding="utf-8")
        self.assertIn("The Inter Project Authors", license_text)
        self.assertIn("SIL OPEN FONT LICENSE Version 1.1", license_text)

    def test_landing_is_reference_not_product_capability(self):
        docs = DESKTOP_IDENTITY.read_text(encoding="utf-8")
        self.assertIn("aesthetic reference only", docs)
        self.assertIn("must not be imported into `system/`", docs)
        self.assertIn("single source of visual policy", docs)


if __name__ == "__main__":
    unittest.main()
