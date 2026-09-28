import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSS = ROOT / "system" / "surface" / "ui" / "first-run.css"
FIRST_RUN = ROOT / "system" / "surface" / "ui" / "first-run.mjs"


class FirstRunPhysicalLayoutTests(unittest.TestCase):
    def test_shell_is_bounded_to_the_physical_viewport(self):
        css = CSS.read_text(encoding="utf-8")
        self.assertIn("height: min(720px, calc(100dvh - 36px));", css)
        self.assertIn("max-height: calc(100dvh - 36px);", css)
        self.assertIn(".ordax-first-run-card {\n  min-width: 0;\n  min-height: 0;", css)
        self.assertIn(".ordax-first-run-body {\n  width: min(720px, 100%);\n  min-height: 0;", css)
        self.assertIn("overflow: auto;\n  overscroll-behavior: contain;", css)

    def test_footer_remains_a_non_scrolling_control_region(self):
        css = CSS.read_text(encoding="utf-8")
        footer = css.split(".ordax-first-run-footer {", 1)[1].split("}", 1)[0]
        self.assertIn("flex: 0 0 auto;", footer)
        self.assertIn("background: var(--ordax-surface);", footer)

    def test_mobile_progress_matches_all_first_run_steps(self):
        css = CSS.read_text(encoding="utf-8")
        first_run = FIRST_RUN.read_text(encoding="utf-8")
        self.assertIn('const STEPS = Object.freeze(["welcome", "regional", "network", "security", "account", "privacy", "ready"]);', first_run)
        self.assertIn("grid-template-columns: repeat(7, 1fr);", css)
        self.assertIn("height: 100dvh;", css)


if __name__ == "__main__":
    unittest.main()
