import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "bootstrap/windows-compat-runtime/build.py"
SOURCE_PATH = ROOT / "bootstrap/windows-compat-runtime/source.json"

spec = importlib.util.spec_from_file_location("ordax_windows_compat_runtime_builder", BUILDER_PATH)
builder = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(builder)


class WindowsCompatibilityRuntimeSourceTests(unittest.TestCase):
    def setUp(self):
        self.source = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))

    def test_source_lock_is_fail_closed_and_non_activating(self):
        validated = builder.validate_source(copy.deepcopy(self.source))
        self.assertEqual(validated["engine"], "wine")
        self.assertEqual(validated["version"], "11.0")
        self.assertEqual(validated["build_intent"]["configure_flag"], "--enable-archs=x86_64,i386")
        self.assertFalse(validated["build_intent"]["build_recipe_validated"])
        self.assertFalse(validated["build_intent"]["binary_artifact_pinned"])
        self.assertFalse(validated["distribution"]["stable_base_inclusion_allowed"])
        self.assertFalse(validated["distribution"]["stable_mvp_activation_allowed"])
        self.assertFalse(validated["security"]["source_proof_grants_execution"])
        self.assertEqual(validated["security"]["host_authority"], "none")

    def test_source_identity_drift_is_rejected(self):
        tampered = copy.deepcopy(self.source)
        tampered["upstream"]["archive_sha256"] = "0" * 64
        with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "upstream identity drifted"):
            builder.validate_source(tampered)

    def test_unproven_build_cannot_be_marked_validated(self):
        tampered = copy.deepcopy(self.source)
        tampered["build_intent"]["build_recipe_validated"] = True
        with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "build intent drifted"):
            builder.validate_source(tampered)

    def test_stable_activation_cannot_be_enabled_by_contract_edit(self):
        tampered = copy.deepcopy(self.source)
        tampered["distribution"]["stable_mvp_activation_allowed"] = True
        with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "distribution safety policy drifted"):
            builder.validate_source(tampered)

    def test_archive_validator_rejects_unpinned_bytes_before_tar_parsing(self):
        with tempfile.TemporaryDirectory() as tmp:
            candidate = Path(tmp) / "wine-11.0.tar.xz"
            candidate.write_bytes(b"not-wine")
            with self.assertRaisesRegex(builder.CompatibilityRuntimeBuildError, "cached archive size changed"):
                builder.validate_archive(self.source, candidate)

    def test_builder_exposes_no_runtime_install_or_execute_operation(self):
        forbidden = {"install", "activate", "execute", "launch", "spawn", "run_wine"}
        self.assertTrue(forbidden.isdisjoint(set(vars(builder))))


if __name__ == "__main__":
    unittest.main()
