"""Regression for Creator single paint ownership and flicker-free redraw."""
from pathlib import Path
import os
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
# The external pinned source is authoritative during Creator UX CI.
# The offline OS Foundation still checks the tracked old copy until C6 deletion
# replaces the remaining source/physical-authorization consumers.
APP = (Path(os.environ["ORDAX_CREATOR_NATIVE_SOURCE"]) / "cmd/ordax-creator-app"
       if os.environ.get("ORDAX_CREATOR_NATIVE_SOURCE")
       else ROOT / "tools/creator/cmd/ordax-creator-app")


class CreatorSinglePaintTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = (APP / "main_windows.go").read_text(encoding="utf-8")
        cls.guided = (APP / "guided_visual_windows.go").read_text(encoding="utf-8")
        cls.controls = (APP / "creator_controls_windows.go").read_text(encoding="utf-8")
        cls.physical = (APP / "physical_flow_windows.go").read_text(encoding="utf-8")
        cls.update = (APP / "update_check_windows.go").read_text(encoding="utf-8")
        cls.progress = (APP / "physical_progress_windows.go").read_text(encoding="utf-8")

    def test_native_windows_only_for_interaction(self):
        native_controls = re.findall(r'createControl\("([^"]+)"', self.main)
        self.assertEqual(native_controls.count("COMBOBOX"), 2)
        self.assertEqual(native_controls.count("BUTTON"), 4)
        self.assertEqual(len(native_controls), 6)
        self.assertNotIn("STATIC", native_controls)
        self.assertNotIn("msctls_progress32", native_controls)

    def test_display_copy_is_drawn_once_by_parent(self):
        for key in ("creatorStatusText", "creatorHintText", "creatorVersionText"):
            self.assertIn(key, self.guided)
        for forbidden in ("setText(statusLabel", "setText(hintLabel", "setText(versionLabel"):
            self.assertNotIn(forbidden, self.main+self.physical+self.update)
        self.assertIn("drawTextWithFont(hdc, creatorT(msgHeaderTitle)", self.guided)
        self.assertIn("drawCreatorRail(hdc, sidebar, view)", self.guided)
        self.assertEqual(self.guided.count("drawCreatorRail(hdc, sidebar, view)"), 1)

    def test_full_surface_invalidated_without_background_erase(self):
        self.assertIn("procInvalidateRect.Call(mainWindow, 0, 0)", self.guided)
        self.assertNotIn("procInvalidateRect.Call(mainWindow, 0, 1)", self.guided)
        self.assertIn("procCreateCompatibleDC.Call(screen)", self.guided)
        self.assertIn("procCreateCompatibleBitmap.Call(screen", self.guided)
        self.assertIn("procBitBlt.Call(screen", self.guided)
        self.assertIn("procSelectObject.Call(memory, oldBitmap)", self.guided)
        self.assertIn("procDeleteDC.Call(memory)", self.guided)

    def test_combo_items_use_dark_styled_owner_draw_and_measure(self):
        self.assertEqual(self.main.count("cbsOwnerDrawFixed|cbsHasStrings"), 2)
        self.assertIn("case wmMeasureItem:", self.main)
        self.assertIn("drawCreatorNativeItem(lParam)", self.main)
        self.assertIn("drawCreatorComboItem", self.controls)
        self.assertIn('creatorColorFor("text", colorWindowText)', self.controls)
        self.assertIn("item.ItemHeight = 29", self.controls)

    def test_progress_is_rendered_by_parent_not_win32_marquee(self):
        self.assertIn("creatorProgressValue = percent", self.progress)
        self.assertIn("creatorProgressBusy = false", self.progress)
        self.assertNotIn("send(progressBar,", self.main+self.progress)
        self.assertIn("if creatorProgressBusy {", self.guided)
        self.assertIn("creatorProgressValue", self.guided)
        self.assertIn("progressEnd = progressStart +", self.guided)

    def test_usbs_stay_gated_by_existing_device_selection(self):
        self.assertIn("enable(writeButton, !busy && view.Step == creatorStepReview && view.CanContinue)", self.main)
        self.assertIn("beginPhysicalWrite()", self.main)
        self.assertIn("if writeInProgress()", self.main)


if __name__ == "__main__":
    unittest.main()
