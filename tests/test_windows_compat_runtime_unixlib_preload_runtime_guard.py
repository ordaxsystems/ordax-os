import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_unixlib_preload_runtime_guard.py"
SPEC = importlib.util.spec_from_file_location("runtime_unixlib_preload_runtime_guard", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

RUNTIME_ID = "wine-11.0-wow64-x86_64-candidate"


class RuntimeUnixlibPreloadRuntimeGuardTests(unittest.TestCase):
    def proof(self):
        relation = {
            "link_name": "win32u",
            "consumer_module": "opengl32.dll",
            "consumer_unixlib": "opengl32.so",
            "consumer_directory": "dlls/opengl32",
            "consumer_makefile": "dlls/opengl32/Makefile.in",
            "consumer_makefile_sha256": "1" * 64,
            "provider_module": "win32u.dll",
            "provider_unixlib": "win32u.so",
            "provider_directory": "dlls/win32u",
            "provider_makefile": "dlls/win32u/Makefile.in",
            "provider_makefile_sha256": "2" * 64,
            "consumer_attach": {"path": "dlls/opengl32/wgl.c", "sha256": "3" * 64, "process_attach_unix_init_verified": True},
            "provider_attach": {"path": "dlls/win32u/main.c", "sha256": "4" * 64, "process_attach_unix_init_verified": True},
            "preload_order": "provider-pe-dependency-attach-before-consumer-unixlib-dlopen",
        }
        core = {
            "runtime_id": RUNTIME_ID,
            "source_archive_sha256": "a" * 64,
            "source_archive_member_count": 12423,
            "module_makefile_count": 700,
            "module_makefile_manifest_sha256": "b" * 64,
            "loader_semantics": {"dependency_attach_precedes_consumer_attach": True},
            "relations": [relation],
        }
        return {
            "$schema": MODULE.PROOF_SCHEMA,
            "status": MODULE.PROOF_STATUS,
            **core,
            "evidence_sha256": MODULE.canonical_sha256(core),
            "counts": {"candidate_relations": 2, "proven_relations": 1},
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

    def test_valid_source_proof_and_runtime_provider_are_accepted(self):
        proof = self.proof()
        evidence = MODULE.validate_source_proof(proof, RUNTIME_ID)
        self.assertEqual(evidence, proof["evidence_sha256"])
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp)
            provider = stage / "usr/lib/wine/x86_64-unix/win32u.so"
            provider.parent.mkdir(parents=True)
            provider.write_bytes(b"fixture")
            consumer_elf = {"class": 64, "machine": 62, "endianness": "little"}
            result = MODULE.resolve_preloaded_unixlib(
                stage,
                "usr/lib/wine/x86_64-unix/opengl32.so",
                "win32u.so",
                consumer_elf,
                proof,
                parse_elf=lambda path: consumer_elf,
                elf_identity=lambda value: (value["class"], value["machine"], value["endianness"]),
                resolve_rooted_path=lambda root, path: path.relative_to(root).as_posix(),
            )
        self.assertEqual(result["resolution_kind"], "source-proven-dependency-attach-preload")
        self.assertEqual(result["path"], "usr/lib/wine/x86_64-unix/win32u.so")
        self.assertEqual(result["search_source"], MODULE.SEARCH_SOURCE)
        self.assertEqual(result["preload_relation"]["link_name"], "win32u")

    def test_unrelated_consumer_or_soname_is_not_a_preload_hit(self):
        proof = self.proof()
        consumer_elf = {"class": 64, "machine": 62, "endianness": "little"}
        result = MODULE.resolve_preloaded_unixlib(
            Path("/nonexistent"),
            "usr/lib/wine/x86_64-unix/other.so",
            "win32u.so",
            consumer_elf,
            proof,
            parse_elf=lambda path: consumer_elf,
            elf_identity=lambda value: (value["class"], value["machine"], value["endianness"]),
            resolve_rooted_path=lambda root, path: "unused",
        )
        self.assertIsNone(result)

    def test_relation_with_missing_staged_provider_fails_closed(self):
        proof = self.proof()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(MODULE.UnixlibPreloadRuntimeError, "missing beside consumer"):
                MODULE.resolve_preloaded_unixlib(
                    Path(tmp),
                    "usr/lib/wine/x86_64-unix/opengl32.so",
                    "win32u.so",
                    {"class": 64, "machine": 62, "endianness": "little"},
                    proof,
                    parse_elf=lambda path: None,
                    elf_identity=lambda value: (value["class"], value["machine"], value["endianness"]),
                    resolve_rooted_path=lambda root, path: "unused",
                )

    def test_provider_elf_identity_mismatch_fails_closed(self):
        proof = self.proof()
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp)
            provider = stage / "usr/lib/wine/x86_64-unix/win32u.so"
            provider.parent.mkdir(parents=True)
            provider.write_bytes(b"fixture")
            with self.assertRaisesRegex(MODULE.UnixlibPreloadRuntimeError, "ELF identity mismatch"):
                MODULE.resolve_preloaded_unixlib(
                    stage,
                    "usr/lib/wine/x86_64-unix/opengl32.so",
                    "win32u.so",
                    {"class": 64, "machine": 62, "endianness": "little"},
                    proof,
                    parse_elf=lambda path: {"class": 32, "machine": 3, "endianness": "little"},
                    elf_identity=lambda value: (value["class"], value["machine"], value["endianness"]),
                    resolve_rooted_path=lambda root, path: path.relative_to(root).as_posix(),
                )

    def test_tampered_source_evidence_fails_closed(self):
        proof = self.proof()
        proof["relations"][0]["provider_unixlib"] = "other.so"
        with self.assertRaisesRegex(MODULE.UnixlibPreloadRuntimeError, "digest does not verify"):
            MODULE.validate_source_proof(proof, RUNTIME_ID)

    def test_overclaim_gate_fails_closed_even_outside_digest(self):
        proof = self.proof()
        proof["gates"]["runtime_dependency_inventory_complete"] = True
        with self.assertRaisesRegex(MODULE.UnixlibPreloadRuntimeError, "forbidden boundary"):
            MODULE.validate_source_proof(proof, RUNTIME_ID)


if __name__ == "__main__":
    unittest.main()
