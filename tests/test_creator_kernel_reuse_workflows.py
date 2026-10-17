from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CREATOR_PAYLOAD = ROOT / ".github/workflows/creator-payload-candidate.yml"
OWNER_DEV = ROOT / ".github/workflows/creator-owner-dev-git.yml"
DEV_BASE_CHANNEL = ROOT / ".github/workflows/dev-base-channel.yml"
OWNER_DEV_DIAGNOSE = ROOT / ".github/workflows/creator-owner-build-diagnose.yml"
CACHE_SHA = "55cc8345863c7cc4c66a329aec7e433d2d1c52a9"
DOWNLOAD_ARTIFACT_SHA = "9000827ccba6bdab643e8b6fd33ac0654aef8333"


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

    def test_owner_dev_creator_uses_independent_owner_rootfs(self):
        workflow = self.assert_verified_kernel_reuse(OWNER_DEV)
        self.assertNotIn("bootstrap/dev-base/build.py", workflow)
        self.assertNotIn("alpine-minirootfs", workflow)
        self.assertNotIn("proot", workflow.lower())

        dev_base = self.step_block(
            workflow, "Build boot initramfs and Owner Independent Base"
        )
        self.assertNotIn("bootstrap/kernel/build.py", dev_base)
        self.assertNotIn("cache-hit", dev_base)
        self.assertIn("bootstrap/independent-base/build.py build", dev_base)
        self.assertIn("--profile owner-development", dev_base)
        self.assertIn("prove_independent_rootfs.py", dev_base)
        self.assertIn("independent_rootfs.py materialize", dev_base)
        self.assertIn(
            'ORDAX_KERNEL_MODULES_ARCHIVE="$PWD/out/kernel/kernel-modules-$ORDAX_KERNEL_VERSION.tar"',
            dev_base,
        )
        self.assertIn('--seed-from-local "$GITHUB_WORKSPACE" "$ORDAX_SOURCE_COMMIT"', dev_base)
        self.assertIn('test -z "$(git -C "$rootfs/workspace/ordax" status --porcelain)"', dev_base)
        self.assertIn('test "$(cat "$rootfs/state/ordax/current-commit")" = "$ORDAX_SOURCE_COMMIT"', dev_base)
        self.assertNotIn('git clone https://github.com/ordaxsystems/ordax-os.git', dev_base)

        assemble = self.step_block(
            workflow, "Assemble boot payload and overlay Git development base"
        )
        self.assertIn("cp -a out/dev-base/rootfs/.", assemble)
        self.assertNotIn("development seed may not contain symlinks", assemble)
        self.assertIn("$stage/ORDAX-ESP", assemble)

        media = self.step_block(workflow, "Materialize and verify RAW development seed")
        self.assertIn("ext4_symlinks_reverified_from_filesystem", media)
        self.assertIn("verified_symlink_count", media)

        for step in (
            "Derive development Git bootstrap manifest",
            "Assemble boot payload and overlay Git development base",
            "Materialize and verify RAW development seed",
            "Build split Windows Creator bundle",
            "Verify exact Owner Development ZIP before distribution",
        ):
            block = self.step_block(workflow, step)
            self.assertNotIn("cache-hit", block)

    def test_owner_dev_uses_exact_head_source_identity(self):
        workflow = self.workflow(OWNER_DEV)
        self.assertIn(
            "ORDAX_SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}",
            workflow,
        )
        self.assertNotIn("GITHUB_SHA", workflow)
        self.assertIn("os.environ['ORDAX_SOURCE_COMMIT']", workflow)
        self.assertIn("--source-commit \"$ORDAX_SOURCE_COMMIT\"", workflow)
        self.assertIn("--target \"$ORDAX_SOURCE_COMMIT\"", workflow)

    def test_owner_dev_branch_proof_is_read_only_and_publish_is_isolated(self):
        workflow = self.workflow(OWNER_DEV)
        trigger = workflow.split("permissions:", 1)[0]
        self.assertIn("  push:\n    branches: [main]", trigger)
        self.assertIn("  pull_request:\n", trigger)
        self.assertIn("  workflow_dispatch:\n", trigger)
        self.assertIn("permissions:\n  contents: read", workflow)

        build_section, publish_job = workflow.split("\n  publish:\n", 1)
        self.assertNotIn("contents: write", build_section)
        self.assertIn("needs: build-and-prove", publish_job)
        self.assertIn(
            "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
            publish_job,
        )
        self.assertIn("permissions:\n      contents: write", publish_job)
        self.assertIn(
            f"actions/download-artifact@{DOWNLOAD_ARTIFACT_SHA}",
            publish_job,
        )
        self.assertIn("Reverify exact bundle before mutable release publication", publish_job)

        proof = self.step_block(
            workflow, "Upload verified Owner Development proof bundle"
        )
        self.assertNotIn("\n        if:", proof)
        self.assertIn("actions/upload-artifact@", proof)
        self.assertIn("OrdaX-Creator-Owner-Prototype.zip", proof)
        self.assertIn("env.ORDAX_SOURCE_COMMIT", proof)

        publish = self.step_block(workflow, "Publish development Creator bundle")
        self.assertIn("gh release upload creator-owner-prototype", publish)
        self.assertIn("--source-commit \"$ORDAX_SOURCE_COMMIT\"", publish)

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

    def test_owner_dev_diagnose_uses_independent_owner_rootfs_and_reuses_kernel(self):
        workflow = self.assert_verified_kernel_reuse(OWNER_DEV_DIAGNOSE)
        trigger = workflow.split("permissions:", 1)[0]
        for legacy in (
            "bootstrap/base/alpine_core.py",
            "bootstrap/base/runtime_policy.py",
            "bootstrap/dev-base/build.py",
        ):
            self.assertNotIn(legacy, trigger)
            self.assertNotIn(legacy, workflow)
        for path in (
            "bootstrap/base/firmware_policy.py",
            "bootstrap/base/kernel_module_payload.py",
            "bootstrap/independent-base/**",
            "system/services/base-update/dev_channel.py",
            "tools/dev-base-channel/**",
        ):
            self.assertIn(f"      - '{path}'", trigger)

        self.assertNotIn("proot", workflow.lower())
        self.assertNotIn("alpine-minirootfs", workflow)
        build = self.step_block(workflow, "Build and verify Owner Independent Base")
        self.assertNotIn("bootstrap/kernel/build.py", build)
        self.assertIn("bootstrap/independent-base/build.py build", build)
        self.assertIn("--profile owner-development", build)
        self.assertIn("prove_independent_rootfs.py", build)
        self.assertIn("independent_rootfs.py materialize", build)
        self.assertIn('assert provenance["physical_artifact_authorized"] is False', build)
        self.assertIn('assert provenance["signed_release_equivalence_proven"] is False', build)


if __name__ == "__main__":
    unittest.main()
