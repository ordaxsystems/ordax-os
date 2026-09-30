import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "bootstrap/windows-compat-runtime"
CONTRACT_PATH = RUNTIME / "runtime-unixlib-preload-source.json"
SOURCE_PROBE_PATH = RUNTIME / "runtime_unixlib_preload_source_probe.py"
RUNTIME_GUARD_PATH = RUNTIME / "runtime_unixlib_preload_runtime_guard.py"


class WindowsCompatibilityPreloadTemporalBoundaryTests(unittest.TestCase):
    def test_forwarder_process_attach_is_not_preload_authority(self):
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        derivation = contract.get("derivation", {})
        authority = contract.get("source_authority", {})

        self.assertNotIn("forwarder_activation_prerequisite_required", derivation)
        self.assertNotIn("forwarder_activation_prerequisites", authority)

    def test_vulkan_forwarder_shortcut_is_absent_from_source_and_runtime_proofs(self):
        source_probe = SOURCE_PROBE_PATH.read_text(encoding="utf-8")
        runtime_guard = RUNTIME_GUARD_PATH.read_text(encoding="utf-8")

        forbidden = (
            "forwarder-prerequisite-pe-dependency-attach",
            "forwarder_activation_prerequisite",
            "GetDpiForSystem",
        )
        for marker in forbidden:
            self.assertNotIn(marker, source_probe)
            self.assertNotIn(marker, runtime_guard)

    def test_only_dependency_attach_preload_order_is_declared(self):
        runtime_guard = RUNTIME_GUARD_PATH.read_text(encoding="utf-8")
        self.assertIn(
            "provider-pe-dependency-attach-before-consumer-unixlib-dlopen",
            runtime_guard,
        )


if __name__ == "__main__":
    unittest.main()
