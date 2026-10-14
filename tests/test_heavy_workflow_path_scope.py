from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / ".github" / "workflows"
QEMU_WORKFLOW = "portable-v2-qemu-boot-proof.yml"
PACKAGING_WORKFLOWS = (
    "portable-boot-handoff-proof.yml",
    "portable-release-image.yml",
    "release-pipeline.yml",
)
SYSTEM_INCLUDE = "      - 'system/**'"
SYSTEM_MARKDOWN_EXCLUDE = "      - '!system/**/*.md'"
QEMU_PRESENTATION_EXCLUDES = (
    "      - '!system/surface/ui/**'",
    "      - '!system/surface/workspace/**'",
)


class HeavyWorkflowPathScopeTests(unittest.TestCase):
    def test_generic_system_payload_is_owned_by_lightweight_release_bundle_gate(self):
        text = (WORKFLOW_DIR / "release-bundle.yml").read_text(encoding="utf-8")
        self.assertEqual(text.count(SYSTEM_INCLUDE), 2)
        self.assertEqual(text.count(SYSTEM_MARKDOWN_EXCLUDE), 2)
        self.assertIn("Prove current repository system tree is releasable", text)
        self.assertIn("CURRENT_SYSTEM_BUNDLE_RELEASABLE=PASS", text)

    def test_packaging_proofs_do_not_rerun_for_arbitrary_system_payload_changes(self):
        for name in PACKAGING_WORKFLOWS:
            with self.subTest(workflow=name):
                text = (WORKFLOW_DIR / name).read_text(encoding="utf-8")
                self.assertNotIn(SYSTEM_INCLUDE, text)
                self.assertNotIn(SYSTEM_MARKDOWN_EXCLUDE, text)

    def test_qemu_system_runtime_scope_stays_enabled_but_presentation_is_excluded(self):
        text = (WORKFLOW_DIR / QEMU_WORKFLOW).read_text(encoding="utf-8")
        lines = text.splitlines()
        include_indexes = [
            index for index, line in enumerate(lines) if line == SYSTEM_INCLUDE
        ]
        self.assertEqual(len(include_indexes), 2)
        self.assertEqual(text.count(SYSTEM_MARKDOWN_EXCLUDE), 2)
        for exclusion in QEMU_PRESENTATION_EXCLUDES:
            self.assertEqual(text.count(exclusion), 2)

        for index in include_indexes:
            self.assertEqual(lines[index + 1], SYSTEM_MARKDOWN_EXCLUDE)
            self.assertEqual(lines[index + 2], QEMU_PRESENTATION_EXCLUDES[0])
            self.assertEqual(lines[index + 3], QEMU_PRESENTATION_EXCLUDES[1])

    def test_workflow_definition_changes_still_trigger_their_own_proof(self):
        names = (*PACKAGING_WORKFLOWS, QEMU_WORKFLOW, "release-bundle.yml")
        for name in names:
            with self.subTest(workflow=name):
                text = (WORKFLOW_DIR / name).read_text(encoding="utf-8")
                self.assertIn(f"      - '.github/workflows/{name}'", text)


if __name__ == "__main__":
    unittest.main()
