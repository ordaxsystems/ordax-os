import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = ROOT / "bootstrap/windows-compat-runtime/validate_apk_content_lock.py"
CONTENT_LOCK_PATH = ROOT / "bootstrap/windows-compat-runtime/apk-content-lock.json"
VERSION_LOCK_PATH = ROOT / "bootstrap/windows-compat-runtime/build-version-lock.json"
SOURCE_PATH = ROOT / "bootstrap/windows-compat-runtime/source.json"

spec = importlib.util.spec_from_file_location("ordax_windows_compat_apk_content_lock", VALIDATOR_PATH)
validator = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(validator)


class WindowsCompatibilityApkContentLockTests(unittest.TestCase):
    def setUp(self):
        self.lock = json.loads(CONTENT_LOCK_PATH.read_text(encoding="utf-8"))
        self.version_lock = json.loads(VERSION_LOCK_PATH.read_text(encoding="utf-8"))
        self.source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))

    def validate(self, value):
        return validator.validate_lock(value, self.version_lock, self.source)

    def test_content_lock_is_pinned_but_not_build_ready(self):
        value = self.validate(copy.deepcopy(self.lock))
        self.assertTrue(value["gates"]["apk_content_hashes_pinned"])
        self.assertTrue(value["gates"]["offline_content_replay_passed"])
        self.assertFalse(value["gates"]["full_build_proof_passed"])
        self.assertFalse(value["gates"]["binary_artifact_pinned"])
        self.assertFalse(value["gates"]["activation_authorized"])
        self.assertFalse(value["gates"]["execution_authorized"])

    def test_manifest_digest_commits_to_all_external_apks(self):
        value = self.validate(copy.deepcopy(self.lock))
        apk_set = value["external_apk_set"]
        self.assertEqual(apk_set["package_count"], 326)
        self.assertEqual(apk_set["total_size_bytes"], 595141970)
        self.assertEqual(
            apk_set["canonical_manifest_sha256"],
            "9ecad632554f9f164294a803af9cfe8ccbfba525c71e1cd61c7cbd9fc7e8d7bf",
        )
        self.assertEqual(apk_set["manifest_entry_fields"], ["filename", "sha256", "size_bytes", "version"])

    def test_closure_identity_matches_version_lock(self):
        value = self.validate(copy.deepcopy(self.lock))
        self.assertEqual(value["resolved_closure"]["package_count"], 342)
        self.assertEqual(
            value["resolved_closure"]["canonical_json_sha256"],
            self.version_lock["resolved_closure"]["canonical_json_sha256"],
        )

    def test_manifest_digest_drift_is_rejected(self):
        value = copy.deepcopy(self.lock)
        value["external_apk_set"]["canonical_manifest_sha256"] = "0" * 64
        with self.assertRaisesRegex(validator.ApkContentLockError, "manifest digest drifted"):
            self.validate(value)

    def test_package_count_drift_is_rejected(self):
        value = copy.deepcopy(self.lock)
        value["external_apk_set"]["package_count"] = 325
        with self.assertRaisesRegex(validator.ApkContentLockError, "package count drifted"):
            self.validate(value)

    def test_artifact_provenance_drift_is_rejected(self):
        value = copy.deepcopy(self.lock)
        value["provenance"]["artifact_id"] = 1
        with self.assertRaisesRegex(validator.ApkContentLockError, "artifact provenance drifted"):
            self.validate(value)

    def test_full_build_cannot_be_faked_true(self):
        value = copy.deepcopy(self.lock)
        value["gates"]["full_build_proof_passed"] = True
        with self.assertRaisesRegex(validator.ApkContentLockError, "overclaims readiness"):
            self.validate(value)

    def test_runtime_dependency_inventory_cannot_be_faked_true(self):
        value = copy.deepcopy(self.lock)
        value["gates"]["runtime_dependency_inventory_complete"] = True
        with self.assertRaisesRegex(validator.ApkContentLockError, "overclaims readiness"):
            self.validate(value)

    def test_execution_cannot_be_faked_true(self):
        value = copy.deepcopy(self.lock)
        value["gates"]["execution_authorized"] = True
        with self.assertRaisesRegex(validator.ApkContentLockError, "overclaims readiness"):
            self.validate(value)


if __name__ == "__main__":
    unittest.main()
