import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "system" / "surface" / "runtime" / "physical_performance_probe.py"
ENTRYPOINT = ROOT / "system" / "surface" / "bin" / "ordax-performance-evidence"

spec = importlib.util.spec_from_file_location("ordax_physical_performance_probe", PROBE)
probe = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(probe)


def write(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class PhysicalSurfacePerformanceProbeTests(unittest.TestCase):
    def build_proc_fixture(self, root: Path):
        write(root / "uptime", "123.50 10.0\n")
        write(root / "loadavg", "1.25 0.75 0.50 1/100 42\n")
        write(
            root / "meminfo",
            "MemTotal:       8000000 kB\n"
            "MemAvailable:   5000000 kB\n"
            "SwapTotal:      1000000 kB\n"
            "SwapFree:        750000 kB\n",
        )
        write(root / "stat", "cpu  10 2 3 40 5 0 0 0 0 0\n")
        for resource, total in (("cpu", 100), ("memory", 200), ("io", 300)):
            write(
                root / "pressure" / resource,
                f"some avg10=1.00 avg60=2.00 avg300=3.00 total={total}\n",
            )
        write(
            root / "diskstats",
            "8 0 sda 10 0 20 30 40 0 50 60 0 70 80 0 0 0 0\n"
            "7 0 loop0 100 0 200 300 400 0 500 600 0 700 800 0 0 0 0\n",
        )
        process = root / "123"
        process.mkdir()
        (process / "cmdline").write_bytes(
            b"python3\x00/srv/ordax-system/surface/runtime/native_host_server.py\x00"
        )
        fields = ["S"] + ["0"] * 21
        fields[11] = "7"
        fields[12] = "3"
        fields[21] = "5"
        write(process / "stat", f"123 (python3) {' '.join(fields)}\n")

    def test_fixture_sample_is_bounded_sanitized_and_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            self.build_proc_fixture(proc_root)
            sample = probe.collect_sample(proc_root, 1.25)

        self.assertEqual(sample["elapsedMilliseconds"], 1250)
        self.assertEqual(sample["uptimeSeconds"], 123.5)
        self.assertEqual(sample["load"]["oneMinute"], 1.25)
        self.assertEqual(sample["memory"]["availableBytes"], 5_000_000 * 1024)
        self.assertEqual(sample["cpu"], {"totalTicks": 60, "idleTicks": 40, "ioWaitTicks": 5})
        self.assertEqual(sample["pressure"]["io"]["total"], 300)
        self.assertEqual([device["name"] for device in sample["blockDevices"]], ["sda"])
        self.assertEqual(sample["blockDevices"][0]["bytesRead"], 20 * 512)
        self.assertEqual(sample["processRoles"]["native-host"]["processCount"], 1)
        self.assertEqual(sample["processRoles"]["native-host"]["cpuTicks"], 10)
        self.assertEqual(sample["processRoles"]["native-host"]["rssBytes"], 5 * probe.PAGE_SIZE)
        self.assertNotIn("cmdline", str(sample))
        self.assertNotIn("native_host_server.py", str(sample))

    def test_local_ai_process_is_aggregated_without_exposing_cmdline(self):
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            self.build_proc_fixture(proc_root)
            process = proc_root / "456"
            process.mkdir()
            (process / "cmdline").write_bytes(
                b"/run/ordax/runtime/local-ai/bin/llama-server\x00"
                b"--model\x00/run/ordax/runtime/local-ai/models/model.gguf\x00"
            )
            fields = ["S"] + ["0"] * 21
            fields[11] = "11"
            fields[12] = "5"
            fields[21] = "7"
            write(process / "stat", f"456 (llama-server) {' '.join(fields)}\n")

            sample = probe.collect_sample(proc_root, 0.0)

        local_ai = sample["processRoles"]["local-ai"]
        self.assertEqual(local_ai["processCount"], 1)
        self.assertEqual(local_ai["cpuTicks"], 16)
        self.assertEqual(local_ai["rssBytes"], 7 * probe.PAGE_SIZE)
        rendered = str(sample)
        self.assertNotIn("model.gguf", rendered)
        self.assertNotIn("llama-server", rendered)

    def test_probe_never_promotes_observation_to_physical_verdict(self):
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            self.build_proc_fixture(proc_root)
            with mock.patch.object(probe.time, "sleep"):
                result = probe.run_probe(proc_root, 2, 0.1)

        self.assertEqual(result["schema"], probe.SCHEMA)
        self.assertEqual(result["status"], "observed")
        self.assertEqual(result["environmentAttestation"], "unverified")
        self.assertIsNone(result["physicalPerformanceVerdict"])
        self.assertFalse(result["networkAccess"])
        self.assertFalse(result["stateMutation"])
        self.assertEqual(len(result["samples"]), 2)
        self.assertIsInstance(result["logicalCpuCount"], int)
        self.assertGreater(result["logicalCpuCount"], 0)

    def test_logical_cpu_count_fails_soft_when_runtime_cannot_report_it(self):
        with mock.patch.object(probe.os, "cpu_count", return_value=None):
            self.assertIsNone(probe.logical_cpu_count())
        with mock.patch.object(probe.os, "cpu_count", return_value=0):
            self.assertIsNone(probe.logical_cpu_count())
        with mock.patch.object(probe.os, "cpu_count", return_value=4):
            self.assertEqual(probe.logical_cpu_count(), 4)

    def test_measurement_units_are_explicit_and_process_cpu_is_interpretable(self):
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            self.build_proc_fixture(proc_root)
            with mock.patch.object(probe.time, "sleep"):
                result = probe.run_probe(proc_root, 2, 0.1)

        self.assertEqual(
            result["measurementUnits"],
            {
                "pageSizeBytes": probe.PAGE_SIZE,
                "clockTicksPerSecond": probe.CLOCK_TICKS_PER_SECOND,
                "diskStatSectorBytes": 512,
            },
        )
        native = result["summary"]["processRoleDeltas"]["native-host"]
        self.assertEqual(native["cpuTicksDelta"], 0)
        self.assertEqual(native["cpuSecondsDelta"], 0.0)

    def test_probe_rejects_unbounded_sampling_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            for samples, interval in ((0, 1.0), (601, 1.0), (1, 0.01), (1, 11.0)):
                with self.assertRaises(ValueError):
                    probe.run_probe(proc_root, samples, interval)

    def test_source_has_no_network_or_file_output_path(self):
        source = PROBE.read_text(encoding="utf-8")
        for forbidden in (
            "import socket",
            "import urllib",
            "import requests",
            "urlopen(",
            "write_text(",
            "write_bytes(",
        ):
            self.assertNotIn(forbidden, source)
        self.assertIn("json.dump(result, sys.stdout", source)

    def test_stable_entrypoint_runs_probe_in_active_runtime_without_mutation(self):
        entrypoint = ENTRYPOINT.read_text(encoding="utf-8")
        self.assertIn("ordax-proof-runtime.sh", entrypoint)
        self.assertIn("resolve_ordax_proof_runtime_root", entrypoint)
        self.assertIn(
            "SCRIPT=/srv/ordax-system/surface/runtime/physical_performance_probe.py",
            entrypoint,
        )
        self.assertIn('[ -d "$RUNTIME_ROOT/proc" ]', entrypoint)
        self.assertIn(
            'exec /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$SCRIPT" "$@"',
            entrypoint,
        )
        for forbidden in (
            " mount ",
            " umount ",
            ">/proc",
            "> /proc",
            "tee /proc",
            "dd if=",
            "dd of=",
        ):
            self.assertNotIn(forbidden, entrypoint)


if __name__ == "__main__":
    unittest.main()
