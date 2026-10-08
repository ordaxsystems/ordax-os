import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "bootstrap/windows-compat-runtime/validate_build_version_lock.py"
LOCK_PATH = ROOT / "bootstrap/windows-compat-runtime/build-version-lock.json"
SOURCE_PATH = ROOT / "bootstrap/windows-compat-runtime/source.json"
ENVIRONMENT_PATH = ROOT / "bootstrap/windows-compat-runtime/build-environment.json"

spec = importlib.util.spec_from_file_location("ordax_windows_compat_build_version_lock", VALIDATOR_PATH)
validator = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(validator)


class WindowsCompatibilityBuildVersionLockTests(unittest.TestCase):
    def setUp(self):
        self.lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
        self.source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
        self.environment = json.loads(ENVIRONMENT_PATH.read_text(encoding="utf-8"))

    def validate(self, value):
        return validator.validate_lock(value, self.source, self.environment)

    def test_version_lock_is_valid_but_not_build_ready(self):
        value = self.validate(copy.deepcopy(self.lock))
        self.assertTrue(value["gates"]["package_versions_pinned"])
        self.assertTrue(value["gates"]["transitive_closure_digest_pinned"])
        self.assertFalse(value["gates"]["apk_content_hashes_pinned"])
        self.assertFalse(value["gates"]["full_build_proof_passed"])
        self.assertFalse(value["gates"]["activation_authorized"])
        self.assertFalse(value["gates"]["execution_authorized"])

    def test_lock_tracks_all_requested_build_packages(self):
        value = self.validate(copy.deepcopy(self.lock))
        expected = set(self.environment["base_build_packages"] + self.environment["wine_build_packages"])
        self.assertEqual(set(value["requested_build_packages"]), expected)
        self.assertEqual(len(expected), 39)

    def test_closure_identity_is_pinned_from_configure_proof(self):
        value = self.validate(copy.deepcopy(self.lock))
        self.assertEqual(value["resolved_closure"]["package_count"], 342)
        self.assertEqual(
            value["resolved_closure"]["canonical_json_sha256"],
            "e393674aac035f51e0e7b42c85e25850cfb026d9ab79499e0ca444bb0803ecdd",
        )
        self.assertEqual(value["provenance"]["configure_proof_head_sha"], "3c29aa03a7b26cdcfb95b74694e5ba4954ae9cb0")

    def test_reviewed_refresh_is_non_promoting_and_provenance_bound(self):
        value = self.validate(copy.deepcopy(self.lock))
        refresh = value["lock_refresh"]
        self.assertEqual(len(refresh["changed_packages"]), 2)
        self.assertEqual([item["name"] for item in refresh["changed_packages"]], ["zlib", "zlib-dev"])
        self.assertTrue(refresh["offline_apk_content_reproof_required"])
        self.assertTrue(refresh["full_build_reproof_required"])
        self.assertFalse(refresh["activation_authorized"])
        self.assertFalse(refresh["execution_authorized"])

        tampered = copy.deepcopy(self.lock)
        tampered["lock_refresh"]["changed_packages"][0]["to"] = "1.3.2-r2"
        with self.assertRaisesRegex(validator.BuildVersionLockError, "reviewed package drift"):
            self.validate(tampered)

        tampered = copy.deepcopy(self.lock)
        tampered["lock_refresh"]["offline_apk_content_reproof_required"] = False
        with self.assertRaisesRegex(validator.BuildVersionLockError, "cannot promote"):
            self.validate(tampered)

        tampered = copy.deepcopy(self.lock)
        tampered["lock_refresh"]["historical_artifact"]["archive_sha256"] = "0" * 64
        with self.assertRaisesRegex(validator.BuildVersionLockError, "historical source artifact digest drifted"):
            self.validate(tampered)

    def test_configure_artifact_provenance_drift_is_rejected(self):
        value = copy.deepcopy(self.lock)
        value["provenance"]["configure_proof_artifact_digest"] = "sha256:" + ("0" * 64)
        with self.assertRaisesRegex(validator.BuildVersionLockError, "artifact digest drifted"):
            self.validate(value)

    def test_package_version_drift_is_rejected_indirectly_by_closure_gate(self):
        value = copy.deepcopy(self.lock)
        value["requested_build_packages"].pop("i686-mingw-w64-gcc")
        with self.assertRaisesRegex(validator.BuildVersionLockError, "requested build package set drifted"):
            self.validate(value)

    def test_source_hash_drift_is_rejected(self):
        value = copy.deepcopy(self.lock)
        value["source"]["archive_sha256"] = "0" * 64
        with self.assertRaisesRegex(validator.BuildVersionLockError, "source archive identity drifted"):
            self.validate(value)

    def test_closure_digest_must_be_sha256(self):
        value = copy.deepcopy(self.lock)
        value["resolved_closure"]["canonical_json_sha256"] = "not-a-digest"
        with self.assertRaisesRegex(validator.BuildVersionLockError, "closure digest invalid"):
            self.validate(value)

    def test_content_hash_gate_cannot_be_faked_true(self):
        value = copy.deepcopy(self.lock)
        value["gates"]["apk_content_hashes_pinned"] = True
        with self.assertRaisesRegex(validator.BuildVersionLockError, "overclaims readiness"):
            self.validate(value)

    def test_full_build_gate_cannot_be_faked_true(self):
        value = copy.deepcopy(self.lock)
        value["gates"]["full_build_proof_passed"] = True
        with self.assertRaisesRegex(validator.BuildVersionLockError, "overclaims readiness"):
            self.validate(value)

    def test_execution_gate_cannot_be_faked_true(self):
        value = copy.deepcopy(self.lock)
        value["gates"]["execution_authorized"] = True
        with self.assertRaisesRegex(validator.BuildVersionLockError, "overclaims readiness"):
            self.validate(value)


if __name__ == "__main__":
    unittest.main()
