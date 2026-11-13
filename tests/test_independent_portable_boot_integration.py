"""Phase 2 adapter regression: reuse the canonical portable boot implementation."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

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
        self.assertEqual(
            [line for line in fragment.read_text().splitlines() if line.startswith("CONFIG_")],
            ["CONFIG_ACPID=y", "CONFIG_STAT=y", "CONFIG_FEATURE_STAT_FORMAT=y", "CONFIG_TIMEOUT=y", "CONFIG_FLOCK=y", "CONFIG_MKTEMP=y"],
        )
        build = (BASE / "build.py").read_text()
        self.assertIn("BUSYBOX_HANDOFF_SYMBOLS =", build)
        self.assertIn('run(busybox, "stat", "-c", "%a", str(marker))', build)
        self.assertIn('run(busybox, "timeout", "-k", "1", "2", busybox, "true")', build)
        self.assertIn('run(busybox, "flock", "-n", str(lock_path), busybox, "true")', build)
        self.assertIn('BusyBox flock granted a lock already owned by another process', build)
        self.assertIn('"busybox_handoff_config_sha256": digest(BUSYBOX_FRAGMENT)', build)
        self.assertIn('"busybox_handoff_runtime_features_verified": True', build)

    def test_official_qemu_workflow_is_buildroot_only_and_stable_mvp_is_explicit(self):
        official = (ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml").read_text()
        experimental = (ROOT / ".github/workflows/independent-portable-v2-integration.yml").read_text()
        self.assertIn("workflow_call:", official)
        self.assertIn("      base_source:\n        type: string\n        description: 'independent Buildroot candidate only (Stable signed proof must be explicitly requested)'\n        required: false\n        default: independent", official)
        self.assertIn('ORDAX_BASE_PROOF_SOURCE:', official)
        self.assertIn('case "$ORDAX_BASE_PROOF_SOURCE" in', official)
        self.assertNotIn('            stable)', official)
        self.assertIn('independent)', official)
        self.assertNotIn('bootstrap/stable-base/build.py', official)
        self.assertIn('bootstrap/independent-base/build.py build', official)
        self.assertIn('case "$ORDAX_BASE_PROOF_SOURCE" in independent) ;; *)', official)
        self.assertIn("(inputs.independent_base_profile || 'minimal') == 'stable-mvp'", official)
        self.assertIn("uses: ./.github/workflows/portable-v2-qemu-boot-proof.yml",
                      experimental)
        self.assertIn("base_source: independent", experimental)
        self.assertIn("independent_base_profile: ${{ github.event_name == 'push' && 'stable-mvp' || inputs.base_profile || 'minimal' }}", experimental)
        self.assertIn("- stable-mvp", experimental)
        self.assertIn("independent_base_profile:", official)
        self.assertIn("Stable/MVP portable proof requires explicit dispatch", official)
        self.assertIn("Require existing verified kernel for Stable/MVP proof", official)
        self.assertIn("Stable/MVP proof requires verified kernel cache", official)
        self.assertIn('--profile "$ORDAX_INDEPENDENT_BASE_PROFILE"', official)
        self.assertIn("ORDAX_FIRMWARE_COVERAGE_RECEIPT", official)
        experiment = (ROOT / ".github/workflows/independent-base-experiment.yml").read_text()
        self.assertIn('export ORDAX_KERNEL_MODULES_RECEIPT="$base_out/kernel-module-selection.json"', official)
        self.assertIn('"$receipt_root/kernel-module-selection.json"', experiment)
        self.assertIn('"$receipt_root/firmware-coverage.json"', experiment)
        self.assertEqual(official.count("--base-profile"), 2)
        self.assertEqual(official.count('--reuse-receipt "$work/metadata/independent-stable-component-reuse.json"'), 2)
        self.assertEqual(official.count('proof_extra+=(--kernel-modules "$work/kernel/kernel-modules-$ORDAX_KERNEL_VERSION.tar")'), 2)
        self.assertIn("verify_kernel_archive_binding(", (BASE / "portable_boot_proof.py").read_text())
        self.assertIn('"boot_kernel_modules_bound": kernel_binding is not None', (BASE / "portable_boot_proof.py").read_text())
        self.assertIn("Restore verified Stable Buildroot component for official signed boot", official)
        self.assertIn("Save verified Stable Buildroot component for signed Portable boot", official)
        producer = (ROOT / ".github/workflows/independent-base-experiment.yml").read_text()
        self.assertIn("Reuse canonical Buildroot sources and package downloads for Stable", official)
        self.assertIn("Save canonical Buildroot downloads after Stable cache miss", official)
        self.assertEqual(sum(line.strip() == 'path: ${{ runner.temp }}/ordax-independent-cache' for line in official.splitlines()), 2)
        self.assertEqual(sum(line.strip() == 'path: ${{ runner.temp }}/ordax-independent-cache' for line in producer.splitlines()), 2)
        self.assertIn('buildroot_cache="$RUNNER_TEMP/ordax-independent-cache"', official)
        self.assertIn('--cache "$buildroot_cache" --jobs 4', official)
        self.assertIn("steps.independent-buildroot-download-cache.outputs.cache-hit != 'true'", official)
        source_key = "key: ordax-buildroot-download-v1-${{ runner.os }}-${{ hashFiles('bootstrap/independent-base/source.json', 'bootstrap/independent-base/configs/**', 'bootstrap/independent-base/patches/**') }}"
        stable_key = "key: ordax-portable-component-v1-${{ runner.os }}-${{ runner.arch }}-independent-base-stable-${{ steps.component-fingerprints.outputs.independent_base_stable }}"
        for exact_key in (source_key, stable_key):
            self.assertEqual(sum(line.strip() == exact_key for line in official.splitlines()), 2)
            self.assertEqual(sum(line.strip() == exact_key for line in producer.splitlines()), 2)
        # Cache key AND archive path must match the independent Buildroot producer.
        cache_path = 'path: ${{ runner.temp }}/ordax-independent'
        self.assertEqual(sum(line.strip() == cache_path for line in official.splitlines()), 2)
        self.assertGreaterEqual(sum(line.strip() == cache_path for line in producer.splitlines()), 2)
        self.assertNotIn('path: ${{ runner.temp }}/portable-v2-qemu/independent-base', official)
        self.assertIn('base_out="$RUNNER_TEMP/ordax-independent"', official)
        self.assertIn('printf \'ORDAX_INDEPENDENT_BASE_OUT=%s\\n\' "$base_out" >> "$GITHUB_ENV"', official)
        self.assertEqual(official.count('--base-out "${ORDAX_INDEPENDENT_BASE_OUT:?}"'), 2)
        self.assertNotIn('--base-out "$work/independent-base"', official)
        self.assertIn("independent-base-stable-${{ steps.component-fingerprints.outputs.independent_base_stable }}", official)
        self.assertIn("--component independent-base-stable", official)
        self.assertIn("--receipt \"$work/metadata/independent-stable-component-reuse.json\"", official)
        self.assertIn('if [ "$ORDAX_INDEPENDENT_BASE_PROFILE" != stable-mvp ] || [ "$ORDAX_STABLE_BASE_CACHE_HIT" != true ]; then', official)
        # Caller may not elevate permissions required by the canonical
        # reusable workflow; without actions:read, startup creates no jobs.
        self.assertIn("permissions:\n  contents: read\n  actions: read", experimental)
        self.assertIn("    permissions:\n      contents: read\n      actions: read", experimental)
        # Both real QEMU scenarios must actually invoke the bridge in CI,
        # not only inspect its Python source through contract tests.
        self.assertEqual(official.count("proof_runner=bootstrap/independent-base/portable_boot_proof.py"), 2)
        self.assertEqual(official.count('sudo -E python3 "$proof_runner"'), 2)
        self.assertIn("ORDAX_INDEPENDENT_PORTABLE_BRIDGE=EXECUTING", official)
        adapter = (BASE / "portable_boot_proof.py").read_text()
        self.assertIn('INDEPENDENT_PORTABLE_PROFILE = "minimal"', adapter)
        self.assertIn('verify(base_dir, args.base_profile)', adapter)
        self.assertIn('INDEPENDENT_PORTABLE_PROFILES = ("minimal", "stable-mvp")', adapter)
        self.assertIn('if args.base_profile not in INDEPENDENT_PORTABLE_PROFILES:', adapter)
        self.assertIn('"base_profile": args.base_profile', adapter)
        self.assertIn('if args.base_profile == "stable-mvp" and args.reuse_receipt is None:', adapter)
        self.assertIn('cache.verify_component(', adapter)
        self.assertIn('provided != confirmed', adapter)
        self.assertIn('"base_cache_reuse_verified": stable_binding is not None', adapter)
        self.assertIn('"--out", str(qemu_result)', adapter)
        self.assertIn('command(argv)  # official portable PID1 QEMU harness', adapter)
        self.assertIn('"--initramfs", str(initramfs_out / "initramfs.cpio.gz")', adapter)

        self.assertNotIn("rdinit=/sbin/ordax-independent-probe-init", experimental)

    def test_stable_profile_is_explicit_without_automatic_pr_promotion(self):
        official = (ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml").read_text()
        experimental = (ROOT / ".github/workflows/independent-portable-v2-integration.yml").read_text()
        self.assertIn('if [ "$ORDAX_BASE_PROOF_SOURCE" != independent ] || {', official)
        self.assertIn('[ "$ORDAX_PROOF_EVENT" != workflow_dispatch ] && [ "$ORDAX_EXPLICIT_STABLE_SIGNED_BOOT" != true ]', official)
        self.assertIn("inputs.independent_base_profile != 'stable-mvp'", official)
        self.assertIn("ORDAX_STABLE_MVP_HARDWARE_RECEIPTS=VERIFIED", official)
        self.assertIn("default: minimal", experimental)
        signed_marker = "contains(github.event.head_commit.message, '[stable-mvp-signed-boot]')"
        self.assertEqual(experimental.count(signed_marker), 2)
        self.assertEqual(official.count(signed_marker), 1)
        self.assertIn("branches: ['integration/dev-usb-buildroot-surface-20261024']", experimental)
        self.assertIn("github.event_name == 'pull_request' && !github.event.pull_request.draft", experimental)
        self.assertIn("if: ${{ github.event_name != 'push' || (github.ref == 'refs/heads/integration/dev-usb-buildroot-surface-20261024'", experimental)
        self.assertIn("ORDAX_EXPLICIT_STABLE_SIGNED_BOOT:", official)
        self.assertNotIn("github.event_name == 'push' && 'minimal'", experimental)

    def test_r2_surface_restore_secrets_are_least_privilege_and_explicit(self):
        official = (ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml").read_text()
        caller = (ROOT / ".github/workflows/independent-portable-v2-integration.yml").read_text()
        self.assertIn("  workflow_call:\n    inputs:", official)
        self.assertIn("    secrets:\n      ORDAX_R2_ACCESS_KEY_ID:", official)
        self.assertIn("      ORDAX_R2_SECRET_ACCESS_KEY:\n        description:", official)
        self.assertIn("    secrets:\n      ORDAX_R2_ACCESS_KEY_ID: ${{ secrets.ORDAX_R2_ACCESS_KEY_ID }}", caller)
        self.assertIn("      ORDAX_R2_SECRET_ACCESS_KEY: ${{ secrets.ORDAX_R2_SECRET_ACCESS_KEY }}", caller)
        self.assertNotIn("secrets: inherit", caller)
        self.assertIn("bash tools/ci/independent_surface_r2.sh restore", official)
        self.assertIn("Verify and bind canonical Surface EROFS for QEMU", official)
        self.assertIn("Never compile Surface inside the QEMU consumer", official)

    def test_signed_release_fault_qemu_is_real_and_separate_from_product_boot(self):
        official = (ROOT / ".github/workflows/portable-v2-qemu-boot-proof.yml").read_text()
        fault = (BASE / "signed_release_failure_qemu.py").read_text()
        self.assertIn("name: Prove invalid Ed25519 candidate, durable rollback and read-only rescue in QEMU", official)
        self.assertIn("if: ${{ (inputs.base_source || 'independent') == 'independent' }}", official)
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

    def test_bridge_rejects_owner_development_as_signed_portable_base(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "not-created"
            args = [
                sys.executable, str(BASE / "portable_boot_proof.py"),
                "--base-profile", "owner-development",
                "--base-out", str(target),
                "--kernel", str(Path(tmp) / "missing-kernel"),
                "--capsule", str(Path(tmp) / "missing-capsule"),
                "--state-image", str(Path(tmp) / "missing-state"),
                "--portable-root", str(Path(tmp) / "missing-portable"),
                "--trust", str(Path(tmp) / "missing-trust"),
                "--source-commit", "a" * 40,
                "--output-dir", str(Path(tmp) / "proof"),
            ]
            rejected = subprocess.run(args, capture_output=True, text=True, cwd=ROOT)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("invalid choice", rejected.stderr)
            self.assertFalse((Path(tmp) / "proof").exists())

    def test_stable_cache_reuse_binding_checks_real_manifest_and_detects_tampering(self):
        # Unit-test only: tiny synthetic files exercise the *actual* cache
        # verifier, not the Buildroot build, signature or QEMU success path.
        cache_path = ROOT / "tools/ci/portable_component_cache.py"
        spec = importlib.util.spec_from_file_location("stable_cache_binding_test", cache_path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        cache = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cache)

        bridge_spec = importlib.util.spec_from_file_location(
            "stable_portable_bridge_test", BASE / "portable_boot_proof.py")
        self.assertIsNotNone(bridge_spec)
        self.assertIsNotNone(bridge_spec.loader)
        # Multiple producer modules are named build.py. Isolate the one
        # adjacent to the independent-base bridge from earlier test imports.
        previous_build = sys.modules.pop("build", None)
        sys.path.insert(0, str(BASE))
        try:
            bridge = importlib.util.module_from_spec(bridge_spec)
            bridge_spec.loader.exec_module(bridge)
        finally:
            sys.path.remove(str(BASE))
            if previous_build is None:
                sys.modules.pop("build", None)
            else:
                sys.modules["build"] = previous_build
        self.assertEqual(bridge.ROOT, ROOT)

        with tempfile.TemporaryDirectory() as td, patch.dict(
            os.environ, {"ORDAX_COMPONENT_CACHE_ENVIRONMENT": "unit-test/portable-bridge"}
        ):
            root = Path(td)
            output = root / "stable"
            output.mkdir()
            digests = {}
            for name in ("rootfs.tar", "rootfs.cpio.gz", "independent-base.erofs"):
                payload = ("unit-only-" + name).encode("utf-8")
                (output / name).write_bytes(payload)
                digests[name] = hashlib.sha256(payload).hexdigest()
            origin = "1" * 40
            current = "2" * 40
            provenance = {
                "$schema": "prototype-ordax.independent-base-provenance/1",
                "status": "candidate-build-only",
                "source_commit": origin,
                "profile": "stable-mvp",
                "owner_development_capabilities_verified": False,
                "physical_artifact_authorized": False,
                "signed_release_equivalence_proven": False,
                "artifacts": digests,
            }
            (output / "provenance.json").write_text(
                json.dumps(provenance) + "\n", encoding="utf-8")
            cache.record_component("independent-base-stable", output, origin, ROOT)
            binding_path = root / "binding.json"
            cache.verify_component(
                "independent-base-stable", output, current, binding_path,
                cache_hit=True, root=ROOT,
            )
            evidence_path = root / "independently-verified.json"
            validated = bridge.verify_stable_cache_binding(
                output, current, provenance, binding_path, evidence_path,
            )
            self.assertTrue(validated["reused"])
            self.assertEqual(validated["build_source_commit"], origin)
            self.assertEqual(validated["integration_source_commit"], current)
            self.assertFalse(validated["provenance_rewritten"])
            self.assertEqual(
                json.loads((output / "provenance.json").read_text()), provenance,
                "reuse must not rewrite the producer provenance",
            )

            # A forged integration commit cannot turn a stale cache into a
            # signed release candidate even when all original files are intact.
            original = binding_path.read_text(encoding="utf-8")
            forged = json.loads(original)
            forged["integration_source_commit"] = "3" * 40
            binding_path.write_text(json.dumps(forged) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(bridge.BaseError, "receipt differs"):
                bridge.verify_stable_cache_binding(
                    output, current, provenance, binding_path, root / "forgery.json")
            binding_path.write_text(original, encoding="utf-8")

            # A single mutated cached byte also invalidates the whole binding.
            (output / "rootfs.tar").write_bytes(b"tampered")
            with self.assertRaisesRegex(bridge.BaseError, "does not validate"):
                bridge.verify_stable_cache_binding(
                    output, current, provenance, binding_path, root / "tampered.json")

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
