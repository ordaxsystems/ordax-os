import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_evidence_finalize.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_evidence_finalize", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME = "wine-11.0-wow64-x86_64-candidate"
STAGE = "a" * 64
FIRST = "b" * 64
INVARIANCE = "c" * 64
INVENTORY = "d" * 64


class RuntimeDependencyEvidenceTests(unittest.TestCase):
    def fixtures(self):
        forbidden = {
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        }
        full = {
            "$schema": "prototype-ordax.windows-compat-full-build-proof/2",
            "runtime_id": RUNTIME,
            "staging": {"canonical_manifest_sha256": STAGE},
            "gates": {
                "full_build_proof_passed": True,
                "staged_install_completed": True,
                **forbidden,
            },
        }
        first = {
            "$schema": "prototype-ordax.windows-compat-runtime-first-hit-proof/1",
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "validation_sha256": FIRST,
            "counts": {"dependencies_checked": 1, "stage_hits": 0, "rootfs_hits": 1},
            "gates": {"first_pathname_hit_verified": True, **forbidden},
        }
        invariance = {
            "$schema": "prototype-ordax.windows-compat-runtime-loader-invariance-proof/1",
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "validation_sha256": INVARIANCE,
            "counts": {"needed_identity_soname_pairs": 1},
            "gates": {
                "staged_needed_by_chain_invariance_verified": True,
                "staged_shortname_reuse_invariance_verified": True,
                "external_transitive_closure_verified": False,
                **forbidden,
            },
        }
        dependency = {
            "$schema": "prototype-ordax.windows-compat-runtime-dependency-proof/1",
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "inventory_sha256": INVENTORY,
            "counts": {"elf_files": 1, "external_packages": 1, "external_sonames": 1},
            "gates": {
                "loader_resolution_verified": True,
                "staging_dependency_inventory_complete": True,
                "runtime_package_content_hashes_pinned": False,
                **forbidden,
            },
        }
        return full, first, invariance, dependency

    def test_finalize_binds_all_loader_evidence_without_promoting_runtime(self):
        result = MODULE.finalize(*self.fixtures())
        self.assertEqual(result["$schema"], MODULE.PROOF_SCHEMA)
        self.assertEqual(result["runtime_id"], RUNTIME)
        self.assertEqual(result["staging_manifest_sha256"], STAGE)
        self.assertEqual(result["dependency_inventory_sha256"], INVENTORY)
        self.assertTrue(result["gates"]["loader_resolution_verified"])
        self.assertTrue(result["gates"]["staging_dependency_inventory_complete"])
        self.assertFalse(result["gates"]["external_transitive_closure_verified"])
        self.assertFalse(result["gates"]["runtime_dependency_inventory_complete"])

    def test_finalize_rejects_missing_loader_invariance(self):
        full, first, invariance, dependency = self.fixtures()
        invariance["gates"]["staged_needed_by_chain_invariance_verified"] = False
        with self.assertRaisesRegex(MODULE.DependencyEvidenceError, "needed_by chain invariance"):
            MODULE.finalize(full, first, invariance, dependency)


if __name__ == "__main__":
    unittest.main()
