from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
OWNER = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"


class SystemDiagnosticOwnerMountTests(unittest.TestCase):
    def source(self):
        return OWNER.read_text(encoding="utf-8")

    def test_system_owner_mounts_review_view_only_through_shared_child_module(self):
        source = self.source()
        self.assertIn('from "./system-diagnostics-review.mjs"', source)
        self.assertIn("mountSystemDiagnosticsReview", source)
        self.assertIn("diagnosticReviewController = null", source)
        self.assertIn("mount.dataset.systemDiagnosticsReviewMount", source)
        self.assertIn("diagnosticReviewController,", source)
        self.assertIn("lifecycle,", source)
        self.assertNotIn("copyPreparedSummary()", source)
        self.assertNotIn("exportPrepared()", source)
        self.assertNotIn("navigator.clipboard", source)
        self.assertNotIn("writeText(", source)

    def test_child_mount_is_disposed_before_owner_repaint_and_destroy(self):
        source = self.source()
        self.assertIn("let diagnosticsReviewMount = null", source)
        self.assertIn("const disposeDiagnosticsReview = () =>", source)
        self.assertIn("diagnosticsReviewMount?.dispose()", source)
        paint = source.index("const paint =")
        replace = source.index("slot.replaceChildren();", paint)
        dispose = source.index("disposeDiagnosticsReview();", paint)
        self.assertLess(dispose, replace)
        destroy = source.index("destroy() {")
        self.assertIn("disposeDiagnosticsReview();", source[destroy:])

    def test_opening_diagnostics_prepares_once_without_restarting_on_repaint(self):
        source = self.source()
        self.assertIn("let diagnosticReviewStarted = false;", source)
        mount = source.index("if (diagnosticMount) {")
        prepared = source.index("if (!diagnosticReviewStarted) {", mount)
        update_flag = source.index("diagnosticReviewStarted = true;", prepared)
        prepare = source.index("void diagnosticReviewController.prepare();", update_flag)
        restored = source.index("restoreInteractionState(slot, interaction);", prepare)
        self.assertLess(mount, prepared)
        self.assertLess(prepared, update_flag)
        self.assertLess(update_flag, prepare)
        self.assertLess(prepare, restored)
        self.assertEqual(source.count("void diagnosticReviewController.prepare();"), 1)
        # Review preparation cannot be conflated with exporting or repairing.
        self.assertNotIn("diagnosticReviewController.exportPrepared()", source)
        self.assertNotIn("diagnosticReviewController.copyPreparedSummary()", source)

    def test_missing_slot_also_releases_diagnostic_subscription(self):
        source = self.source()
        marker = "if (!slot) {\n      disposeDiagnosticsReview();\n      mountedSlot = null;"
        self.assertIn(marker, source)

    def test_owner_preserves_diagnostic_action_focus_across_repaint(self):
        source = self.source()
        self.assertIn("dataset.systemDiagnosticsPrepare", source)
        self.assertIn("dataset.systemDiagnosticsCopy", source)
        self.assertIn("dataset.systemDiagnosticsExport", source)
        self.assertIn('kind: "diagnostics-prepare"', source)
        self.assertIn('kind: "diagnostics-copy"', source)
        self.assertIn('kind: "diagnostics-export"', source)

    def test_diagnostics_section_keeps_capabilities_when_review_controller_is_absent(self):
        source = self.source()
        diagnostics_branch = source.index('activeSection === "diagnostics"')
        about_branch = source.index('activeSection === "about"', diagnostics_branch)
        block = source[diagnostics_branch:about_branch]
        self.assertIn("renderDiagnosticReviewMount(view)", block)
        self.assertIn("renderCapabilities(view)", block)
        self.assertIn("if (diagnosticReviewController === null) return null", source)


if __name__ == "__main__":
    unittest.main()
