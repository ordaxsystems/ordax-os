"""Contract-only gates. Runtime/QEMU proof is exercised by its separate CI job."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import tracemalloc
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


    def test_large_build_output_stays_bounded_without_losing_failure_tail(self):
        # Exercises the real subprocess path without downloading or compiling
        # Buildroot. Report measured parent-process memory, not an assumption.
        spec = importlib.util.spec_from_file_location("independent_builder", BASE / "build.py")
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        generate = (
            "import sys; "
            "sys.stdout.buffer.write(b'X' * (16 * 1024 * 1024)); "
            "sys.stdout.buffer.write(b'END_OF_BUILD\\n')"
        )

        def observed_peak(bounded):
            tracemalloc.start()
            try:
                output = builder.run(sys.executable, "-c", generate, bounded_output=bounded)
                current, peak = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
            self.assertTrue(output.endswith("END_OF_BUILD\\n"))
            return peak

        baseline = observed_peak(False)
        bounded = observed_peak(True)
        print(f"INDEPENDENT_BUILD_LOG_PEAK_BYTES baseline={baseline} bounded={bounded}")
        self.assertGreater(baseline, 4 * 1024 * 1024)
        self.assertLess(bounded, 2 * 1024 * 1024)
        self.assertLess(bounded, baseline // 4)

        failing = (
            "import sys; "
            "sys.stdout.buffer.write(b'Y' * (4 * 1024 * 1024)); "
            "sys.stdout.buffer.write(b'BUILD_FAILURE_MARKER\\n'); "
            "sys.exit(7)"
        )
        with self.assertRaises(builder.BaseError) as caught:
            builder.run(sys.executable, "-c", failing, bounded_output=True)
        diagnostic = str(caught.exception)
        self.assertIn("failed (7)", diagnostic)
        self.assertIn("BUILD_FAILURE_MARKER", diagnostic)
        self.assertNotIn("Y" * 12000, diagnostic)

    def test_verification_fails_closed_without_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                [sys.executable, str(BASE / "build.py"), "verify", "--out", tmp],
                capture_output=True, text=True, cwd=ROOT)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("ERROR", result.stderr)

    def test_no_second_kernel_version(self):
        profile = (BASE / "configs/ordax_minimal_defconfig").read_text()
        self.assertNotIn("BR2_DEFAULT_KERNEL_VERSION=", profile)
        self.assertNotIn("BR2_LINUX_KERNEL_VERSION=", profile)


if __name__ == "__main__":
    unittest.main()
