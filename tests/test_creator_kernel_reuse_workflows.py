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
        # Kernel identity must be single and exact; unrelated Buildroot compiler
        # and source-download caches may coexist on the Owner USB workflow.
        self.assertEqual(workflow.count("      - name: Restore verified kernel component\n"), 1)
        self.assertEqual(workflow.count("      - name: Save verified kernel component\n"), 1)
        kernel_restore = self.step_block(workflow, "Restore verified kernel component")
        kernel_save = self.step_block(workflow, "Save verified kernel component")
        self.assertEqual(kernel_restore.count(f"actions/cache/restore@{CACHE_SHA}"), 1)
        self.assertEqual(kernel_save.count(f"actions/cache/save@{CACHE_SHA}"), 1)
        self.assertNotIn("restore-keys:", kernel_restore)
        for block in (kernel_restore, kernel_save):
            self.assertIn("steps.component-fingerprints.outputs.kernel", block)
            self.assertIn("ordax-portable-component-v1-", block)
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
            "Prove exact independent Creator CLI stages only a disposable tree",
        ):
            block = self.step_block(workflow, step)
            self.assertNotIn("cache-hit", block)
        external_verification = self.step_block(
            workflow, "Prove exact independent Creator CLI stages only a disposable tree"
        )
        self.assertIn("PAYLOAD_VERIFIED=YES", external_verification)
        self.assertIn("DISPOSABLE_TREE_STAGED=YES", external_verification)
        self.assertIn("PHYSICAL_WRITE_STATUS=blocked", external_verification)
        self.assertIn("creator-payload-cli/ordax-creator", external_verification)
        self.assertNotIn("go run ./cmd/ordax-creator", external_verification)

    def test_owner_dev_cold_boot_proof_survives_pr_revisions(self):
        workflow = self.workflow(OWNER_DEV)
        group = workflow.split("concurrency:", 1)[1].split("jobs:", 1)[0]
        self.assertIn("group: creator-owner-dev-git-${{ github.ref }}", group)
        self.assertIn("cancel-in-progress: false", group)
        self.assertNotIn("cancel-in-progress: ${{ github.event_name", group)
        # The expensive workflow still binds to the exact PR source commit;
        # concurrency affects execution lifetime, not provenance authority.
        self.assertIn(
            "ORDAX_OWNER_SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}",
            workflow,
        )

    def test_owner_dev_creator_reuses_kernel_without_skipping_product_build(self):
        workflow = self.assert_verified_kernel_reuse(OWNER_DEV)
        dev_base = self.step_block(workflow, "Build boot initramfs and Git development base")
        self.assertNotIn("bootstrap/kernel/build.py", dev_base)
        # Kernel is reusable independently; the Owner rootfs may now also be
        # reused, but the Git seed and offline QEMU proof are never skipped.
        self.assertIn("steps.owner-base-cache.outputs.cache-hit", dev_base)
        self.assertIn("portable_component_cache.py verify", dev_base)
        self.assertIn("--component independent-base-owner", dev_base)
        self.assertIn("owner-base-component-reuse.json", dev_base)
        owner_restore = self.step_block(workflow, "Restore verified Owner Buildroot base")
        owner_save = self.step_block(workflow, "Save verified Owner Buildroot for reuse")
        for block in (owner_restore, owner_save):
            self.assertIn("steps.component-fingerprints.outputs.independent_base_owner", block)
            self.assertIn("independent-base-owner-", block)
        self.assertNotIn("restore-keys:", owner_restore)
        self.assertIn(
            'ORDAX_KERNEL_MODULES_ARCHIVE="$PWD/out/kernel/kernel-modules-$ORDAX_KERNEL_VERSION.tar"',
            dev_base,
        )
        self.assertIn('--seed-from-local "$GITHUB_WORKSPACE" "$ORDAX_OWNER_SOURCE_COMMIT"', dev_base)
        self.assertIn('test -z "$(sudo git -C "$rootfs/workspace/ordax" status --porcelain)"', dev_base)
        self.assertIn('test "$(sudo cat "$rootfs/state/ordax/current-commit")" = "$ORDAX_OWNER_SOURCE_COMMIT"', dev_base)
        self.assertIn("ORDAX_OWNER_SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}", workflow)
        self.assertIn('ref: ${{ github.event.pull_request.head.sha || github.sha }}', workflow)
        self.assertIn('test "$(sudo git -C "$rootfs/workspace/ordax" rev-parse HEAD)" = "$ORDAX_OWNER_SOURCE_COMMIT"', dev_base)
        self.assertIn('"$target_bytes"', self.step_block(workflow, "Materialize and verify RAW development seed"))
        self.assertIn('seed_bytes="$(stat -c \'%s\' "$proof/ordax-disposable.raw")"', workflow)
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
        # Owner mountattr is compiled with the pinned kernel UAPI exported
        # by the initramfs builder, never system /usr/include headers.
        # The canonical initramfs exports kernel UAPI before the single
        # Independent Base Owner builder consumes the verified modules.
        self.assertLess(
            build.index("python bootstrap/initramfs/build.py build --jobs 4"),
            build.index("python3 bootstrap/independent-base/build.py build"),
        )
        self.assertLess(
            build.index("python bootstrap/initramfs/build.py verify"),
            build.index("python3 bootstrap/independent-base/build.py build"),
        )
        self.assertNotIn("python bootstrap/dev-base/build.py", build)
        self.assertIn('--profile owner-development', build)
        self.assertIn('ORDAX_KERNEL_MODULES_ARCHIVE', build)
        self.assertIn(
            "test -f out/initramfs-work/kernel-uapi-install/include/linux/mount.h",
            build,
        )
        self.assertIn("owner_validation_pr", workflow)
        self.assertIn("DEV_BASE_OWNER_VALIDATION_EXACT_HEAD=PASS", detector)
        self.assertIn("github.actor == 'ordaxos-admin'", workflow)

    def test_retired_diagnose_cannot_build_and_live_owners_use_canonical_kernel_uapi(self):
        # A removed diagnostic is not a competing kernel/build authority.
        self.assertFalse(OWNER_DEV_DIAGNOSE.exists())
        owner = self.assert_verified_kernel_reuse(OWNER_DEV)
        channel = self.assert_verified_kernel_reuse(DEV_BASE_CHANNEL)
        owner_build = self.step_block(owner, "Build boot initramfs and Git development base")
        channel_build = self.step_block(channel, "Build exact-commit development Base and initramfs")
        for build in (owner_build, channel_build):
            self.assertIn("python bootstrap/initramfs/build.py build --jobs 4", build)
            self.assertIn("python bootstrap/initramfs/build.py verify", build)
            self.assertIn("bootstrap/independent-base/build.py build", build)
            self.assertIn("--profile owner-development", build)
            self.assertNotIn("bootstrap/dev-base/build.py", build)
            # Comments documenting forbidden legacy paths are not shell invocations.
            executable_lines = "\n".join(
                line for line in build.lower().splitlines()
                if line.strip() and not line.lstrip().startswith("#")
            )
            self.assertNotIn("proot", executable_lines)
            self.assertLess(
                build.index("python bootstrap/initramfs/build.py verify"),
                build.index("bootstrap/independent-base/build.py build"),
            )
        self.assertIn(
            'ORDAX_KERNEL_MODULES_ARCHIVE="$PWD/out/kernel/kernel-modules-$ORDAX_KERNEL_VERSION.tar"',
            owner_build,
        )
        self.assertIn(
            "test -f out/initramfs-work/kernel-uapi-install/include/linux/mount.h",
            channel_build,
        )

    def test_three_owner_consumers_share_one_immutable_cache_identity(self):
        independent = self.workflow(ROOT / ".github/workflows/independent-base-experiment.yml")
        cases = (
            (self.workflow(OWNER_DEV), "Restore verified Owner Buildroot base", "Save verified Owner Buildroot for reuse"),
            (independent, "Restore verified Owner Buildroot component", "Save verified Owner Buildroot component"),
            (self.workflow(DEV_BASE_CHANNEL), "Restore verified Owner Buildroot for Development Base", "Save verified Owner Buildroot for other consumers"),
        )
        exact_key = (
            "independent-base-owner-${{ steps.component-fingerprints.outputs.independent_base_owner }}"
        )
        for workflow, restore_name, save_name in cases:
            with self.subTest(restore=restore_name):
                restore = self.step_block(workflow, restore_name)
                save = self.step_block(workflow, save_name)
                for block in (restore, save):
                    self.assertIn(exact_key, block)
                self.assertNotIn("restore-keys:", restore)
                self.assertIn("--component independent-base-owner", workflow)
                self.assertIn("--cache-hit", workflow)
                self.assertIn("--reuse-receipt", workflow)
        channel = cases[2][0]
        self.assertIn("--owner-reuse-receipt", channel)
        self.assertIn("ORDAX_OWNER_BASE_CACHE_HIT=", channel)
        # A verified hit skips Buildroot, not signing, offline boot or rollback.
        self.assertIn("Prove actual Owner USB offline handoff in QEMU", cases[0][0])

    def test_review_candidate_is_byte_verified_pr_only_not_a_release(self):
        workflow = self.workflow(OWNER_DEV)
        verify = workflow.index("      - name: Verify exact Owner Development ZIP before publication")
        key_cleanup = workflow.index("      - name: Destroy ephemeral private key before publish")
        retain = workflow.index("      - name: Retain exact-commit verified USB Dev acceptance bundle")
        publish = workflow.index("      - name: Publish development Creator bundle")
        self.assertLess(verify, key_cleanup)
        self.assertLess(key_cleanup, retain)
        self.assertLess(retain, publish)

        artifact = self.step_block(
            workflow, "Retain exact-commit verified USB Dev acceptance bundle"
        )
        self.assertIn(
            "if: (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == 'ordaxsystems/ordax-os')",
            artifact,
        )
        self.assertIn(
            "name: owner-dev-usb-candidate-${{ env.ORDAX_OWNER_SOURCE_COMMIT }}",
            artifact,
        )
        self.assertIn(
            "(github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main')",
            artifact,
        )
        # A dispatch on a feature branch retains test bytes but may not publish.
        self.assertIn(
            "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
            self.step_block(workflow, "Publish development Creator bundle"),
        )
        self.assertIn("out/owner-prototype/release/OrdaX-Creator-Owner-Prototype.zip", artifact)
        self.assertIn("out/owner-prototype/release/SHA256SUMS.txt", artifact)
        self.assertIn("out/owner-prototype/release/creator-owner-update.json", artifact)
        self.assertIn("if-no-files-found: error", artifact)
        self.assertNotIn("gh release", artifact)
        self.assertNotIn("private.pem", artifact)
        self.assertNotIn("ordax-bootstrap-seed.raw", artifact)

    def test_owner_dev_publication_remains_main_only(self):
        workflow = self.workflow(OWNER_DEV)
        trigger = workflow.split("permissions:", 1)[0]
        self.assertIn("  push:\n    branches: [main]", trigger)
        # Non-publishing PRs can prove the actual Owner USB payload. Promotion
        # remains restricted to an exact push of main, never a PR or dispatch.
        self.assertIn("  pull_request:", trigger)
        publish = self.step_block(workflow, "Publish development Creator bundle")
        self.assertIn(
            "if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
            publish,
        )
        self.assertIn("gh release upload creator-owner-prototype", publish)
        self.assertEqual(workflow.count("gh release upload creator-owner-prototype"), 1)


if __name__ == "__main__":
    unittest.main()
