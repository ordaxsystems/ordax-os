from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system" / "surface" / "ui"
WEB_INDEX = ROOT / "system" / "composition" / "web" / "index.html"
NATIVE_INDEX = ROOT / "system" / "composition" / "native" / "index.html"
APPEARANCE = ROOT / "system" / "services" / "preferences" / "appearance.mjs"
DESKTOP_IDENTITY = ROOT / "docs" / "DESKTOP-IDENTITY.md"
BROWSER_SMOKE = ROOT / "tools" / "surface-web" / "browser-smoke.mjs"
PROJECTS_CSS = ROOT / "system" / "apps" / "projects" / "projects.css"
NOTES_CSS = ROOT / "system" / "apps" / "notes" / "notes.css"
INTERNET_CSS = ROOT / "system" / "apps" / "internet" / "internet.css"
SETTINGS_CSS = SURFACE / "settings.css"
ACCOUNT_CSS = SURFACE / "account.css"
SYSTEM_CSS = SURFACE / "system.css"
LOCK_CSS = SURFACE / "local-session-lock.css"
INTER_FONT = SURFACE / "fonts" / "inter-latin-wght-normal.woff2"
INTER_SOURCE = ROOT / "third_party" / "fonts" / "Inter-Latin-Variable-SOURCE.md"
INTER_LICENSE = ROOT / "third_party" / "licenses" / "Inter-OFL-1.1.txt"


class SurfaceVisualIdentityTests(unittest.TestCase):
    def test_graphite_glacial_tokens_are_canonical(self):
        tokens = (SURFACE / "tokens.css").read_text(encoding="utf-8")
        self.assertNotIn("#ed4b25", tokens)
        for declaration in (
            "--ordax-bg: #080f19",
            "--ordax-app-bg: #090f1b",
            "--ordax-panel: #111e30",
            "--ordax-text: #e2ebf7",
            "--ordax-muted: #8e9db4",
            "--ordax-accent: #a9c9f7",
            "--ordax-button-bg: #d1e4ff",
            "--ordax-button-text: #172b47",
            "--ordax-border: #243249",
            "--ordax-font: Inter, system-ui, \"Segoe UI\", sans-serif",
            "--ordax-font-display: Inter, system-ui, \"Segoe UI\", sans-serif",
            "--ordax-motion-fast: 150ms",
            "--ordax-motion-base: 200ms",
            "--ordax-motion-slow: 250ms",
        ):
            self.assertIn(declaration, tokens)

    def test_graphite_is_visual_reference_without_changing_theme_default(self):
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
            self.assertIn('name="theme-color" content="#080f19"', html)

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

    def test_notes_consumes_semantic_tokens_in_component_css(self):
        css = NOTES_CSS.read_text(encoding="utf-8")
        self.assertNotIn("--notes-accent: #ed4b25", css)
        for declaration in (
            "--notes-paper: var(--ordax-panel)",
            "--notes-ivory: var(--ordax-app-bg)",
            "--notes-ink: var(--ordax-text)",
            "--notes-muted: var(--ordax-muted)",
            "--notes-accent: var(--ordax-accent)",
            "--notes-soft: var(--ordax-selected-bg)",
            "background: var(--ordax-button-bg)",
            "color: var(--ordax-button-text)",
            "background: var(--ordax-danger-bg)",
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
        self.assertNotIn("#ed4b25", css)
        for color in (
            "#f7f9fc",
            "#527eb8",
            "#172b47",
            "#8797aa",
            "#090f1b",
            "#a9c9f7",
            "#e2ebf7",
            "#8e9db4",
        ):
            self.assertIn(color, css)

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
