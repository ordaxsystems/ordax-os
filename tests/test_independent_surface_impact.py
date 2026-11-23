from pathlib import Path
import importlib.util
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/ci/independent_surface_impact.py"


def load_module():
    name = "independent_surface_impact"
    spec = importlib.util.spec_from_file_location(name, SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class IndependentSurfaceImpactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_module()

    def test_real_surface_byte_owners_are_heavy(self):
        for path in (
            "bootstrap/surface-runtime/build.py",
            "bootstrap/surface-runtime/prepare_config.py",
            "bootstrap/surface-runtime/source.json",
            "bootstrap/surface-runtime/configs/ordax_surface_defconfig",
            "bootstrap/independent-base/source.json",
            "bootstrap/kernel/source.json",
        ):
            with self.subTest(path=path):
                result = self.mod.classify_paths([path])
                self.assertTrue(result.required)

    def test_contract_docs_and_ci_only_changes_are_light(self):
        result = self.mod.classify_paths([
            "bootstrap/surface-runtime/README.md",
            "bootstrap/surface-runtime/CUTOVER-CHECKLIST.md",
            "tests/test_independent_surface_runtime.py",
            "tests/test_ci_two_stage_release_gate.py",
            "tests/test_independent_surface_qemu_binding.py",
            "tests/test_independent_surface_impact.py",
            "tests/test_independent_surface_component_cache.py",
            "tests/test_independent_surface_cutover_audit.py",
            "tests/test_independent_surface_cold_health_contract.py",
            "tests/test_portable_component_reuse_workflow.py",
            "tests/test_portable_qemu_impact.py",
            "tests/test_ci_git_diff_exact_paths.py",
            "tests/test_creator_owner_impact.py",
            ".github/workflows/independent-surface-runtime.yml",
            ".github/workflows/portable-v2-qemu-boot-proof.yml",
            ".github/workflows/portable-qemu-impact-contract.yml",
            ".github/workflows/external-source-lock-integration.yml",
            "tests/test_source_integration_advance.py",
            "docs/contracts/ci-supply-chain.json",
            "tools/ci/creator_owner_impact.py",
            "tools/ci/independent_surface_impact.py",
            "tools/ci/independent_surface_component_cache.py",
            "tools/ci/independent_surface_cutover_audit.py",
            "tools/ci/portable_qemu_impact.py",
        ])
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("contract-only",))

    def test_b68_surface_workflow_and_test_delta_is_light_across_push_commits(self):
        paths = (
            ".github/workflows/independent-surface-runtime.yml",
            "tests/test_ci_two_stage_release_gate.py",
            "tests/test_independent_surface_component_cache.py",
            "tests/test_independent_surface_runtime.py",
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)

            def git(*args):
                return subprocess.check_output(
                    ["git", "-C", str(root), *args], stderr=subprocess.PIPE
                ).decode("utf-8").strip()

            git("init", "-q")
            git("config", "user.name", "CI")
            git("config", "user.email", "ci@example.invalid")
            git("commit", "--allow-empty", "-qm", "push base")
            for index, path in enumerate(paths):
                file = root / path
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(f"change {index}\n", encoding="utf-8")
                if index == 1:
                    git("add", "-A")
                    git("commit", "-qm", "first push commit")
            git("add", "-A")
            git("commit", "-qm", "second push commit")
            base = git("rev-parse", "HEAD~2")
            head = git("rev-parse", "HEAD")

            changed = self.mod.changed_paths_between(base, head, root=root)
            self.assertEqual(set(changed), set(paths))
            result = self.mod.classify_paths(changed)
            self.assertFalse(result.required)
            self.assertEqual(result.reasons, ("contract-only",))

    def test_pr_delta_ignores_target_commits_after_the_branch_fork(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)

            def git(*args):
                return subprocess.check_output(
                    ["git", "-C", str(root), *args], stderr=subprocess.PIPE
                ).decode("utf-8").strip()

            git("init", "-q")
            git("config", "user.name", "CI")
            git("config", "user.email", "ci@example.invalid")
            (root / "base.txt").write_text("base\n", encoding="utf-8")
            git("add", "-A")
            git("commit", "-qm", "common base")
            common = git("rev-parse", "HEAD")
            git("branch", "-M", "target")
            target_branch = "target"
            git("branch", "feature")

            git("checkout", "-q", "feature")
            (root / "tests").mkdir()
            (root / "tests/test_ci_two_stage_release_gate.py").write_text(
                "contract test\n", encoding="utf-8"
            )
            git("add", "-A")
            git("commit", "-qm", "PR test-only change")
            head = git("rev-parse", "HEAD")

            git("checkout", "-q", target_branch)
            (root / "bootstrap/surface-runtime/configs").mkdir(parents=True)
            (root / "bootstrap/surface-runtime/configs/ordax_surface_defconfig").write_text(
                "target-only change\n", encoding="utf-8"
            )
            git("add", "-A")
            git("commit", "-qm", "target advances independently")
            base = git("rev-parse", "HEAD")

            changed = self.mod.changed_paths_between(
                base, head, root=root, use_merge_base=True
            )
            self.assertEqual(changed, ("tests/test_ci_two_stage_release_gate.py",))
            self.assertFalse(self.mod.classify_paths(changed).required)
            self.assertTrue(
                self.mod.classify_paths(
                    self.mod.changed_paths_between(base, head, root=root)
                ).required
            )
            self.assertNotEqual(common, base)

    def test_workflow_uses_real_pr_base_and_push_before_sha(self):
        workflow = (ROOT / ".github/workflows/independent-surface-runtime.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            "ORDAX_IMPACT_BASE: ${{ github.event.pull_request.base.sha || github.event.before || '' }}",
            workflow,
        )
        self.assertIn(
            "ORDAX_IMPACT_USE_MERGE_BASE: ${{ github.event_name == 'pull_request' }}",
            workflow,
        )
        self.assertIn('merge_base=(--merge-base)', workflow)

    def test_unknown_path_fails_closed(self):
        result = self.mod.classify_paths(["bootstrap/something-new/runtime.py"])
        self.assertTrue(result.required)
        self.assertIn("unclassified:bootstrap/something-new/runtime.py", result.reasons)

    def test_no_change_is_light(self):
        result = self.mod.classify_paths([])
        self.assertFalse(result.required)
        self.assertEqual(result.reasons, ("no-changes",))


if __name__ == "__main__":
    unittest.main()
