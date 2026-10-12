"""Contract-only gates. Runtime/QEMU proof is exercised by its separate CI job."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "bootstrap/independent-base"


class IndependentBaseTest(unittest.TestCase):
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
