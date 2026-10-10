from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system" / "surface" / "ui" / "file-space-controls.mjs"
CSS = ROOT / "system" / "surface" / "ui" / "files.css"


class FilesNavigationHistoryTests(unittest.TestCase):
    def test_navigation_history_is_bounded_and_window_local(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("MAX_NAVIGATION_HISTORY = 64", controls)
        self.assertIn("navigationHistory = []", controls)
        self.assertIn("navigationIndex = -1", controls)
        self.assertIn("recordNavigation", controls)
        self.assertIn("slice(-MAX_NAVIGATION_HISTORY)", controls)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("sessionStorage", controls)

    def test_back_forward_and_up_have_real_navigation_paths(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("back.dataset.fileHistoryBack", controls)
        self.assertIn("forward.dataset.fileHistoryForward", controls)
        self.assertIn("up.dataset.fileHistoryUp", controls)
        self.assertIn("navigateHistory(navigationIndex - 1)", controls)
        self.assertIn("navigateHistory(navigationIndex + 1)", controls)
        self.assertIn("load(parentPath(listing.path))", controls)
        self.assertIn('load(listing.path, { recordHistory: false })', controls)

    def test_failed_navigation_preserves_current_context(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        load_block = controls.split("const load = async", 1)[1].split("const navigateHistory", 1)[0]
        self.assertIn("const changedPath = Boolean(listing && listing.path !== next.path)", load_block)
        self.assertIn("if (changedPath)", load_block)
        self.assertIn('setMessage("files.location.openFailed")', load_block)
        self.assertLess(load_block.index("const next = validateListingForRequest"), load_block.index("searchQuery = \"\""))

    def test_failed_navigation_preserves_recents_and_trash_modes(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        block = controls.split("const load = async", 1)[1].split("const navigateHistory", 1)[0]
        verified = block.index("const next = validateListingForRequest")
        mode_switch = block.index("recentMode = false;")
        self.assertLess(verified, mode_switch)
        self.assertLess(mode_switch, block.index('lifecycle.setAppTarget("files", next.path)'))
        self.assertLess(mode_switch, block.index("listing = next"))
        self.assertIn("if (destroyed || ordinal !== requestOrdinal) return false;", block)

    def test_superseded_history_cannot_revert_newer_navigation(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        history = controls.split("const navigateHistory = async", 1)[1].split("const openTextFile", 1)[0]
        self.assertIn("const request = requestOrdinal + 1;", history)
        self.assertIn("if (destroyed || request !== requestOrdinal) return;", history)
        self.assertLess(
            history.index("if (destroyed || request !== requestOrdinal) return;"),
            history.index("navigationIndex = targetIndex"),
        )
        self.assertNotIn("navigationIndex = previousIndex", history)

    def test_project_recent_and_fallback_ignore_superseded_navigation(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        project = controls.split("const openProject = async", 1)[1].split("const removeProject", 1)[0]
        reveal = controls.split("const revealRecent = async", 1)[1].split("const paint =", 1)[0]
        fallback = controls.split("const loadWithFallback = async", 1)[1].split("root.addEventListener", 1)[0]
        self.assertIn("if (destroyed || request !== requestOrdinal) return;", project)
        self.assertIn("if (destroyed || request !== requestOrdinal || !loaded) return;", reveal)
        self.assertLess(reveal.index("await load(parentPath(targetPath))"), reveal.index("previewRequestOrdinal += 1;"))
        self.assertIn("if (destroyed || request !== requestOrdinal || loaded) return loaded;", fallback)
        self.assertIn("if (destroyed || fallbackRequest !== requestOrdinal || fallbackLoaded)", fallback)

    def test_navigation_controls_are_accessible_and_responsive(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        css = CSS.read_text(encoding="utf-8")
        self.assertIn('back.setAttribute("aria-label", t("files.nav.back"))', controls)
        self.assertIn('forward.setAttribute("aria-label", t("files.nav.forward"))', controls)
        self.assertIn('up.setAttribute("aria-label", t("files.nav.up"))', controls)
        self.assertIn(".ordax-files-navigation", css)
        self.assertIn(".ordax-files-nav-action", css)


if __name__ == "__main__":
    unittest.main()
