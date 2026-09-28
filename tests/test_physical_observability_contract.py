import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "physical-observability.json"
PERFORMANCE_COMMAND = ROOT / "system" / "surface" / "bin" / "ordax-physical-performance"
BOOT_STORAGE_COMMAND = ROOT / "system" / "surface" / "bin" / "ordax-physical-boot-storage"
OLD_PERFORMANCE_PATH = ROOT / "system" / "surface" / "runtime" / "physical_performance_probe.py"


class PhysicalObservabilityContractTests(unittest.TestCase):
    def test_contract_is_read_only_and_forbids_synthetic_physical_verdicts(self):
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(value["$schema"], "prototype-ordax.physical-observability/1")
        self.assertEqual(value["status"], "diagnostic-only")
        self.assertFalse(value["runtime_resolution"]["filesystem_shape_inference_allowed"])
        self.assertFalse(value["runtime_resolution"]["hardcoded_runtime_python_allowed"])
        for command in value["commands"].values():
            self.assertTrue(command["read_only"])
        for key in (
            "physical_verdict_from_probe_allowed",
            "hardware_compatibility_verdict_from_probe_allowed",
            "ci_or_qemu_promotable_to_physical_pass",
            "network_access_allowed",
            "state_mutation_allowed",
            "kernel_configuration_mutation_allowed",
            "storage_mutation_allowed",
            "fallback_evidence_source_allowed",
        ):
            self.assertFalse(value["evidence_policy"][key])
        self.assertFalse(value["storage_investigation"]["may_change_libata_force"])
        self.assertFalse(value["storage_investigation"]["may_blacklist_storage_driver"])
        self.assertFalse(value["storage_investigation"]["may_reduce_probe_timeout"])

    def test_commands_use_the_verified_runtime_resolver_and_exact_collectors(self):
        expected = {
            PERFORMANCE_COMMAND: "/srv/ordax-system/diagnostics/physical_surface_performance.py",
            BOOT_STORAGE_COMMAND: "/srv/ordax-system/diagnostics/physical_boot_storage.py",
        }
        for path, collector in expected.items():
            text = path.read_text(encoding="utf-8")
            self.assertIn("ordax-proof-runtime.sh", text)
            self.assertIn("resolve_ordax_proof_runtime_root", text)
            self.assertIn(f"SCRIPT={collector}", text)
            self.assertIn('exec /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$SCRIPT" "$@"', text)
            self.assertIn("set -eu", text)
            self.assertNotIn("|| true", text)

    def test_obsolete_surface_runtime_probe_path_is_removed(self):
        self.assertFalse(OLD_PERFORMANCE_PATH.exists())


if __name__ == "__main__":
    unittest.main()
