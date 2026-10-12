"""Contract-only gates. Runtime/QEMU proof is exercised by its separate CI job."""
import gzip
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "bootstrap/independent-base"


class IndependentBaseTest(unittest.TestCase):
    def test_probe_init_is_git_executable_in_canonical_source(self):
        relative = "bootstrap/independent-base/overlay/sbin/ordax-independent-probe-init"
        result = subprocess.run(
            ["git", "ls-files", "--stage", "--", relative],
            capture_output=True, text=True, cwd=ROOT, check=True)
        self.assertRegex(result.stdout, r"^100755 [0-9a-f]{40} 0\t" + relative + r"\n$")

    def test_final_cpio_executable_mode_check_rejects_0644(self):
        module_spec = importlib.util.spec_from_file_location(
            "ordax_independent_base_build_test", BASE / "build.py")
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)

        def entry(name: str, mode: int, payload: bytes = b"") -> bytes:
            raw_name = name.encode("utf-8") + b"\0"
            fields = [1, mode, 0, 0, 1, 0, len(payload), 0, 0, 0, 0, len(raw_name), 0]
            header = b"070701" + b"".join(f"{n:08x}".encode("ascii") for n in fields)
            prefix = header + raw_name
            return (prefix + bytes(-len(prefix) % 4)
                    + payload + bytes(-len(payload) % 4))

        trailer = entry("TRAILER!!!", 0)
        with tempfile.TemporaryDirectory() as d:
            artifact = Path(d) / "rootfs.cpio.gz"
            for mode in (0o100755, 0o100644):
                archive = entry("sbin/ordax-independent-probe-init", mode, b"#!/bin/sh\n")
                artifact.write_bytes(gzip.compress(archive + trailer, mtime=0))
                if mode == 0o100755:
                    module.verify_executable_mode(artifact, "cpio")
                else:
                    with self.assertRaisesRegex(module.BaseError, "0755"):
                        module.verify_executable_mode(artifact, "cpio")
            artifact.write_bytes(gzip.compress(trailer, mtime=0))
            with self.assertRaisesRegex(module.BaseError, "missing or duplicated"):
                module.verify_executable_mode(artifact, "cpio")

    def test_experiment_is_disconnected_from_release(self):
        spec = json.loads((BASE / "source.json").read_text())
        self.assertEqual(spec["status"], "experimental-not-promotable")
        self.assertIs(spec["physical_artifact_authorized"], False)
        self.assertIs(spec["stable_channel_authorized"], False)
        self.assertNotIn("bootstrap/independent-base/build.py",
                         (ROOT / "bootstrap/stable-base/source.json").read_text())

    def test_neutral_erofs_owner_and_legacy_layout_separation(self):
        spec = json.loads((BASE / "source.json").read_text())
        self.assertEqual(spec["erofs_format_contract"],
                         "docs/contracts/portable-boot-handoff.json")
        self.assertEqual(spec["stable_base_layout_compatibility_contract"],
                         "bootstrap/stable-base/source.json")
        self.assertNotIn("stable_base_format_contract", spec)

    def test_qemu_never_attaches_a_physical_target_or_mutates_base(self):
        proof = (BASE / "qemu_proof.py").read_text()
        self.assertIn("snapshot=on", proof)
        self.assertIn("base_before = digest(base)", proof)
        self.assertIn('if digest(base) != base_before:', proof)
        self.assertIn('str(path).startswith("/dev/")', proof)
        init = (BASE / "overlay/sbin/ordax-independent-probe-init").read_text()
        self.assertIn(' /proof/base erofs ro,', init)
        self.assertIn("rescue erofs-write-accepted", init)

    def test_canonical_input_contracts(self):
        result = subprocess.run(
            [sys.executable, str(BASE / "build.py"), "check"],
            capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "contract-check-pass")

    def test_verification_fails_closed_without_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                [sys.executable, str(BASE / "build.py"), "verify", "--out", tmp],
                capture_output=True, text=True, cwd=ROOT)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("ERROR", result.stderr)

    def test_canonical_guardian_supervisor_and_adversarial_qemu_contract(self):
        post = (BASE / "post-build.sh").read_text()
        self.assertIn('cp "$ROOT/system/$source" "$PROOF_SYSTEM/$source"', post)
        proof = (BASE / "overlay/sbin/ordax-independent-probe-init").read_text()
        self.assertIn("ORDAX_INDEPENDENT_GUARDIAN_RESTART_FAIL_CLOSED=PASS", proof)
        self.assertIn("ORDAX_INDEPENDENT_GUARDIAN_TERMINATION=PASS", proof)
        self.assertIn("ORDAX_INDEPENDENT_NETWORK_DNS_RESOLUTION=PASS", proof)
        self.assertIn("ORDAX_INDEPENDENT_STATE_SECURITY=PASS", proof)
        self.assertIn("ORDAX_INDEPENDENT_OVERLAY=PASS", proof)
        self.assertIn("rescue overlay-lower-writable", proof)
        self.assertIn("rescue guardian-accepted-unverified-surface", proof)
        self.assertNotIn("exec /system/entrypoint", proof)
        self.assertNotIn('ORDAX_STABLE_LAYOUT=legacy-tree', proof)
        for service in ("entrypoint", "supervisor"):
            self.assertTrue((ROOT / "system" / service).is_file())

    def test_phase3_primitives_not_a_parallel_services_stack(self):
        config = (BASE / "configs/ordax_minimal_defconfig").read_text()
        for marker in ("BR2_PACKAGE_IPROUTE2=y", "BR2_PACKAGE_CA_CERTIFICATES=y",
                       "BR2_INIT_NONE=y"):
            self.assertIn(marker, config)
        self.assertNotIn("BR2_PACKAGE_IPROUTE2_IP=y", config)
        self.assertNotIn("BR2_PACKAGE_SYSTEMD=y", config)
        self.assertNotIn("BR2_PACKAGE_NETWORK_MANAGER=y", config)
        probe = (BASE / "overlay/sbin/ordax-independent-probe-init").read_text()
        self.assertIn("ORDAX_INDEPENDENT_SERVICE_PRIMITIVES=PASS", probe)
        self.assertIn("ORDAX_INDEPENDENT_IPROUTE2=PASS", probe)
        self.assertNotIn("exec /system/entrypoint", probe)
        handoff = (BASE / "post-build.sh").read_text()
        self.assertIn('cp "$ROOT/bootstrap/stable-base/ordax-stable-init"', handoff)
        self.assertIn('cp "$ROOT/bootstrap/network/bring-up"', handoff)

    def test_no_second_kernel_version(self):
        profile = (BASE / "configs/ordax_minimal_defconfig").read_text()
        self.assertNotIn("BR2_DEFAULT_KERNEL_VERSION=", profile)
        self.assertNotIn("BR2_LINUX_KERNEL_VERSION=", profile)


if __name__ == "__main__":
    unittest.main()
