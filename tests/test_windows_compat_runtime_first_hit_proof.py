import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from tests.test_windows_compat_runtime_dependency_discovery import stage_metadata, synthetic_elf32, synthetic_elf64

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_first_hit_guard.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_first_hit_proof", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def write(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def full_build_proof(stage: Path) -> dict:
    return {
        "$schema": "prototype-ordax.windows-compat-full-build-proof/2",
        "runtime_id": "wine-11.0-wow64-x86_64-candidate",
        "staging": stage_metadata(stage),
        "gates": {
            "full_build_proof_passed": True,
            "staged_install_completed": True,
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "windows_payload_executed": False,
            "wine_executed": False,
        },
    }


def preload_source_proof() -> dict:
    relation = {
        "relation_kind": MODULE.PRELOAD.DIRECT_RELATION_KIND,
        "consumer_unixlib": "unrelated-consumer.so",
        "provider_unixlib": "unrelated-provider.so",
        "link_name": "unrelated-provider",
        "consumer_module": "unrelated-consumer.dll",
        "provider_module": "unrelated-provider.dll",
        "consumer_makefile": "dlls/unrelated-consumer/Makefile.in",
        "consumer_makefile_sha256": "1" * 64,
        "provider_makefile": "dlls/unrelated-provider/Makefile.in",
        "provider_makefile_sha256": "2" * 64,
        "preload_order": MODULE.PRELOAD.PRELOAD_ORDER,
        "consumer_attach": {
            "path": "dlls/unrelated-consumer/main.c",
            "sha256": "3" * 64,
            "process_attach_unix_init_verified": True,
        },
        "provider_attach": {
            "path": "dlls/unrelated-provider/main.c",
            "sha256": "4" * 64,
            "process_attach_unix_init_verified": True,
        },
    }
    proof = {
        "$schema": MODULE.PRELOAD.PROOF_SCHEMA,
        "status": MODULE.PRELOAD.PROOF_STATUS,
        "runtime_id": "wine-11.0-wow64-x86_64-candidate",
        "source_archive_sha256": "a" * 64,
        "source_archive_member_count": 1,
        "module_makefile_count": 2,
        "module_makefile_manifest_sha256": "b" * 64,
        "loader_semantics": {"fixture": "unrelated-valid-preload-authority"},
        "relations": [relation],
        "counts": {
            "candidate_relations": 1,
            "proven_relations": 1,
            "direct_dependency_attach_relations": 1,
            "forwarder_activation_prerequisite_relations": 0,
        },
        "gates": {
            "source_archive_verified": True,
            "module_makefile_surface_bound": True,
            "normal_pe_import_dependency_semantics_verified": True,
            "dependency_attach_order_verified": True,
            "builtin_unix_path_registration_verified": True,
            "winecrt_memory_query_bridge_verified": True,
            "lazy_unixlib_dlopen_verified": True,
            "source_derived_unixlib_preload_relations_verified": True,
            "unixlib_preload_relations_runtime_verified": False,
            "dynamic_load_inventory_complete": False,
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
    proof["evidence_sha256"] = MODULE.PRELOAD.canonical_sha256(MODULE.PRELOAD.proof_core(proof))
    return proof


class RuntimeDependencyFirstHitProofTests(unittest.TestCase):
    def test_bootstrap_source_authority_matches_locked_wine_source(self):
        contract = MODULE.PROBE.load_contract()
        source = json.loads((ROOT / "bootstrap/windows-compat-runtime/source.json").read_text(encoding="utf-8"))
        authority = contract["loader_bootstrap"]["source_authority"]
        self.assertEqual(authority["source_lock"], "source.json")
        self.assertEqual(authority["source_schema"], source["$schema"])
        self.assertEqual(authority["runtime_id"], source["runtime_id"])
        self.assertEqual(authority["engine"], source["engine"])
        self.assertEqual(authority["wine_version"], source["version"])
        self.assertEqual(authority["archive_sha256"], source["upstream"]["archive_sha256"])
        self.assertEqual(authority["source_path"], "tools/wine/wine.c")

    def test_verify_emits_content_bound_non_promoting_proof(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            write(stage / "usr/bin/wine", synthetic_elf64())
            write(rootfs / "usr/lib/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            proof = full_build_proof(stage)
            result = MODULE.verify(stage, rootfs, proof, preload_source_proof())
            self.assertEqual(result["$schema"], MODULE.PROOF_SCHEMA)
            self.assertEqual(result["runtime_id"], proof["runtime_id"])
            self.assertEqual(
                result["staging_manifest_sha256"],
                proof["staging"]["canonical_manifest_sha256"],
            )
            self.assertEqual(result["counts"]["dependencies_checked"], 1)
            self.assertEqual(result["counts"]["rootfs_hits"], 1)
            self.assertEqual(result["counts"]["stage_hits"], 0)
            self.assertEqual(result["counts"]["bootstrap_shortname_hits"], 0)
            self.assertEqual(result["counts"]["dependency_attach_preload_hits"], 0)
            self.assertTrue(result["gates"]["first_pathname_hit_verified"])
            for gate in (
                "runtime_dependency_inventory_complete",
                "binary_artifact_pinned",
                "activation_authorized",
                "execution_authorized",
                "wine_executed",
                "windows_payload_executed",
            ):
                self.assertFalse(result["gates"][gate])

    def test_wine_ntdll_bootstrap_shortname_is_verified_before_path_search(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            module = write(
                stage / "usr/lib/wine/x86_64-unix/avicap32.so",
                synthetic_elf64(b"ntdll.so"),
            )
            target = write(
                stage / "usr/lib/wine/x86_64-unix/ntdll.so",
                synthetic_elf64(b"libc.so.6"),
            )
            write(rootfs / "usr/lib/libc.so.6", synthetic_elf64(b"ld-musl-x86_64.so.1"))
            proof = full_build_proof(stage)
            result = MODULE.verify(stage, rootfs, proof, preload_source_proof())
            self.assertEqual(result["counts"]["dependencies_checked"], 2)
            self.assertEqual(result["counts"]["stage_hits"], 1)
            self.assertEqual(result["counts"]["rootfs_hits"], 1)
            self.assertEqual(result["counts"]["bootstrap_shortname_hits"], 1)
            self.assertEqual(result["counts"]["dependency_attach_preload_hits"], 0)
            consumer = MODULE.PROBE.parse_elf_dynamic(module)
            bootstrap = MODULE.PROBE.resolve_bootstrap_shortname(
                stage, "ntdll.so", consumer, MODULE.PROBE.load_contract()
            )
            self.assertEqual(bootstrap["path"], target.relative_to(stage).as_posix())
            self.assertEqual(bootstrap["resolution_kind"], "bootstrap-shortname-reuse")
            self.assertIsNone(bootstrap["search_directory"])

    def test_declared_bootstrap_shortname_fails_if_exact_target_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            rootfs.mkdir()
            write(
                stage / "usr/lib/wine/x86_64-unix/avicap32.so",
                synthetic_elf64(b"ntdll.so"),
            )
            with self.assertRaisesRegex(MODULE.FirstHitGuardError, "bootstrap shortname target is missing"):
                MODULE.verify(stage, rootfs, full_build_proof(stage), preload_source_proof())

    def test_declared_bootstrap_shortname_fails_on_wrong_elf_identity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            rootfs.mkdir()
            write(
                stage / "usr/lib/wine/x86_64-unix/avicap32.so",
                synthetic_elf64(b"ntdll.so"),
            )
            write(
                stage / "usr/lib/wine/x86_64-unix/ntdll.so",
                synthetic_elf32(b"libc.so.6"),
            )
            with self.assertRaisesRegex(MODULE.FirstHitGuardError, "bootstrap shortname ELF identity mismatch"):
                MODULE.verify(stage, rootfs, full_build_proof(stage), preload_source_proof())


if __name__ == "__main__":
    unittest.main()
