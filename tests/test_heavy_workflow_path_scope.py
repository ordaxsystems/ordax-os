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
    def test_domain_workflows_do_not_use_native_main_as_a_catch_all_trigger(self):
        native_main = "      - 'system/composition/native/main.mjs'"
        domain_workflows = (
            "account-memory-local-continuity-flush.yml",
            "account-memory-protected-mutations.yml",
            "account-memory-sync-foundation.yml",
            "application-action-capability-foundation.yml",
            "component-trusted-context.yml",
            "first-party-app-delivery.yml",
            "intelligence-foundation.yml",
            "native-intelligence-service-foundation.yml",
            "pre-usb-nova-ordax-audit.yml",
            "runtime-component-candidate.yml",
        )
        for name in domain_workflows:
            with self.subTest(workflow=name):
                text = (WORKFLOW_DIR / name).read_text(encoding="utf-8")
                self.assertNotIn(native_main, text)

        intelligence = (WORKFLOW_DIR / "intelligence-foundation.yml").read_text(encoding="utf-8")
        self.assertNotIn("system/surface/ui/account-overview-controls.mjs", intelligence)
        self.assertNotIn("system/surface/ui/account.css", intelligence)

        surface = (WORKFLOW_DIR / "surface-web-candidate.yml").read_text(encoding="utf-8")
        self.assertEqual(surface.count("      - 'system/composition/native/**'"), 2)

    def test_local_ai_engine_candidate_does_not_rebuild_for_disposable_composition(self):
        text = (WORKFLOW_DIR / "local-ai-runtime-candidate.yml").read_text(encoding="utf-8")
        self.assertNotIn("      - 'tools/intelligence-source/**'", text)
        self.assertNotIn("      - 'tools/intelligence-source/compose.py'", text)
        self.assertIn("      - 'tools/intelligence-source/materialize.py'", text)
        self.assertIn("      - 'docs/contracts/intelligence-source.json'", text)
        self.assertIn("      - '.github/actions/resolve-intelligence-builder/**'", text)
        self.assertIn("      - '.github/workflows/local-ai-runtime-candidate.yml'", text)
        self.assertIn("Build real local AI runtime twice", text)
        self.assertIn("group: local-ai-runtime-candidate-", text)
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", text)

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

    def test_qemu_broad_trigger_is_routed_through_causal_impact_gate(self):
        text = (WORKFLOW_DIR / QEMU_WORKFLOW).read_text(encoding="utf-8")
        self.assertEqual(text.count(SYSTEM_INCLUDE), 2)
        self.assertEqual(text.count(SYSTEM_MARKDOWN_EXCLUDE), 2)
        for exclusion in QEMU_PRESENTATION_EXCLUDES:
            self.assertEqual(text.count(exclusion), 2)

        self.assertIn("  impact:\n    name: Portable v2 QEMU Impact", text)
        self.assertIn("python3 tools/ci/portable_qemu_impact.py classify", text)
        self.assertIn("  qemu-portable-v2:\n    needs: impact", text)
        self.assertIn("if: needs.impact.outputs.required == 'true'", text)
        self.assertEqual(text.count("- 'tools/ci/portable_qemu_impact.py'"), 2)
        self.assertEqual(text.count("- 'tests/test_portable_qemu_impact.py'"), 2)

    def test_explicit_reusable_callers_force_heavy_proof_by_default(self):
        text = (WORKFLOW_DIR / QEMU_WORKFLOW).read_text(encoding="utf-8")
        self.assertIn("force_run:\n        type: boolean", text)
        self.assertIn("default: true", text)
        self.assertIn('ORDAX_FORCE_QEMU: ${{ inputs.force_run || false }}', text)

    def test_workflow_definition_changes_still_trigger_their_own_proof(self):
        names = (*PACKAGING_WORKFLOWS, QEMU_WORKFLOW, "release-bundle.yml")
        for name in names:
            with self.subTest(workflow=name):
                text = (WORKFLOW_DIR / name).read_text(encoding="utf-8")
                self.assertIn(f"      - '.github/workflows/{name}'", text)


if __name__ == "__main__":
    unittest.main()
