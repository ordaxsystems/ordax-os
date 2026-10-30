from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INDEPENDENT = ROOT / ".github/workflows/independent-base-experiment.yml"
STABLE = ROOT / ".github/workflows/stable-base-candidate.yml"
CACHE_SHA = "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"


class BaseKernelReuseWorkflowTests(unittest.TestCase):
    def workflow(self, path: Path) -> str:
        return path.read_text(encoding="utf-8")

    def step_block(self, text: str, name: str) -> str:
        marker = f"      - name: {name}\n"
        start = text.index(marker)
        next_step = text.find("\n      - name: ", start + len(marker))
        if next_step < 0:
            next_step = len(text)
        return text[start:next_step]

    def assert_kernel_reuse_contract(self, path: Path, build_step: str) -> None:
        workflow = self.workflow(path)
        # Other verified components and Buildroot downloads have independent
        # cache steps. Bind this contract to the kernel steps only.
        restore = self.step_block(workflow, "Restore verified kernel component")
        save = self.step_block(workflow, "Save verified kernel component")
        self.assertEqual(restore.count(f"actions/cache/restore@{CACHE_SHA}"), 1)
        self.assertEqual(save.count(f"actions/cache/save@{CACHE_SHA}"), 1)
        self.assertNotIn("restore-keys:", restore)
        self.assertIn("id: kernel-cache", restore)
        self.assertIn("steps.component-fingerprints.outputs.kernel", restore)
        self.assertIn("steps.component-fingerprints.outputs.kernel", save)
        self.assertIn("ORDAX_COMPONENT_CACHE_ENVIRONMENT", workflow)
        self.assertIn("${ImageOS}", workflow)
        self.assertIn("${ImageVersion}", workflow)
        self.assertIn("portable_component_cache.py fingerprints", workflow)
        self.assertIn(
            "if: steps.kernel-cache.outputs.cache-hit != 'true'",
            self.step_block(workflow, build_step),
        )
        verify = self.step_block(workflow, "Verify kernel component and exact integration binding")
        self.assertNotIn("if: steps.kernel-cache", verify)
        self.assertIn("portable_component_cache.py verify", verify)
        self.assertIn("--component kernel", verify)
        self.assertIn("kernel-component-reuse.json", verify)
        self.assertIn("--integration-commit", verify)
        self.assertIn("provenance", workflow)

    def test_independent_qemu_reuses_only_authenticated_kernel_bytes(self):
        workflow = self.workflow(INDEPENDENT)
        self.assert_kernel_reuse_contract(
            INDEPENDENT,
            "Build canonical OrdaX kernel on verified cache miss",
        )
        qemu = self.step_block(
            workflow,
            "QEMU real kernel, EROFS and ext4 persistence/recovery",
        )
        self.assertNotIn("cache-hit", qemu)
        self.assertIn('--kernel-dir "$RUNNER_TEMP/portable-v2-qemu/kernel"', qemu)
        self.assertIn("bootstrap/kernel/source.json", workflow)
        self.assertIn("bootstrap/kernel/config/ordax.fragment", workflow)
        self.assertIn("tools/ci/portable_component_cache.py", workflow)
        self.assertNotIn("      - 'tests/test_independent_base_experiment.py'", workflow)
        self.assertNotIn("      - 'tests/test_independent_network_parity.py'", workflow)

    def test_stable_base_reuses_kernel_but_never_skips_base_build(self):
        workflow = self.workflow(STABLE)
        self.assert_kernel_reuse_contract(
            STABLE,
            "Build exact kernel modules on verified cache miss",
        )
        stable_build = self.step_block(workflow, "Build and verify Stable Base candidate")
        self.assertNotIn("cache-hit", stable_build)
        self.assertIn(
            '--kernel-modules "$kernel_dir/kernel-modules-$ORDAX_KERNEL_VERSION.tar"',
            stable_build,
        )

    def test_inventory_only_changes_do_not_trigger_stable_kernel_rebuild_workflow(self):
        workflow = self.workflow(STABLE)
        self.assertNotIn("      - 'platform/compliance/declared-inputs.json'", workflow)
        self.assertNotIn("      - 'tests/test_third_party_inventory.py'", workflow)
        self.assertIn("tests.test_third_party_inventory", workflow)
        foundation = (ROOT / ".github/workflows/foundation.yml").read_text(encoding="utf-8")
        self.assertIn("python -m unittest discover -s tests -p 'test_*.py' -v", foundation)

    def test_markdown_only_changes_do_not_trigger_heavy_base_workflows(self):
        independent = self.workflow(INDEPENDENT)
        self.assertEqual(
            independent.count("      - '!bootstrap/independent-base/**/*.md'"),
            1,
        )
        stable = self.workflow(STABLE)
        for pattern in (
            "      - '!bootstrap/base/**/*.md'",
            "      - '!bootstrap/stable-base/**/*.md'",
            "      - '!bootstrap/kernel/**/*.md'",
        ):
            self.assertEqual(stable.count(pattern), 2)


if __name__ == "__main__":
    unittest.main()
