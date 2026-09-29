import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROOF_PATH = ROOT / "bootstrap/windows-compat-runtime/full_build_probe.py"
CONTENT_LOCK_PATH = ROOT / "bootstrap/windows-compat-runtime/apk-content-lock.json"
TOOLCHAIN_PATH = ROOT / "bootstrap/windows-compat-runtime/full-build-toolchain.json"

spec = importlib.util.spec_from_file_location("ordax_windows_compat_full_build_proof", PROOF_PATH)
proof_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(proof_module)


class WindowsCompatibilityFullBuildProofTests(unittest.TestCase):
    def setUp(self):
        self.content_lock = json.loads(CONTENT_LOCK_PATH.read_text(encoding="utf-8"))
        self.toolchain = json.loads(TOOLCHAIN_PATH.read_text(encoding="utf-8"))

    def test_full_build_inputs_are_locked_but_unproven(self):
        content_lock, version_lock, source, toolchain = proof_module.load_inputs()
        self.assertTrue(content_lock["gates"]["apk_content_hashes_pinned"])
        self.assertFalse(content_lock["gates"]["full_build_proof_passed"])
        self.assertFalse(content_lock["gates"]["activation_authorized"])
        self.assertFalse(content_lock["gates"]["execution_authorized"])
        self.assertEqual(version_lock["runtime_id"], content_lock["runtime_id"])
        self.assertEqual(source["runtime_id"], content_lock["runtime_id"])
        self.assertEqual(toolchain["native"]["cc"], "/usr/bin/gcc")
        self.assertEqual(toolchain["native"]["cxx"], "/usr/bin/g++")
        self.assertEqual(toolchain["mingw"]["x86_64_configure_variable"], "x86_64_CC")
        self.assertEqual(toolchain["mingw"]["i686_configure_variable"], "i386_CC")
        self.assertFalse(toolchain["gates"]["full_build_proof_passed"])
        self.assertFalse(toolchain["gates"]["execution_authorized"])

    def test_toolchain_forbids_fake_triplet_symlink_fix(self):
        _, version_lock, source, _ = proof_module.load_inputs()
        value = copy.deepcopy(self.toolchain)
        value["native"]["cc"] = "/usr/bin/x86_64-alpine-linux-musl-gcc"
        with self.assertRaisesRegex(proof_module.FullBuildProofError, "native compiler path identity drifted"):
            proof_module.validate_toolchain(value, version_lock, source)
        self.assertEqual(
            self.toolchain["root_cause_provenance"][0]["forbidden_fix"],
            "do-not-create-a-fake-triplet-compiler-symlink",
        )

    def test_pe_compilers_are_absolute_and_arch_bound(self):
        _, version_lock, source, _ = proof_module.load_inputs()
        mingw = self.toolchain["mingw"]
        self.assertEqual(mingw["x86_64_cc"], "/usr/bin/x86_64-w64-mingw32-gcc")
        self.assertEqual(mingw["i686_cc"], "/usr/bin/i686-w64-mingw32-gcc")
        value = copy.deepcopy(self.toolchain)
        value["mingw"]["x86_64_cc"] = "x86_64-w64-mingw32-gcc"
        with self.assertRaisesRegex(proof_module.FullBuildProofError, "MinGW compiler path identity drifted"):
            proof_module.validate_toolchain(value, version_lock, source)

    def test_second_root_cause_forbids_path_or_symlink_fallback(self):
        provenance = self.toolchain["root_cause_provenance"][1]
        self.assertEqual(provenance["failed_workflow_run_id"], 36517018593)
        self.assertEqual(provenance["failed_job_id"], 109241478785)
        self.assertEqual(provenance["forbidden_fix"], "do-not-add-compiler-symlinks-or-host-path-fallbacks")
        self.assertEqual(provenance["required_fix"], "bind-x86_64_CC-and-i386_CC-to-verified-absolute-rootfs-paths")

    def test_toolchain_cannot_claim_full_build_before_proof(self):
        _, version_lock, source, _ = proof_module.load_inputs()
        value = copy.deepcopy(self.toolchain)
        value["gates"]["full_build_proof_passed"] = True
        with self.assertRaisesRegex(proof_module.FullBuildProofError, "overclaims readiness"):
            proof_module.validate_toolchain(value, version_lock, source)

    def test_manifest_digest_is_canonical(self):
        left = {"b": {"version": "2"}, "a": {"version": "1"}}
        right = {"a": {"version": "1"}, "b": {"version": "2"}}
        self.assertEqual(proof_module.canonical_manifest_sha256(left), proof_module.canonical_manifest_sha256(right))

    def test_discovery_manifest_drift_is_rejected(self):
        proof = {
            "status": "content-discovered-offline-replayed-not-pinned-not-build-proven",
            "resolved_package_count": 342,
            "resolved_closure_sha256": self.content_lock["resolved_closure"]["canonical_json_sha256"],
            "offline_replay_closure_sha256": self.content_lock["resolved_closure"]["canonical_json_sha256"],
            "external_apk_package_count": 326,
            "external_apk_manifest": {},
            "gates": {
                "version_lock_verified": True,
                "closure_reproduced": True,
                "apk_content_discovered": True,
                "offline_content_replay_passed": True,
                "apk_content_hashes_pinned": False,
                "full_build_proof_passed": False,
            },
        }
        with self.assertRaisesRegex(proof_module.FullBuildProofError, "package count drifted"):
            proof_module.verify_discovery(proof, self.content_lock)

    def test_build_jobs_are_bounded_before_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(proof_module.FullBuildProofError, "build jobs must be between"):
                proof_module.perform_full_build(Path(tmp), 0)

    def test_staging_manifest_records_files_and_symlinks_without_execution(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "usr/bin").mkdir(parents=True)
            payload = root / "usr/bin/wine"
            payload.write_bytes(b"not-an-executable-proof")
            (root / "usr/bin/wine64").symlink_to("wine")
            manifest, total = proof_module.staging_manifest(root)
            self.assertEqual(total, len(b"not-an-executable-proof"))
            self.assertEqual(manifest["usr/bin/wine"]["type"], "file")
            self.assertEqual(manifest["usr/bin/wine64"], {"type": "symlink", "target": "wine"})

    def test_module_exposes_no_windows_launch_entrypoint(self):
        forbidden = {"launch", "execute", "run_windows", "install_runtime", "activate_runtime", "spawn_payload"}
        self.assertTrue(forbidden.isdisjoint(set(vars(proof_module))))


if __name__ == "__main__":
    unittest.main()
