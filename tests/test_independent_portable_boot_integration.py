"""Phase 2 adapter regression: reuse the canonical portable boot implementation."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "bootstrap/independent-base"
PORTABLE = ROOT / "bootstrap/portable-v2"
INITRAMFS = ROOT / "bootstrap/initramfs"


class IndependentPortableBootIntegrationTest(unittest.TestCase):
    def test_canonical_pid1_mount_and_signed_selection_are_not_forked(self):
        script = (BASE / "portable_boot_proof.py").read_text()
        for marker in (
            'bootstrap/initramfs/portable_init.sh',
            'bootstrap/initramfs/portable_base_verify.sh',
            'bootstrap/portable-v2/qemu_boot.py',
            '--portable-bootstrap-capsule',
            '--portable-stable-base',
            '--previous-commit',
            'physical_usb_boot_proven',
            'armed_candidate_one_shot_proven',
        ):
            self.assertIn(marker, script)
        self.assertIn('/sbin/ordax-portable-state select-boot',
                      (INITRAMFS / "portable_init.sh").read_text())
        self.assertIn('/sbin/ordax-portable-mount mount-base',
                      (INITRAMFS / "portable_init.sh").read_text())
        self.assertIn('sha256sum -c',
                      (INITRAMFS / "portable_base_verify.sh").read_text())
        self.assertTrue((PORTABLE / "qemu_boot.py").is_file())

    def test_builder_embeds_exact_existing_handoff_with_integrity_receipt(self):
        post = (BASE / "post-build.sh").read_text()
        self.assertIn('cp "$ROOT/bootstrap/stable-base/ordax-stable-init"', post)
        self.assertIn('"$TARGET_DIR/sbin/ordax-stable-init"', post)
        build = (BASE / "build.py").read_text()
        self.assertIn('digest(target / "sbin/ordax-stable-init") != digest(CANONICAL_HANDOFF)', build)
        self.assertIn('"canonical_portable_handoff_sha256": digest(CANONICAL_HANDOFF)', build)
        self.assertIn('report.get("canonical_portable_handoff_sha256") != digest(CANONICAL_HANDOFF)', build)
        self.assertIn('sbin/modprobe', build)
        self.assertTrue((ROOT / "bootstrap/stable-base/ordax-stable-init").is_file())

    def test_busybox_fragment_is_single_reproducible_source_for_handoff_applets(self):
        profile = (BASE / "configs/ordax_minimal_defconfig").read_text()
        fragment = BASE / "configs/portable-handoff.busybox.fragment"
        self.assertEqual(profile.count("BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES="), 1)
        self.assertIn('BR2_PACKAGE_BUSYBOX_CONFIG_FRAGMENT_FILES="$(BR2_EXTERNAL_ORDAX_MINIMAL_PATH)/configs/portable-handoff.busybox.fragment"', profile)
        required = [
            "CONFIG_STAT=y", "CONFIG_FEATURE_STAT_FORMAT=y", "CONFIG_TIMEOUT=y",
            "CONFIG_DATE=y", "CONFIG_MV=y", "CONFIG_READLINK=y",
            "CONFIG_SHA256SUM=y", "CONFIG_OD=y", "CONFIG_TR=y", "CONFIG_SLEEP=y",
            "CONFIG_SED=y", "CONFIG_HEAD=y", "CONFIG_CUT=y",
            "CONFIG_RM=y", "CONFIG_TOUCH=y", "CONFIG_NSLOOKUP=y",
            "CONFIG_WGET=y", "CONFIG_FEATURE_WGET_TIMEOUT=y",
        ]
        configured = [line for line in fragment.read_text().splitlines()
                      if line.startswith("CONFIG_")]
        self.assertEqual(configured, required)
        self.assertEqual(len(configured), len(set(configured)))
        build = (BASE / "build.py").read_text()
        self.assertIn("BUSYBOX_HANDOFF_SYMBOLS =", build)
        self.assertIn('run(busybox, "stat", "-c", "%a", str(marker))', build)
        self.assertIn('run(busybox, "timeout", "-k", "1", "2", busybox, "true")', build)
        self.assertIn('"busybox_handoff_config_sha256": digest(BUSYBOX_FRAGMENT)', build)
        self.assertIn('"busybox_handoff_runtime_features_verified": True', build)

    def test_official_qemu_workflow_single_source_and_stable_default(self):
        official = (ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml").read_text()
        experimental = (ROOT / ".github/workflows/independent-portable-v2-integration.yml").read_text()
        self.assertIn("workflow_call:", official)
        self.assertIn("default: stable", official)
        self.assertIn('ORDAX_BASE_PROOF_SOURCE:', official)
        self.assertIn('case "$ORDAX_BASE_PROOF_SOURCE" in', official)
        self.assertIn('stable)', official)
        self.assertIn('independent)', official)
        self.assertIn('bootstrap/stable-base/build.py build', official)
        self.assertIn('bootstrap/independent-base/build.py build', official)
        producer = (ROOT / ".github/workflows/independent-base-experiment.yml").read_text()
        self.assertIn("uses: ./.github/workflows/portable-v2-qemu-boot-proof.yml",
                      producer)
        self.assertIn("base_source: independent", producer)
        self.assertIn("shared_inputs: true", producer)
        self.assertIn("canonical-portable-boundary:", experimental)
        self.assertNotIn("independent-real-portable-qemu:", experimental)
        # Both real QEMU scenarios must actually invoke the bridge in CI,
        # not only inspect its Python source through contract tests.
        self.assertEqual(official.count("proof_runner=bootstrap/independent-base/portable_boot_proof.py"), 2)
        self.assertEqual(official.count('sudo -E python3 "$proof_runner"'), 2)
        self.assertIn("ORDAX_INDEPENDENT_PORTABLE_BRIDGE=EXECUTING", official)
        adapter = (BASE / "portable_boot_proof.py").read_text()
        self.assertIn('"--out", str(qemu_result)', adapter)
        self.assertIn('command(argv)  # official portable PID1 QEMU harness', adapter)
        self.assertIn('"--initramfs", str(initramfs_out / "initramfs.cpio.gz")', adapter)
        self.assertIn('check_builder_environment=False', adapter)
        self.assertIn('verify_binding(', adapter)
        self.assertIn('immutable_reuse_binding_verified', adapter)
        real = (BASE / "healthy_services_proof.py").read_text()
        self.assertIn("bootstrap/portable-v2/qemu_cold_health_commit.py", real)
        self.assertIn('result.get("cold_health_commit_proven") is not True', real)
        self.assertIn('result.get("physical_usb_boot_proven") is not False', real)


        self.assertNotIn("rdinit=/sbin/ordax-independent-probe-init", experimental)

    def test_signed_release_fault_qemu_is_real_and_separate_from_product_boot(self):
        official = (ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml").read_text()
        fault = (BASE / "signed_release_failure_qemu.py").read_text()
        self.assertIn("name: Prove invalid Ed25519 candidate, durable rollback and read-only rescue in QEMU", official)
        self.assertIn("if: ${{ inputs.base_source == 'independent' }}", official)
        self.assertIn("sudo -E python3 bootstrap/independent-base/signed_release_failure_qemu.py", official)
        self.assertIn("qemu-signed-fault-proof/proof.json", official)
        self.assertIn("import qemu_boot as qemu", fault)
        self.assertIn("qemu.stage_disk(args, inputs, work)", fault)
        self.assertIn('decoded[0] ^= 0x01', fault)
        self.assertEqual(fault.count("qemu.boot_qemu_expected("), 2)
        self.assertIn("qemu.inspect_one_shot_state(", fault)
        self.assertIn("ordax.mode=recovery", fault)
        self.assertIn("no candidate/current/known-good release is safely selectable", fault)
        self.assertIn("before != after", fault)
        self.assertIn('"physical_promotion_authorized": False', fault)
        self.assertIn("disk.unlink()", fault)

    def test_fail_closed_with_invalid_commit_and_missing_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate = Path(tmp) / "new-base"
            candidate.mkdir()
            cmd = [
                sys.executable, str(BASE / "portable_boot_proof.py"),
                "--base-out", str(candidate),
                "--kernel", str(Path(tmp) / "missing-vmlinuz"),
                "--capsule", str(Path(tmp) / "missing-capsule"),
                "--state-image", str(Path(tmp) / "missing-ext4"),
                "--portable-root", str(Path(tmp) / "missing-root"),
                "--trust", str(Path(tmp) / "missing-trust"),
                "--source-commit", "invalid",
                "--output-dir", str(Path(tmp) / "result"),
            ]
            first = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
            self.assertNotEqual(first.returncode, 0)
            self.assertIn("ERROR", first.stderr)
            self.assertFalse((Path(tmp) / "result").exists())
            cmd[cmd.index("invalid")] = "a" * 40
            second = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
            self.assertNotEqual(second.returncode, 0)
            self.assertIn("ERROR", second.stderr)
            self.assertFalse((Path(tmp) / "result").exists())

    def test_canonical_contract_and_physical_gate(self):
        source = json.loads((BASE / "source.json").read_text())
        self.assertFalse(source["physical_artifact_authorized"])
        self.assertFalse(source["stable_channel_authorized"])
        self.assertEqual(source["erofs_format_contract"],
                         "docs/contracts/portable-boot-handoff.json")
        spec = (BASE / "portable_boot_proof.py").read_text()
        self.assertIn('outside_source(args.output_dir)', spec)
        self.assertIn('if str(p).startswith("/dev/"):', spec)
        self.assertIn('physical_promotion_authorized": False', spec)


if __name__ == "__main__":
    unittest.main()
