from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CREATOR_PAYLOAD = ROOT / ".github/workflows/creator-payload-candidate.yml"
OWNER_DEV = ROOT / ".github/workflows/creator-owner-dev-git.yml"
DEV_BASE_CHANNEL = ROOT / ".github/workflows/dev-base-channel.yml"
OWNER_DEV_DIAGNOSE = ROOT / ".github/workflows/creator-owner-build-diagnose.yml"
CACHE_SHA = "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"


class CreatorKernelReuseWorkflowTests(unittest.TestCase):
    def workflow(self, path: Path) -> str:
        return path.read_text(encoding="utf-8")

    def step_block(self, text: str, name: str) -> str:
        marker = f"      - name: {name}\n"
        start = text.index(marker)
        next_step = text.find("\n      - name: ", start + len(marker))
        if next_step < 0:
            next_step = len(text)
        return text[start:next_step]

    def assert_verified_kernel_reuse(self, path: Path) -> str:
        workflow = self.workflow(path)
        self.assertEqual(workflow.count(f"actions/cache/restore@{CACHE_SHA}"), 1)
        self.assertEqual(workflow.count(f"actions/cache/save@{CACHE_SHA}"), 1)
        self.assertNotIn("restore-keys:", workflow)
        self.assertIn("ORDAX_COMPONENT_CACHE_ENVIRONMENT", workflow)
        self.assertIn("${ImageOS}", workflow)
        self.assertIn("${ImageVersion}", workflow)
        self.assertIn("portable_component_cache.py fingerprints", workflow)

        build = self.step_block(workflow, "Build kernel candidate on verified cache miss")
        self.assertIn("steps.kernel-cache.outputs.cache-hit != 'true'", build)
        self.assertIn("bootstrap/kernel/build.py build --jobs 4", build)

        verify = self.step_block(
            workflow,
            "Verify kernel component and exact integration binding",
        )
        self.assertNotIn("if: steps.kernel-cache", verify)
        self.assertIn("bootstrap/kernel/verify.py out/kernel", verify)
        self.assertIn("portable_component_cache.py record", verify)
        self.assertIn("portable_component_cache.py verify", verify)
        self.assertIn("--component kernel", verify)
        self.assertIn("--integration-commit", verify)
        self.assertIn("kernel-component-reuse.json", verify)

        restore = self.step_block(workflow, "Restore verified kernel component")
        self.assertNotIn("restore-keys:", restore)
        self.assertIn("steps.component-fingerprints.outputs.kernel", restore)
        return workflow

    def test_creator_payload_reuses_only_verified_kernel_bytes(self):
        workflow = self.assert_verified_kernel_reuse(CREATOR_PAYLOAD)
        for step in (
            "Assemble and verify canonical complete Creator payload",
            "Assert canonical payload is complete and non-destructive",
            "Prove complete payload crosses only non-destructive Creator gates",
        ):
            block = self.step_block(workflow, step)
            self.assertNotIn("cache-hit", block)

    def test_owner_dev_creator_reuses_kernel_without_skipping_product_build(self):
        workflow = self.assert_verified_kernel_reuse(OWNER_DEV)
        dev_base = self.step_block(workflow, "Build boot initramfs and Git development base")
        self.assertNotIn("bootstrap/kernel/build.py", dev_base)
        self.assertNotIn("cache-hit", dev_base)
        self.assertIn(
            '--kernel-modules "out/kernel/kernel-modules-$ORDAX_KERNEL_VERSION.tar"',
            dev_base,
        )
        self.assertIn('--seed-from-local "$GITHUB_WORKSPACE" "$GITHUB_SHA"', dev_base)
        self.assertIn('test -z "$(git -C "$rootfs/workspace/ordax" status --porcelain)"', dev_base)
        self.assertIn('test "$(cat "$rootfs/state/ordax/current-commit")" = "$GITHUB_SHA"', dev_base)
        self.assertNotIn('git clone https://github.com/ordaxsystems/ordax-os.git', dev_base)
        for step in (
            "Derive development Git bootstrap manifest",
            "Assemble boot payload and overlay Git development base",
            "Materialize and verify RAW development seed",
            "Build split Windows Creator bundle",
            "Verify exact Owner Development ZIP before publication",
        ):
            block = self.step_block(workflow, step)
            self.assertNotIn("cache-hit", block)

    def test_dev_base_channel_skips_helper_only_publication_and_reuses_kernel(self):
        workflow = self.assert_verified_kernel_reuse(DEV_BASE_CHANNEL)
        detector = self.step_block(workflow, "Detect Base-byte changes")
        for helper in (
            "bootstrap/dev-base/ordax-dev-init",
            "bootstrap/dev-base/ordax-network",
            "bootstrap/dev-base/ordax-pull",
            "bootstrap/dev-base/ordax-run",
            "bootstrap/dev-base/ordax-rollback",
            "bootstrap/dev-base/ordax-diagnose",
            "bootstrap/recovery/entrypoint",
        ):
            self.assertIn(helper, detector)
        self.assertNotIn(".github/workflows/dev-base-channel.yml", detector)
        build = self.step_block(workflow, "Build exact-commit development Base and initramfs")
        self.assertNotIn("bootstrap/kernel/build.py", build)
        self.assertIn("bootstrap/initramfs/build.py build --jobs 4", build)

    def test_owner_dev_diagnose_is_dev_base_only_and_reuses_kernel(self):
        workflow = self.assert_verified_kernel_reuse(OWNER_DEV_DIAGNOSE)
        trigger = workflow.split("permissions:", 1)[0]
        self.assertNotIn("      - 'bootstrap/dev-base/**'", trigger)
        for path in (
            "bootstrap/base/alpine_core.py",
            "bootstrap/base/firmware_policy.py",
            "bootstrap/base/runtime_policy.py",
            "bootstrap/dev-base/build.py",
        ):
            self.assertIn(f"      - '{path}'", trigger)
        self.assertNotIn("Build and verify boot ESP", workflow)
        self.assertNotIn("Build and verify initramfs", workflow)
        dev_base = self.step_block(workflow, "Build and verify Git development base")
        self.assertNotIn("bootstrap/kernel/build.py", dev_base)
        self.assertNotIn("bootstrap/initramfs/build.py", dev_base)

    def test_owner_dev_publication_remains_main_only(self):
        workflow = self.workflow(OWNER_DEV)
        trigger = workflow.split("permissions:", 1)[0]
        self.assertIn("  push:\n    branches: [main]", trigger)
        self.assertNotIn("  pull_request:", trigger)
        publish = self.step_block(workflow, "Publish development Creator bundle")
        self.assertIn("gh release upload creator-owner-prototype", publish)


if __name__ == "__main__":
    unittest.main()
