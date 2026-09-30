#!/usr/bin/env python3
"""Regress the portable-v2 direct-kernel QEMU proof boundary."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(
    (ROOT / "docs/contracts/portable-v2-qemu-boot-proof.json").read_text(
        encoding="utf-8"
    )
)
SCRIPT = ROOT / "bootstrap/portable-v2/qemu_boot.py"
INITRAMFS_BUILD = ROOT / "bootstrap/initramfs/build.py"
INITRAMFS_SOURCE = ROOT / "bootstrap/initramfs/source.json"
WORKFLOW = (
    ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml"
).read_text(encoding="utf-8")


class PortableV2QEMUBootProofTests(unittest.TestCase):
    def test_contract_records_direct_kernel_proof_without_overclaiming_physical_boot(self):
        self.assertEqual(
            CONTRACT["$schema"],
            "prototype-ordax.portable-v2-qemu-boot-proof/1",
        )
        self.assertEqual(CONTRACT["boot_mode"], "direct-kernel-candidate-only")
        self.assertFalse(CONTRACT["uefi_boot_proven"])
        self.assertTrue(CONTRACT["qemu_direct_kernel_boot_proven"])
        self.assertFalse(CONTRACT["physical_boot_proven"])
        self.assertFalse(CONTRACT["physical_write_authorized"])
        self.assertFalse(CONTRACT["physical_target_device_touched"])
        self.assertEqual(CONTRACT["last_proven_source_commit"], "b9e1b164d7510f2dfc7572e473642b8fb885fa8c")
        self.assertEqual(CONTRACT["proof_artifact_sha256"], "0f5b922cb3f24c1c339e7c0c5f4abe9d9b72322ee1da527aee6f54fc65fc730c")
        self.assertEqual(
            CONTRACT["last_proven_surface_runtime_sha256"],
            "5b44729139777b610c300864d6f41c0580a3d6ca0b694b8dc53e38f505f99236",
        )
        self.assertFalse(CONTRACT["last_proven_network_required_for_first_boot"])
        self.assertFalse(CONTRACT["last_proven_physical_target_device_touched"])
        self.assertFalse(CONTRACT["last_proven_guest_disk_retained"])
        self.assertEqual(CONTRACT["activation_transaction_scope"], "baseline-current-boot-only")
        self.assertFalse(CONTRACT["armed_candidate_one_shot_proven"])
        self.assertIn("unarmed-candidate-is-not-boot-authority", CONTRACT["required_checks"])
        self.assertFalse(CONTRACT["promotion_effect"]["uefi_gate_still_required"])
        self.assertTrue(
            CONTRACT["promotion_effect"]["uefi_gate_satisfied_by_separate_contract"]
        )

    def test_harness_uses_final_two_partition_layout_and_candidate_rdinit(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("--change-name=1:ORDAX-ESP", text)
        self.assertIn("--change-name=2:ORDAX-DATA", text)
        self.assertIn("rdinit=/sbin/ordax-portable-init", text)
        self.assertIn("if=ide,index=0", text)
        self.assertNotIn("if=virtio", text)
        self.assertIn('"system.erofs"', text)
        self.assertIn('"base/stable-base.erofs"', text)
        self.assertIn('"state/persistent-state.img"', text)
        self.assertIn('"ordax/bootstrap/trust/release-ed25519.json"', text)
        self.assertIn('"surface-runtime.sha256"', text)
        self.assertIn('"runtimes"', text)
        self.assertIn('"native-surface-runtime.erofs"', text)
        self.assertIn('"local-ai-runtime.sha256"', text)
        self.assertIn('"ai-runtimes"', text)
        self.assertIn('"local-ai-runtime.erofs"', text)

    def test_loop_partition_wait_requires_stable_identity_before_formatting(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("stable_for: float = 0.75", text)
        self.assertIn("stable_rdev != info.st_rdev", text)
        self.assertIn("stat.S_ISBLK(info.st_mode)", text)
        self.assertIn("loop partition did not become stable", text)

        stage = text.split("def stage_disk", 1)[1].split("def boot_qemu_expected", 1)[0]
        self.assertGreaterEqual(stage.count("wait_block(esp)"), 2)
        self.assertGreaterEqual(stage.count("wait_block(data)"), 2)
        self.assertLess(
            stage.rindex("wait_block(esp)"),
            stage.index('run(["mkfs.vfat"'),
        )
        self.assertLess(
            stage.rindex("wait_block(data)"),
            stage.index('run(["mkfs.exfat"'),
        )

    def test_harness_requires_both_handoff_markers_and_disables_network(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("ORDAX_PORTABLE_V2_HANDOFF=VERIFIED", text)
        self.assertIn("ORDAX_STABLE_INIT_HANDOFF=VERIFIED", text)
        self.assertIn('"ORDAX_PORTABLE_V2_SLOT=" + expected_slot', text)
        self.assertIn('expected_slot="candidate"', text)
        self.assertIn('expected_slot="current"', text)
        self.assertIn("ORDAX_PORTABLE_V2_SOURCE_SHA=", text)
        self.assertIn("ORDAX_STABLE_INIT_SOURCE_SHA=", text)
        self.assertIn("ORDAX_PORTABLE_RELEASE_MANIFEST_SCHEMA=", text)
        self.assertIn("prototype-ordax.release-manifest/4", text)
        self.assertIn("ORDAX_SURFACE_RUNTIME_HANDOFF=VERIFIED", text)
        self.assertIn("ORDAX_SURFACE_RUNTIME_SHA256=", text)
        self.assertIn("ORDAX_LOCAL_AI_RUNTIME_HANDOFF=VERIFIED", text)
        self.assertIn("ORDAX_LOCAL_AI_RUNTIME_SHA256=", text)
        self.assertIn("ORDAX_LOCAL_AI_BACKEND=STARTED", text)
        self.assertIn('"-net", "none"', text)
        self.assertIn('"qemu_direct_kernel_boot_proven": True', text)
        self.assertIn('"qemu_uefi_boot_proven": False', text)
        self.assertIn('"physical_usb_boot_proven": False', text)


    def test_runner_waits_for_durable_activation_state_before_terminating_guest(self):
        text = SCRIPT.read_text(encoding="utf-8")
        marker = "ORDAX_PORTABLE_ACTIVATION_STATE_DURABLE=YES"
        self.assertIn(marker, text)
        self.assertIn('"activation_state_durable_marker": ACTIVATION_DURABLE in text', text)
        boot = text.split("def boot_qemu_expected", 1)[1].split("def boot_qemu(", 1)[0]
        self.assertLess(
            boot.index('"activation_state_durable_marker": ACTIVATION_DURABLE in text'),
            boot.index("def finish_success"),
        )
        self.assertIn(
            'checks["activation_state_durable_marker"]',
            boot,
        )

        runner = CONTRACT["current_runner_invariants"]
        self.assertTrue(runner["activation_state_outer_sync_before_handoff"])
        self.assertEqual(runner["activation_state_durable_serial_marker"], marker)
        self.assertTrue(runner["qemu_termination_requires_durable_state_marker"])
        self.assertTrue(runner["applies_to_future_proof_runs"])
        self.assertFalse(runner["historical_last_proven_artifact_rewritten"])


    def test_runner_reobserves_exact_marker_predicate_once_at_deadline(self):
        text = SCRIPT.read_text(encoding="utf-8")
        boot = text.split("def boot_qemu_expected", 1)[1].split("def boot_qemu(", 1)[0]
        self.assertIn("def observe(text: str)", boot)
        self.assertIn("ready, checks = observe(text)", boot)
        self.assertIn("final_ready, final_checks = observe(final_text)", boot)
        self.assertIn("if final_ready:", boot)
        self.assertIn("return finish_success(final_text, final_checks)", boot)
        self.assertIn("missing_checks = sorted", boot)
        self.assertNotIn("time.sleep(1", boot)
        self.assertNotIn("deadline +=", boot)
        self.assertEqual(boot.count("210.0"), 1)
        final_observation = boot.split(
            "final_ready, final_checks = observe(final_text)",
            1,
        )[1]
        self.assertLess(
            final_observation.index("if final_ready:"),
            final_observation.index("raise ProofError("),
        )

    def test_initramfs_mount_understands_security_flags_before_vfat_handoff(self):
        build = INITRAMFS_BUILD.read_text(encoding="utf-8")
        source = json.loads(INITRAMFS_SOURCE.read_text(encoding="utf-8"))
        self.assertIn('"CONFIG_FEATURE_MOUNT_FLAGS": "y"', build)
        self.assertIn('"CONFIG_FEATURE_VOLUMEID_FAT": "y"', build)
        self.assertTrue(source["portable_v2_prerequisites"]["mount_security_flags"])
        self.assertEqual(
            source["portable_v2_prerequisites"]["mount_security_flags_busybox_selector"],
            "CONFIG_FEATURE_MOUNT_FLAGS=y",
        )


    def test_initramfs_has_posix_test_and_bracket_for_candidate_pid1(self):
        build = INITRAMFS_BUILD.read_text(encoding="utf-8")
        source = json.loads(INITRAMFS_SOURCE.read_text(encoding="utf-8"))
        for selector in (
            '"CONFIG_TEST": "y"',
            '"CONFIG_TEST1": "y"',
            '"CONFIG_FEATURE_TEST_64": "y"',
        ):
            self.assertIn(selector, build)
        self.assertIn('"test"', build)
        self.assertIn('"["', build)
        prereq = source["portable_v2_prerequisites"]
        self.assertTrue(prereq["posix_test_applet"])
        self.assertTrue(prereq["posix_bracket_applet"])
        self.assertTrue(prereq["test_64_bit_comparisons"])
        self.assertEqual(
            prereq["posix_test_busybox_selectors"],
            [
                "CONFIG_TEST=y",
                "CONFIG_TEST1=y",
                "CONFIG_FEATURE_TEST_64=y",
            ],
        )

    def test_local_ai_build_isolated_before_broad_qemu_dependencies(self):
        minimal = "Install bounded local AI build dependencies"
        ai = "Build and verify exact local AI runtime"
        broad = "Install remaining portable-v2 build and QEMU proof dependencies"
        kernel = "Build exact kernel and kernel modules"
        for marker in (minimal, ai, broad, kernel):
            self.assertIn(marker, WORKFLOW)
        self.assertLess(WORKFLOW.index(minimal), WORKFLOW.index(ai))
        self.assertLess(WORKFLOW.index(ai), WORKFLOW.index(broad))
        self.assertLess(WORKFLOW.index(broad), WORKFLOW.index(kernel))
        before_ai = WORKFLOW[: WORKFLOW.index(ai)]
        self.assertNotIn("libcap-dev", before_ai)
        self.assertNotIn("libmount-dev", before_ai)
        self.assertNotIn("libblkid-dev", before_ai)
        self.assertNotIn("liblzma-dev", before_ai)

    def test_workflow_builds_signed_release_real_base_capsule_and_pinned_initramfs(self):
        for marker in (
            "bootstrap/kernel/build.py build",
            "bootstrap/stable-base/build.py build",
            "bootstrap/portable-v2/capsule/build.py build",
            "tools/portable-release-image/build.py build",
            "bootstrap/surface-runtime/build.py build",
            "--manifest-schema 4",
            "--runtime-artifact",
            "--runtime-artifact-url",
            "--local-ai-artifact",
            "--local-ai-source-lock",
            "--local-ai-artifact-url",
            "verify-portable-v4-exact",
            "verify-portable-v3-exact",
            "release-signing",
            "--portable-bootstrap-capsule",
            "--portable-stable-base",
            "bootstrap/portable-v2/qemu_boot.py",
        ):
            self.assertIn(marker, WORKFLOW)
        direct = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("OVMF", direct)
        self.assertIn("Boot portable-v2 candidate PID1 in QEMU", WORKFLOW)
        self.assertIn("Build pinned systemd-boot for portable UEFI proof", WORKFLOW)
        self.assertIn("Boot same portable-v2 disk through OVMF and systemd-boot", WORKFLOW)
        self.assertIn("bootstrap/portable-v2/uefi_boot.py", WORKFLOW)
        self.assertNotIn("/dev/sd", WORKFLOW)
        self.assertNotIn("PhysicalDrive", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
