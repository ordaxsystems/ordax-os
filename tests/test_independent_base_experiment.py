"""Contract-only gates. Runtime/QEMU proof is exercised by its separate CI job."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import tracemalloc
import unittest
from unittest.mock import patch

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

    def test_guest_identifies_disposable_disk_roles_even_when_order_is_reversed(self):
        # Pure fixture test for the actual PID1 discovery function; QEMU CI
        # separately proves real immutable EROFS and persistent ext4 mounts.
        init = (BASE / "overlay/sbin/ordax-independent-probe-init").read_text()
        self.assertIn("find_disk_roles /dev/sda /dev/sdb", init)
        self.assertIn('mount -t erofs -o ro "$base_device"', init)
        self.assertIn('mount -t ext4 -o rw "$state_device"', init)
        self.assertNotIn("mount -t erofs -o ro /dev/sda", init)
        qemu = (BASE / "qemu_proof.py").read_text()
        self.assertIn("if=ide,index=0,format=raw,snapshot=on", qemu)
        self.assertIn("if=ide,index=1,format=raw", qemu)

        body = init.split("find_disk_roles() {\n", 1)[1].split("\n}\n", 1)[0]
        script = (
            'set -eu\n'
            'rescue() { printf "RECOVERY=%s\\n" "$1" >&2; exit 1; }\n'
            'find_disk_roles() {\n' + body + '\n}\n'
            'find_disk_roles "$1" "$2"\n'
            'printf "base=%s state=%s\\n" "$base_device" "$state_device"\n'
        )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base, state, unknown = (root / name for name in ("base.img", "state.img", "unknown.img"))
            erofs_bytes = bytearray(4096)
            erofs_bytes[1024:1028] = bytes.fromhex("e2e1f5e0")
            base.write_bytes(erofs_bytes)
            ext4_bytes = bytearray(4096)
            ext4_bytes[1080:1082] = bytes.fromhex("53ef")
            state.write_bytes(ext4_bytes)
            unknown.write_bytes(bytes(4096))

            def run(first, second):
                return subprocess.run(
                    ["sh", "-c", script, "guest-discovery", str(first), str(second)],
                    capture_output=True, text=True, check=False,
                )

            for disks in ((base, state), (state, base)):
                with self.subTest(order=disks):
                    result = run(*disks)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout.strip(), f"base={base} state={state}")
            ambiguous = run(base, base)
            self.assertNotEqual(ambiguous.returncode, 0)
            self.assertIn("RECOVERY=erofs-ambiguous", ambiguous.stderr)
            missing = run(unknown, state)
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("RECOVERY=erofs", missing.stderr)

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
            self.assertTrue(output.endswith("END_OF_BUILD\n"))
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

    def test_guest_metrics_parsed_from_serial_with_strict_bounds(self):
        # No QEMU or Buildroot compilation: test only the existing proof parser.
        # The full Foundation suite also imports tools/component-package/build.py
        # under the generic name "build". Bind only this fixture to its owner.
        builder_spec = importlib.util.spec_from_file_location("independent_metrics_builder", BASE / "build.py")
        builder = importlib.util.module_from_spec(builder_spec)
        builder_spec.loader.exec_module(builder)
        with patch.dict(sys.modules, {"build": builder}):
            spec = importlib.util.spec_from_file_location("independent_qemu_proof", BASE / "qemu_proof.py")
            qemu_proof = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(qemu_proof)

        lines = [
            "ORDAX_INDEPENDENT_METRIC_MEM_TOTAL_KIB=384000",
            "ORDAX_INDEPENDENT_METRIC_MEM_USED_KIB=24000",
            "ORDAX_INDEPENDENT_METRIC_CPU_BUSY_PCT=14",
            "ORDAX_INDEPENDENT_METRIC_PROCESSES=8",
            "ORDAX_INDEPENDENT_METRIC_UPTIME_S=4.52",
        ]
        serial = "\r\n".join(lines) + "\r\n"
        observed = qemu_proof.parse_guest_metrics(serial)
        self.assertEqual(observed["mem_used_kib"], 24000)
        self.assertEqual(observed["cpu_busy_pct"], 14)
        self.assertEqual(observed["processes"], 8)
        self.assertEqual(observed["uptime_s"], 4.52)
        with self.assertRaises(qemu_proof.BaseError):
            qemu_proof.parse_guest_metrics(serial + lines[0] + "\r\n")
        with self.assertRaises(qemu_proof.BaseError):
            qemu_proof.parse_guest_metrics(serial.replace("MEM_USED_KIB=24000", "MEM_USED_KIB=384001"))
        with self.assertRaises(qemu_proof.BaseError):
            qemu_proof.parse_guest_metrics(serial.replace("CPU_BUSY_PCT=14", "CPU_BUSY_PCT=101"))
        with self.assertRaises(qemu_proof.BaseError):
            qemu_proof.parse_guest_metrics(serial.replace("PROCESSES=8", "PROCESSES=0"))

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

    def test_buildroot_downloads_use_persistent_verified_cache(self):
        builder = (BASE / "build.py").read_text(encoding="utf-8")
        workflow = (ROOT / ".github/workflows/independent-base-experiment.yml").read_text(encoding="utf-8")
        self.assertIn('download_cache = cache / "buildroot-downloads"', builder)
        self.assertIn('f"BR2_DL_DIR={download_cache}"', builder)
        self.assertIn('"buildroot_download_cache_enabled": True', builder)
        self.assertIn("Restore Buildroot source/package download cache", workflow)
        self.assertIn("Save Buildroot source/package download cache", workflow)
        self.assertIn("${{ runner.temp }}/ordax-independent-cache", workflow)
        self.assertIn("ordax-buildroot-download-v1-", workflow)


if __name__ == "__main__":
    unittest.main()
