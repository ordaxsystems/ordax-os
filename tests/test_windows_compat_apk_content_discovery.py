import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
DISCOVERY_PATH = ROOT / "bootstrap/windows-compat-runtime/discover_apk_content.py"
LOCK_PATH = ROOT / "bootstrap/windows-compat-runtime/build-version-lock.json"

spec = importlib.util.spec_from_file_location("ordax_windows_compat_apk_content_discovery", DISCOVERY_PATH)
discovery = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(discovery)


class WindowsCompatibilityApkContentDiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))

    def test_canonical_closure_hash_matches_pinned_proof(self):
        proof = {"b": "2-r0", "a": "1-r0"}
        self.assertEqual(
            discovery.canonical_package_map_sha256(proof),
            discovery.canonical_package_map_sha256({"a": "1-r0", "b": "2-r0"}),
        )

    def test_exact_specs_are_sorted_and_version_bound(self):
        packages = {"z": "2-r0", "a": "1-r1"}
        self.assertEqual(discovery.exact_specs(packages), ["a=1-r1", "z=2-r0"])
        self.assertEqual(discovery.fetch_names(packages), ["a", "z"])

    def test_discovery_contract_is_fail_closed(self):
        lock, source, environment = discovery.validate_discovery_inputs()
        self.assertEqual(lock["runtime_id"], "wine-11.0-wow64-x86_64-candidate")
        self.assertEqual(source["version"], "11.0")
        self.assertEqual(environment["host"]["libc"], "musl")
        self.assertFalse(lock["gates"]["apk_content_hashes_pinned"])
        self.assertFalse(lock["gates"]["full_build_proof_passed"])
        self.assertFalse(lock["gates"]["execution_authorized"])

    def test_version_lock_has_expected_closure_identity(self):
        self.assertEqual(self.lock["resolved_closure"]["package_count"], 342)
        self.assertEqual(
            self.lock["resolved_closure"]["canonical_json_sha256"],
            "e393674aac035f51e0e7b42c85e25850cfb026d9ab79499e0ca444bb0803ecdd",
        )

    def test_discovery_module_exposes_no_build_or_execution_entrypoint(self):
        forbidden = {"build", "compile", "install_runtime", "activate", "execute", "launch", "spawn"}
        self.assertTrue(forbidden.isdisjoint(set(vars(discovery))))

    def test_sha256_file_is_content_sensitive(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "package.apk"
            path.write_bytes(b"first")
            one = discovery.sha256_file(path)
            path.write_bytes(b"second")
            two = discovery.sha256_file(path)
            self.assertNotEqual(one, two)
            self.assertEqual(len(one), 64)
            self.assertEqual(len(two), 64)


if __name__ == "__main__":
    unittest.main()
