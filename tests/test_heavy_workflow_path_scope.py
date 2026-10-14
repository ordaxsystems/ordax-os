from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / ".github" / "workflows"
HEAVY_WORKFLOWS = (
    "portable-boot-handoff-proof.yml",
    "portable-release-image.yml",
    "portable-v2-qemu-boot-proof.yml",
    "release-pipeline.yml",
)
SYSTEM_INCLUDE = "      - 'system/**'"
SYSTEM_MARKDOWN_EXCLUDE = "      - '!system/**/*.md'"
QEMU_PRESENTATION_EXCLUDES = (
    "      - '!system/surface/ui/**'",
    "      - '!system/surface/workspace/**'",
)


class HeavyWorkflowPathScopeTests(unittest.TestCase):
    def test_system_runtime_scope_stays_enabled_but_markdown_is_excluded(self):
        for name in HEAVY_WORKFLOWS:
            with self.subTest(workflow=name):
                text = (WORKFLOW_DIR / name).read_text(encoding="utf-8")
                lines = text.splitlines()
                include_indexes = [
                    index for index, line in enumerate(lines) if line == SYSTEM_INCLUDE
                ]

                # One include for push/main and one for pull_request keeps executable
                # system changes covered by the heavy proof.
                self.assertEqual(len(include_indexes), 2)
                self.assertEqual(text.count(SYSTEM_MARKDOWN_EXCLUDE), 2)

                # GitHub evaluates negative path patterns in order, so keep the
                # documentation exclusion immediately after its broad include.
                for index in include_indexes:
                    self.assertLess(index + 1, len(lines))
                    self.assertEqual(lines[index + 1], SYSTEM_MARKDOWN_EXCLUDE)

    def test_qemu_boot_proof_does_not_compile_kernel_for_surface_presentation_only_changes(self):
        text = (WORKFLOW_DIR / "portable-v2-qemu-boot-proof.yml").read_text(
            encoding="utf-8"
        )
        for exclusion in QEMU_PRESENTATION_EXCLUDES:
            with self.subTest(exclusion=exclusion):
                # Push and pull_request both use the same causal scope.
                self.assertEqual(text.count(exclusion), 2)

    def test_workflow_definition_changes_still_trigger_their_own_proof(self):
        for name in HEAVY_WORKFLOWS:
            with self.subTest(workflow=name):
                text = (WORKFLOW_DIR / name).read_text(encoding="utf-8")
                self.assertIn(f"      - '.github/workflows/{name}'", text)


if __name__ == "__main__":
    unittest.main()
