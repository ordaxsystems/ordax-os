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
QEMU_LIVE_RELOAD_EXCLUDES = (
    "      - '!system/apps/**'",
    "      - '!system/adapters/**'",
    "      - '!system/contracts/**'",
    "      - '!system/services/**'",
    "      - '!system/composition/**'",
    "      - '!system/surface/ui/**'",
    "      - '!system/surface/workspace/**'",
)
QEMU_RUNTIME_REINCLUDES = (
    "      - 'system/services/local-ai/source-lock.json'",
    "      - 'system/services/telemetry/base-agent.sh'",
    "      - 'system/services/telemetry/relay.json'",
    "      - 'system/services/base-update/agent.sh'",
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

    def test_qemu_keeps_system_host_scope_but_excludes_live_reload_owners(self):
        text = (WORKFLOW_DIR / QEMU_WORKFLOW).read_text(encoding="utf-8")
        lines = text.splitlines()
        include_indexes = [
            index for index, line in enumerate(lines) if line == SYSTEM_INCLUDE
        ]
        self.assertEqual(len(include_indexes), 2)
        self.assertEqual(text.count(SYSTEM_MARKDOWN_EXCLUDE), 2)
        for exclusion in QEMU_LIVE_RELOAD_EXCLUDES:
            self.assertEqual(text.count(exclusion), 2)
        for reinclusion in QEMU_RUNTIME_REINCLUDES:
            self.assertEqual(text.count(reinclusion), 2)

        expected_after_include = (
            SYSTEM_MARKDOWN_EXCLUDE,
            *QEMU_LIVE_RELOAD_EXCLUDES,
            *QEMU_RUNTIME_REINCLUDES,
        )
        for index in include_indexes:
            observed = tuple(
                lines[index + offset]
                for offset in range(1, len(expected_after_include) + 1)
            )
            self.assertEqual(observed, expected_after_include)

    def test_qemu_reincludes_real_runtime_inputs_after_service_exclusion(self):
        text = (WORKFLOW_DIR / QEMU_WORKFLOW).read_text(encoding="utf-8")
        for reinclusion in QEMU_RUNTIME_REINCLUDES:
            self.assertIn(reinclusion, text)
        self.assertIn("--local-ai-source-lock system/services/local-ai/source-lock.json", text)

    def test_workflow_definition_changes_still_trigger_their_own_proof(self):
        names = (*PACKAGING_WORKFLOWS, QEMU_WORKFLOW, "release-bundle.yml")
        for name in names:
            with self.subTest(workflow=name):
                text = (WORKFLOW_DIR / name).read_text(encoding="utf-8")
                self.assertIn(f"      - '.github/workflows/{name}'", text)


if __name__ == "__main__":
    unittest.main()
