import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_closure_evidence_finalize.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_closure_evidence_finalize", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME = "wine-11.0-wow64-x86_64-candidate"
STAGE = "a" * 64
DIRECT = "b" * 64


class RuntimeDependencyClosureEvidenceTests(unittest.TestCase):
    def fixtures(self):
        direct_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "first_hit_validation_sha256": "1" * 64,
            "loader_invariance_validation_sha256": "2" * 64,
            "dependency_inventory_sha256": DIRECT,
            "dependency_counts": {"elf_files": 2, "external_packages": 1, "external_sonames": 2},
            "first_hit_counts": {"dependencies_checked": 1, "stage_hits": 0, "rootfs_hits": 1},
            "loader_invariance_counts": {
                "staged_elf_files": 2,
                "needed_identity_soname_pairs": 1,
                "reachable_candidate_pathnames": 1,
            },
        }
        direct = {
            "$schema": "prototype-ordax.windows-compat-runtime-dependency-evidence-proof/1",
            **direct_core,
            "evidence_sha256": MODULE.canonical_sha256(direct_core),
            "gates": {
                "full_build_proof_verified": True,
                "first_pathname_hit_verified": True,
                "staged_needed_by_chain_invariance_verified": True,
                "staged_shortname_reuse_invariance_verified": True,
                "loader_resolution_verified": True,
                "staging_dependency_inventory_complete": True,
                "external_transitive_closure_verified": False,
                "runtime_dependency_inventory_complete": False,
                "runtime_package_content_hashes_pinned": False,
                "binary_artifact_pinned": False,
                "activation_authorized": False,
                "execution_authorized": False,
                "wine_executed": False,
                "windows_payload_executed": False,
            },
        }
        closure_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "direct_inventory_sha256": DIRECT,
            "roots": ["stage-internal:usr/bin/wine"],
            "nodes": {"stage-internal:usr/bin/wine": {"scope": "stage-internal"}},
            "contexts": {"c" * 64: {"consumer": "stage-internal:usr/bin/wine", "edges": []}},
            "external_packages": {"runtime-libs": {"version": "1-r0", "files": {}, "sonames": []}},
        }
        closure = {
            "$schema": "prototype-ordax.windows-compat-runtime-dependency-closure-proof/1",
            **closure_core,
            "closure_sha256": MODULE.canonical_sha256(closure_core),
            "counts": {"root_elf_files": 1, "nodes": 1, "context_states": 1, "edges": 1, "cycle_edges": 0, "external_packages": 1, "external_sonames": 1},
            "gates": {
                "full_build_proof_verified": True,
                "direct_dependency_proof_verified": True,
                "direct_loader_resolution_verified": True,
                "transitive_dt_needed_closure_complete": True,
                "dynamic_load_inventory_complete": False,
                "runtime_dependency_inventory_complete": False,
                "runtime_package_content_hashes_pinned": False,
                "binary_artifact_pinned": False,
                "activation_authorized": False,
                "execution_authorized": False,
                "wine_executed": False,
                "windows_payload_executed": False,
            },
        }
        guard_core = {
            "runtime_id": RUNTIME,
            "staging_manifest_sha256": STAGE,
            "direct_inventory_sha256": DIRECT,
            "direct_evidence_sha256": direct["evidence_sha256"],
            "closure_sha256": closure["closure_sha256"],
            "shortname_targets": {"ELF64:machine=62:little:liba.so.1": {"scope": "rootfs-external", "canonical_path": "usr/lib/liba.so.1"}},
            "counts": {"contexts_checked": 1, "edges_checked": 1, "stage_hits": 0, "rootfs_hits": 1, "identity_soname_pairs": 1},
        }
        guard = {
            "$schema": "prototype-ordax.windows-compat-runtime-closure-loader-guard-proof/1",
            **guard_core,
            "validation_sha256": MODULE.canonical_sha256(guard_core),
            "gates": {
                "direct_authoritative_evidence_verified": True,
                "closure_first_pathname_hit_verified": True,
                "closure_shortname_reuse_invariance_verified": True,
                "closure_origin_alias_context_verified": True,
                "transitive_dt_needed_loader_semantics_verified": True,
                "dynamic_load_inventory_complete": False,
                "runtime_dependency_inventory_complete": False,
                "runtime_package_content_hashes_pinned": False,
                "binary_artifact_pinned": False,
                "activation_authorized": False,
                "execution_authorized": False,
                "wine_executed": False,
                "windows_payload_executed": False,
            },
        }
        return direct, closure, guard

    def test_finalize_binds_guarded_closure_without_claiming_dynamic_inventory(self):
        result = MODULE.finalize(*self.fixtures())
        self.assertTrue(result["gates"]["external_transitive_dt_needed_closure_verified"])
        self.assertFalse(result["gates"]["external_transitive_closure_verified"])
        self.assertFalse(result["gates"]["dynamic_load_inventory_complete"])
        self.assertFalse(result["gates"]["runtime_dependency_inventory_complete"])
        self.assertFalse(result["gates"]["execution_authorized"])

    def test_finalize_rejects_tampered_closure_with_stale_digest(self):
        direct, closure, guard = self.fixtures()
        closure["roots"].append("stage-internal:tampered")
        with self.assertRaisesRegex(MODULE.ClosureEvidenceError, "raw closure digest"):
            MODULE.finalize(direct, closure, guard)

    def test_finalize_rejects_tampered_guard_with_stale_digest(self):
        direct, closure, guard = self.fixtures()
        guard["counts"]["edges_checked"] = 2
        with self.assertRaisesRegex(MODULE.ClosureEvidenceError, "closure loader guard digest"):
            MODULE.finalize(direct, closure, guard)

    def test_finalize_rejects_runtime_promotion_in_any_input(self):
        direct, closure, guard = self.fixtures()
        closure["gates"]["runtime_dependency_inventory_complete"] = True
        with self.assertRaisesRegex(MODULE.ClosureEvidenceError, "forbidden promotion"):
            MODULE.finalize(direct, closure, guard)


if __name__ == "__main__":
    unittest.main()
