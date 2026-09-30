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
    def build_proof(self, relations, candidate):
        core = {
            "runtime_id": RUNTIME_ID,
            "source_archive_sha256": "a" * 64,
            "source_archive_member_count": 12423,
            "module_makefile_count": 700,
            "module_makefile_manifest_sha256": "b" * 64,
            "loader_semantics": {"dependency_attach_precedes_consumer_attach": True},
            "relations": relations,
        }
        return {
            "$schema": MODULE.PROOF_SCHEMA,
            "status": MODULE.PROOF_STATUS,
            **core,
            "evidence_sha256": MODULE.canonical_sha256(core),
            "counts": {
                "candidate_relations": candidate,
                "proven_relations": len(relations),
                "direct_dependency_attach_relations": sum(item.get("relation_kind") == MODULE.DIRECT_RELATION_KIND for item in relations),
                "forwarder_activation_prerequisite_relations": sum(item.get("relation_kind") == MODULE.FORWARDER_RELATION_KIND for item in relations),
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

    def proof(self):
        relation = {
            "relation_kind": MODULE.DIRECT_RELATION_KIND,
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
            "preload_order": MODULE.PRELOAD_ORDER,
        }
        return self.build_proof([relation], candidate=2)

    def forwarder_relation(self):
        return {
            "relation_kind": MODULE.FORWARDER_RELATION_KIND,
            "link_name": "win32u",
            "consumer_module": "winevulkan.dll",
            "consumer_unixlib": "winevulkan.so",
            "consumer_directory": "dlls/winevulkan",
            "consumer_makefile": "dlls/winevulkan/Makefile.in",
            "consumer_makefile_sha256": "5" * 64,
            "provider_module": "win32u.dll",
            "provider_unixlib": "win32u.so",
            "provider_directory": "dlls/win32u",
            "provider_makefile": "dlls/win32u/Makefile.in",
            "provider_makefile_sha256": "6" * 64,
            "provider_attach": {"path": "dlls/win32u/main.c", "sha256": "7" * 64, "process_attach_unix_init_verified": True},
            "activation_chain": {
                "forwarder_module": "vulkan-1.dll",
                "forwarder_makefile": "dlls/vulkan-1/Makefile.in",
                "forwarder_makefile_sha256": "8" * 64,
                "forwarder_spec": "dlls/vulkan-1/vulkan-1.spec",
                "forwarder_spec_sha256": "9" * 64,
                "forwarded_export_count": 300,
                "all_non_stub_exports_forward_to_consumer": True,
                "forwarder_attach_source": "dlls/vulkan-1/vulkan.c",
                "forwarder_attach_source_sha256": "a" * 64,
                "forwarder_process_attach_prerequisite_verified": True,
                "prerequisite_module": "user32.dll",
                "prerequisite_makefile": "dlls/user32/Makefile.in",
                "prerequisite_makefile_sha256": "b" * 64,
                "prerequisite_imports_provider": True,
                "consumer_lazy_source": "dlls/winevulkan/loader.c",
                "consumer_lazy_source_sha256": "c" * 64,
                "consumer_lazy_unix_init_verified": True,
                "consumer_lazy_once_verified": True,
            },
            "preload_order": MODULE.PRELOAD_ORDER,
        }

    def resolve(self, proof, consumer):
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp)
            provider = stage / "usr/lib/wine/x86_64-unix/win32u.so"
            provider.parent.mkdir(parents=True)
            provider.write_bytes(b"fixture")
            consumer_elf = {"class": 64, "machine": 62, "endianness": "little"}
            return MODULE.resolve_preloaded_unixlib(stage, f"usr/lib/wine/x86_64-unix/{consumer}", "win32u.so", consumer_elf, proof, parse_elf=lambda path: consumer_elf, elf_identity=lambda value: (value["class"], value["machine"], value["endianness"]), resolve_rooted_path=lambda root, path: path.relative_to(root).as_posix())

    def test_valid_direct_source_proof_and_runtime_provider_are_accepted(self):
        proof = self.proof()
        evidence = MODULE.validate_source_proof(proof, RUNTIME_ID)
        self.assertEqual(evidence, proof["evidence_sha256"])
        result = self.resolve(proof, "opengl32.so")
        self.assertEqual(result["resolution_kind"], "source-proven-dependency-attach-preload")
        self.assertEqual(result["path"], "usr/lib/wine/x86_64-unix/win32u.so")
        self.assertEqual(result["search_source"], MODULE.SEARCH_SOURCE)
        self.assertEqual(result["preload_relation"]["relation_kind"], MODULE.DIRECT_RELATION_KIND)

    def test_forwarder_prerequisite_relation_is_accepted_and_bound(self):
        relation = self.forwarder_relation()
        proof = self.build_proof([relation], candidate=1)
        MODULE.validate_source_proof(proof, RUNTIME_ID)
        result = self.resolve(proof, "winevulkan.so")
        self.assertEqual(result["resolution_kind"], "source-proven-dependency-attach-preload")
        self.assertEqual(result["preload_relation"]["relation_kind"], MODULE.FORWARDER_RELATION_KIND)
        self.assertEqual(result["preload_relation"]["provider_module"], "win32u.dll")

    def test_forwarder_relation_missing_source_prerequisite_fails_closed(self):
        relation = self.forwarder_relation()
        relation["activation_chain"]["prerequisite_imports_provider"] = False
        proof = self.build_proof([relation], candidate=1)
        with self.assertRaisesRegex(MODULE.UnixlibPreloadRuntimeError, "prerequisite is not verified"):
            MODULE.validate_source_proof(proof, RUNTIME_ID)

    def test_unrelated_consumer_or_soname_is_not_a_preload_hit(self):
        proof = self.proof()
        consumer_elf = {"class": 64, "machine": 62, "endianness": "little"}
        result = MODULE.resolve_preloaded_unixlib(Path("/nonexistent"), "usr/lib/wine/x86_64-unix/other.so", "win32u.so", consumer_elf, proof, parse_elf=lambda path: consumer_elf, elf_identity=lambda value: (value["class"], value["machine"], value["endianness"]), resolve_rooted_path=lambda root, path: "unused")
        self.assertIsNone(result)

    def test_relation_with_missing_staged_provider_fails_closed(self):
        proof = self.proof()
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(MODULE.UnixlibPreloadRuntimeError, "missing beside consumer"):
                MODULE.resolve_preloaded_unixlib(Path(tmp), "usr/lib/wine/x86_64-unix/opengl32.so", "win32u.so", {"class": 64, "machine": 62, "endianness": "little"}, proof, parse_elf=lambda path: None, elf_identity=lambda value: (value["class"], value["machine"], value["endianness"]), resolve_rooted_path=lambda root, path: "unused")

    def test_provider_elf_identity_mismatch_fails_closed(self):
        proof = self.proof()
        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp)
            provider = stage / "usr/lib/wine/x86_64-unix/win32u.so"
            provider.parent.mkdir(parents=True)
            provider.write_bytes(b"fixture")
            with self.assertRaisesRegex(MODULE.UnixlibPreloadRuntimeError, "ELF identity mismatch"):
                MODULE.resolve_preloaded_unixlib(stage, "usr/lib/wine/x86_64-unix/opengl32.so", "win32u.so", {"class": 64, "machine": 62, "endianness": "little"}, proof, parse_elf=lambda path: {"class": 32, "machine": 3, "endianness": "little"}, elf_identity=lambda value: (value["class"], value["machine"], value["endianness"]), resolve_rooted_path=lambda root, path: path.relative_to(root).as_posix())

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
