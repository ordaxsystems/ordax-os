import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_unixlib_preload_source_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_unixlib_preload_source_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class RuntimeUnixlibPreloadSourceTests(unittest.TestCase):
    def module_record(self, *, path, module, unixlib=None, importlib=None, imports="", unix_libs=""):
        directory = str(Path(path).parent).replace("\\", "/")
        values = {"MODULE": module}
        if unixlib:
            values["UNIXLIB"] = unixlib
        if importlib:
            values["IMPORTLIB"] = importlib
        if imports:
            values["IMPORTS"] = imports
        if unix_libs:
            values["UNIX_LIBS"] = unix_libs
        return {"path": path, "sha256": "a" * 64, "size": 100, "values": values, "module": module, "unixlib": unixlib, "importlib": importlib, "directory": directory}

    def test_contract_is_source_only_and_fail_closed(self):
        contract = MODULE.load_contract()
        self.assertEqual(contract["status"], "source-derived-dependency-attach-unixlib-preloads-not-runtime-complete")
        self.assertTrue(contract["derivation"]["consumer_normal_pe_import_required"])
        self.assertTrue(contract["derivation"]["consumer_unix_link_flag_required"])
        self.assertTrue(contract["derivation"]["dependency_attach_precedes_consumer_attach_required"])
        self.assertTrue(contract["derivation"]["forwarder_activation_prerequisite_required"])
        self.assertTrue(contract["derivation"]["comments_must_not_satisfy_source_anchors"])
        self.assertEqual(len(contract["source_authority"]["forwarder_activation_prerequisites"]), 1)
        self.assertTrue(all(value is False for value in contract["promotion"].values()))

    def test_makefile_parser_handles_continuations_and_append(self):
        values = MODULE.parse_makefile("MODULE = opengl32.dll\nUNIXLIB = opengl32.so\nIMPORTS = user32 gdi32 \\\n  win32u\nUNIX_LIBS = -lm\nUNIX_LIBS += -lwin32u\n")
        self.assertEqual(values["MODULE"], "opengl32.dll")
        self.assertEqual(values["UNIXLIB"], "opengl32.so")
        self.assertEqual(values["IMPORTS"].split(), ["user32", "gdi32", "win32u"])
        self.assertEqual(values["UNIX_LIBS"].split(), ["-lm", "-lwin32u"])

    def test_direct_relation_still_requires_normal_import_and_unix_link(self):
        consumer = self.module_record(path="dlls/opengl32/Makefile.in", module="opengl32.dll", unixlib="opengl32.so", imports="user32 gdi32 win32u", unix_libs="-lm -lwin32u")
        provider = self.module_record(path="dlls/win32u/Makefile.in", module="win32u.dll", unixlib="win32u.so", importlib="win32u", imports="ntdll")
        relations = MODULE.derive_candidate_relations({consumer["path"]: consumer, provider["path"]: provider})
        self.assertEqual(len(relations), 1)
        self.assertEqual(relations[0]["relation_kind"], MODULE.DIRECT_RELATION_KIND)
        self.assertEqual(relations[0]["consumer_unixlib"], "opengl32.so")
        self.assertEqual(relations[0]["provider_unixlib"], "win32u.so")
        no_import = dict(consumer)
        no_import["values"] = dict(consumer["values"], IMPORTS="user32 gdi32")
        self.assertEqual(MODULE.derive_candidate_relations({no_import["path"]: no_import, provider["path"]: provider}), [])

    def test_attach_init_evidence_requires_process_attach_case(self):
        sources = {"dlls/win32u/main.c": {"text": "BOOL DllMain(void *m, unsigned reason, void *r) { switch(reason) { case DLL_PROCESS_ATTACH: if (!__wine_init_unix_call()) return TRUE; case DLL_PROCESS_DETACH: return TRUE; } }", "sha256": "b" * 64}}
        evidence = MODULE.attach_init_evidence("dlls/win32u", sources)
        self.assertEqual(evidence["path"], "dlls/win32u/main.c")
        self.assertTrue(evidence["process_attach_unix_init_verified"])

    def test_comment_only_process_attach_init_does_not_create_evidence(self):
        sources = {"dlls/win32u/main.c": {"text": "BOOL DllMain(void) { /* case DLL_PROCESS_ATTACH: __wine_init_unix_call(); */ return TRUE; }", "sha256": "b" * 64}}
        self.assertIsNone(MODULE.attach_init_evidence("dlls/win32u", sources))

    def test_duplicate_attach_sources_fail_closed(self):
        text = "switch(reason) { case DLL_PROCESS_ATTACH: __wine_init_unix_call(); case DLL_PROCESS_DETACH: break; }"
        sources = {"dlls/example/a.c": {"text": text, "sha256": "a" * 64}, "dlls/example/b.c": {"text": text, "sha256": "b" * 64}}
        with self.assertRaisesRegex(MODULE.UnixlibPreloadSourceError, "ambiguous process-attach unix init"):
            MODULE.attach_init_evidence("dlls/example", sources)

    def activation_fixture(self):
        consumer = self.module_record(path="dlls/winevulkan/Makefile.in", module="winevulkan.dll", unixlib="winevulkan.so", importlib="winevulkan", imports="advapi32", unix_libs="-lwin32u $(PTHREAD_LIBS)")
        provider = self.module_record(path="dlls/win32u/Makefile.in", module="win32u.dll", unixlib="win32u.so", importlib="win32u", imports="ntdll")
        forwarder = self.module_record(path="dlls/vulkan-1/Makefile.in", module="vulkan-1.dll", imports="user32", importlib="vulkan-1")
        prerequisite = self.module_record(path="dlls/user32/Makefile.in", module="user32.dll", importlib="user32", imports="gdi32 win32u")
        modules = {item["path"]: item for item in (consumer, provider, forwarder, prerequisite)}
        sources = {
            "dlls/vulkan-1/vulkan-1.spec": {"text": "@ stdcall vkCreateInstance(ptr ptr ptr) winevulkan.vkCreateInstance\n@ stub vkDisplayStub\n", "sha256": "1" * 64},
            "dlls/vulkan-1/vulkan.c": {"text": "BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, void *reserved) { if (reason != DLL_PROCESS_ATTACH) return TRUE; DisableThreadLibraryCalls(hinst); GetDpiForSystem(); return TRUE; }", "sha256": "2" * 64},
            "dlls/winevulkan/loader.c": {"text": "static BOOL WINAPI wine_vk_init(INIT_ONCE *once, void *param, void **context) { return !__wine_init_unix_call() && !UNIX_CALL(init, &params); } static BOOL wine_vk_init_once(void) { static INIT_ONCE init_once = INIT_ONCE_STATIC_INIT; return InitOnceExecuteOnce(&init_once, wine_vk_init, NULL, NULL); }", "sha256": "3" * 64},
            "dlls/win32u/main.c": {"text": "BOOL DllMain(void *m, unsigned reason, void *r) { switch(reason) { case DLL_PROCESS_ATTACH: __wine_init_unix_call(); break; case DLL_PROCESS_DETACH: break; } return TRUE; }", "sha256": "4" * 64},
        }
        authority = {
            "consumer_module": "winevulkan.dll", "consumer_unixlib": "winevulkan.so", "consumer_makefile": "dlls/winevulkan/Makefile.in",
            "provider_importlib": "win32u", "provider_module": "win32u.dll", "provider_unixlib": "win32u.so", "provider_makefile": "dlls/win32u/Makefile.in",
            "forwarder_module": "vulkan-1.dll", "forwarder_makefile": "dlls/vulkan-1/Makefile.in", "forwarder_spec": "dlls/vulkan-1/vulkan-1.spec", "forwarder_target_prefix": "winevulkan.",
            "forwarder_attach_source": "dlls/vulkan-1/vulkan.c", "forwarder_attach_call": "GetDpiForSystem();",
            "prerequisite_importlib": "user32", "prerequisite_module": "user32.dll", "prerequisite_makefile": "dlls/user32/Makefile.in",
            "consumer_lazy_source": "dlls/winevulkan/loader.c", "consumer_lazy_init_fragment": "return !__wine_init_unix_call() && !UNIX_CALL(init, &params);", "consumer_lazy_once_fragment": "return InitOnceExecuteOnce(&init_once, wine_vk_init, NULL, NULL);"
        }
        return authority, modules, sources

    def test_forwarder_activation_relation_proves_lazy_consumer_prerequisite(self):
        authority, modules, sources = self.activation_fixture()
        relation = MODULE.prove_forwarder_activation_relation(authority, modules, sources)
        self.assertEqual(relation["relation_kind"], MODULE.FORWARDER_RELATION_KIND)
        self.assertEqual(relation["consumer_unixlib"], "winevulkan.so")
        self.assertEqual(relation["provider_unixlib"], "win32u.so")
        self.assertTrue(relation["activation_chain"]["all_non_stub_exports_forward_to_consumer"])
        self.assertTrue(relation["activation_chain"]["prerequisite_imports_provider"])
        self.assertTrue(relation["activation_chain"]["consumer_lazy_unix_init_verified"])

    def test_forwarder_activation_relation_rejects_wrong_forward_target(self):
        authority, modules, sources = self.activation_fixture()
        sources["dlls/vulkan-1/vulkan-1.spec"] = {**sources["dlls/vulkan-1/vulkan-1.spec"], "text": "@ stdcall vkCreateInstance(ptr ptr ptr) other.vkCreateInstance\n"}
        with self.assertRaisesRegex(MODULE.UnixlibPreloadSourceError, "escapes expected target"):
            MODULE.prove_forwarder_activation_relation(authority, modules, sources)

    def test_forwarder_activation_relation_rejects_missing_prerequisite_import(self):
        authority, modules, sources = self.activation_fixture()
        modules["dlls/user32/Makefile.in"]["values"]["IMPORTS"] = "gdi32"
        with self.assertRaisesRegex(MODULE.UnixlibPreloadSourceError, "lacks required IMPORTS token"):
            MODULE.prove_forwarder_activation_relation(authority, modules, sources)


if __name__ == "__main__":
    unittest.main()
