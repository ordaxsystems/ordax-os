from pathlib import Path
import importlib.util
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "ci" / "portable_qemu_impact.py"
spec = importlib.util.spec_from_file_location("portable_qemu_impact", MODULE_PATH)
assert spec is not None and spec.loader is not None
impact = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = impact
spec.loader.exec_module(impact)


class PortableQemuImpactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reachable, cls.graph_errors = impact.native_startup_import_graph(ROOT)

    def test_current_native_runtime_graph_resolves_all_discovered_roots(self):
        self.assertEqual(self.graph_errors, ())
        self.assertIn("system/composition/native/main.mjs", self.reachable)
        self.assertIn("system/composition/native/app-data-bootstrap.mjs", self.reachable)
        self.assertIn("system/composition/native/component-probation.mjs", self.reachable)
        self.assertIn("system/services/local-ai/runtime.mjs", self.reachable)
        self.assertIn("system/contracts/local-ai.mjs", self.reachable)
        self.assertIn("system/services/components/probation-orchestrator.mjs", self.reachable)

    def test_workflow_scope_is_derived_from_identical_push_and_pr_blocks(self):
        patterns = impact.workflow_path_patterns(ROOT)
        self.assertIn("system/**", patterns)
        self.assertIn("!system/**/*.md", patterns)
        self.assertIn("bootstrap/kernel/**", patterns)
        self.assertIn("!bootstrap/kernel/candidates/**", patterns)
        self.assertIn("tools/ci/portable_qemu_impact.py", patterns)
        self.assertIn(".github/workflows/portable-v2-qemu-boot-proof.yml", patterns)

    def test_unwired_high_level_web_research_source_does_not_require_qemu(self):
        result = impact.classify_paths(
            [
                "system/contracts/web-research.mjs",
                "system/services/web-research/provider-router.mjs",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("high-level-not-runtime-reachable",))

    def test_native_runtime_reachable_service_requires_qemu(self):
        result = impact.classify_paths(["system/services/local-ai/runtime.mjs"], root=ROOT)
        self.assertTrue(result.required)
        self.assertIn("native-runtime-reachable:system/services/local-ai/runtime.mjs", result.reasons)

    def test_browser_host_dynamic_runtime_dependency_requires_qemu(self):
        result = impact.classify_paths(
            ["system/services/components/probation-orchestrator.mjs"],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertIn(
            "native-runtime-reachable:system/services/components/probation-orchestrator.mjs",
            result.reasons,
        )

    def test_presentation_stays_light_even_when_native_composition_imports_it(self):
        result = impact.classify_paths(["system/surface/ui/network-quick-panel.mjs"], root=ROOT)
        self.assertFalse(result.required)

    def test_boot_host_and_unknown_system_root_fail_closed(self):
        boot = impact.classify_paths(["system/entrypoint"], root=ROOT)
        unknown = impact.classify_paths(["system/new-kernel-facing-owner/config.bin"], root=ROOT)
        self.assertTrue(boot.required)
        self.assertTrue(unknown.required)
        self.assertIn("heavy-exact:system/entrypoint", boot.reasons)
        self.assertIn(
            "heavy-unclassified-system:system/new-kernel-facing-owner/config.bin",
            unknown.reasons,
        )

    def test_non_system_trigger_is_heavy_by_default(self):
        result = impact.classify_paths(["bootstrap/kernel/source.json"], root=ROOT)
        self.assertTrue(result.required)
        self.assertIn("heavy-non-system:bootstrap/kernel/source.json", result.reasons)

    def test_kernel_module_archive_helper_does_not_require_portable_qemu(self):
        result = impact.classify_paths(["bootstrap/kernel/module_archive.py"], root=ROOT)
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("high-level-not-runtime-reachable",))

    def test_full_independent_module_slice_does_not_require_direct_stable_qemu(self):
        result = impact.classify_paths(
            [
                ".github/workflows/independent-base-experiment.yml",
                "bootstrap/independent-base/module_parity.py",
                "bootstrap/independent-base/post-build.sh",
                "bootstrap/kernel/module_archive.py",
                "tests/test_independent_kernel_module_workflow.py",
                "tests/test_kernel_module_archive.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("high-level-not-runtime-reachable",))

    def test_real_kernel_change_stays_heavy_with_full_independent_module_slice(self):
        result = impact.classify_paths(
            [
                ".github/workflows/independent-base-experiment.yml",
                "bootstrap/independent-base/module_parity.py",
                "bootstrap/independent-base/post-build.sh",
                "bootstrap/kernel/module_archive.py",
                "tests/test_independent_kernel_module_workflow.py",
                "tests/test_kernel_module_archive.py",
                "bootstrap/kernel/source.json",
            ],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertIn("heavy-non-system:bootstrap/kernel/source.json", result.reasons)

    def test_workflow_scope_filters_mixed_owner_pr_side_paths(self):
        result = impact.classify_workflow_paths(
            [
                "system/services/base-update/dev-helpers.sh",
                "bootstrap/base-update/owner-development/ordax-remote",
                "bootstrap/base-update/owner-development/owner-recovery-source.json",
                "docs/REMOTE-CONTROL.md",
                "tests/test_dev_base_helper_refresh.py",
                "tests/test_owner_remote_recovery.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(
            result.changed_paths,
            ("system/services/base-update/dev-helpers.sh",),
        )
        self.assertEqual(result.reasons, ("high-level-not-runtime-reachable",))

    def test_workflow_scope_keeps_real_kernel_input_heavy_in_mixed_delta(self):
        result = impact.classify_workflow_paths(
            [
                "docs/unrelated-note.md",
                "bootstrap/base-update/owner-development/ordax-remote",
                "bootstrap/kernel/source.json",
            ],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertEqual(result.changed_paths, ("bootstrap/kernel/source.json",))
        self.assertIn("heavy-non-system:bootstrap/kernel/source.json", result.reasons)

    def test_workflow_scope_matches_important_trigger_exclusions(self):
        excluded = impact.workflow_scoped_paths(
            [
                "system/surface/ui/panel.mjs",
                "system/surface/workspace/view.mjs",
                "system/services/example/README.md",
                "bootstrap/kernel/candidates/example.json",
                "bootstrap/kernel/README.md",
                "bootstrap/surface-runtime/README.md",
                "bootstrap/release-acquisition/README.md",
                "tools/release-signing/windows/helper.ps1",
                "tools/release-signing/promote_public_trust.py",
                "tools/release-signing/README.md",
            ],
            root=ROOT,
        )
        self.assertEqual(excluded, ())
        included = impact.workflow_scoped_paths(
            [
                "system/entrypoint",
                "bootstrap/kernel/source.json",
                "bootstrap/stable-base/source.json",
                "tools/release-signing/sign.py",
                ".github/workflows/portable-v2-qemu-boot-proof.yml",
            ],
            root=ROOT,
        )
        self.assertEqual(
            included,
            (
                ".github/workflows/portable-v2-qemu-boot-proof.yml",
                "bootstrap/kernel/source.json",
                "bootstrap/stable-base/source.json",
                "system/entrypoint",
                "tools/release-signing/sign.py",
            ),
        )

    def test_outside_workflow_scope_only_is_not_heavy(self):
        result = impact.classify_workflow_paths(
            [
                "bootstrap/base-update/owner-development/ordax-remote",
                "docs/REMOTE-CONTROL.md",
                "tests/test_owner_remote_recovery.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.changed_paths, ())
        self.assertEqual(result.reasons, ("outside-workflow-scope-only",))

    def test_workflow_scope_drift_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workflow = root / ".github/workflows/portable-v2-qemu-boot-proof.yml"
            workflow.parent.mkdir(parents=True)
            workflow.write_text(
                "on:\n"
                "  push:\n"
                "    paths:\n"
                "      - 'system/**'\n"
                "  pull_request:\n"
                "    paths:\n"
                "      - 'bootstrap/kernel/**'\n",
                encoding="utf-8",
            )
            result = impact.classify_workflow_paths(["system/entrypoint"], root=root)
        self.assertTrue(result.required)
        self.assertTrue(result.reasons[0].startswith("workflow-scope:ValueError:"))
        self.assertIn("push-pull-workflow-path-scope-drift", result.reasons[0])

    def test_missing_runtime_root_discovery_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            result = impact.classify_paths(
                ["system/contracts/web-research.mjs"],
                root=Path(directory),
            )
        self.assertTrue(result.required)
        self.assertTrue(any(reason.startswith("runtime-graph:") for reason in result.reasons))


if __name__ == "__main__":
    unittest.main()
