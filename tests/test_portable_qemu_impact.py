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


OWNER_REMOTE_SLICE = [
    ".github/workflows/owner-remote-recovery-contract.yml",
    "bootstrap/base-update/owner-development/ordax-remote",
    "bootstrap/base-update/owner-development/owner-recovery-source.json",
    "docs/REMOTE-CONTROL.md",
    "system/services/base-update/dev-helpers.sh",
    "tests/test_dev_base_helper_refresh.py",
    "tests/test_owner_remote_recovery.py",
]

INDEPENDENT_SURFACE_POLICY_SLICE = [
    ".github/workflows/independent-surface-runtime.yml",
    "bootstrap/independent-surface-runtime/CUTOVER-CHECKLIST.md",
    "bootstrap/independent-surface-runtime/README.md",
    "docs/contracts/ci-supply-chain.json",
    "tests/test_independent_surface_component_cache.py",
    "tests/test_independent_surface_impact.py",
    "tests/test_independent_surface_runtime.py",
    "tests/test_independent_surface_cutover_audit.py",
    "tests/test_independent_surface_cold_health_contract.py",
    "tools/ci/independent_surface_component_cache.py",
    "tools/ci/independent_surface_impact.py",
    "tools/ci/independent_surface_cutover_audit.py",
]


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

    def test_owner_remote_recovery_slice_does_not_require_portable_qemu(self):
        result = impact.classify_paths(OWNER_REMOTE_SLICE, root=ROOT)
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("high-level-not-runtime-reachable",))

    def test_real_kernel_change_stays_heavy_with_owner_remote_recovery_slice(self):
        result = impact.classify_paths(
            [*OWNER_REMOTE_SLICE, "bootstrap/kernel/source.json"],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertIn("heavy-non-system:bootstrap/kernel/source.json", result.reasons)

    def test_independent_surface_policy_slice_does_not_require_standalone_qemu(self):
        result = impact.classify_paths(INDEPENDENT_SURFACE_POLICY_SLICE, root=ROOT)
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("high-level-not-runtime-reachable",))

    def test_real_kernel_change_stays_heavy_with_independent_surface_policy_slice(self):
        result = impact.classify_paths(
            [*INDEPENDENT_SURFACE_POLICY_SLICE, "bootstrap/kernel/source.json"],
            root=ROOT,
        )
        self.assertTrue(result.required)
        self.assertIn("heavy-non-system:bootstrap/kernel/source.json", result.reasons)

    def test_impact_policy_change_uses_focused_contract_instead_of_qemu(self):
        result = impact.classify_paths(
            [
                ".github/workflows/portable-qemu-impact-contract.yml",
                "tools/ci/portable_qemu_impact.py",
                "tests/test_portable_qemu_impact.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("high-level-not-runtime-reachable",))

    def test_qemu_workflow_change_uses_focused_contract_instead_of_boot(self):
        result = impact.classify_paths(
            [
                ".github/workflows/portable-v2-qemu-boot-proof.yml",
                "tests/test_portable_v2_qemu_boot_proof_contract.py",
                "tests/test_portable_component_reuse_workflow.py",
                "tests/test_independent_surface_qemu_binding.py",
            ],
            root=ROOT,
        )
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("high-level-not-runtime-reachable",))

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
