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
        return {
            "path": path,
            "sha256": "a" * 64,
            "size": 100,
            "values": values,
            "module": module,
            "unixlib": unixlib,
            "importlib": importlib,
            "directory": directory,
        }

    def test_contract_is_source_only_and_fail_closed(self):
        contract = MODULE.load_contract()
        self.assertEqual(contract["status"], "source-derived-dependency-attach-unixlib-preloads-not-runtime-complete")
        self.assertTrue(contract["derivation"]["consumer_normal_pe_import_required"])
        self.assertTrue(contract["derivation"]["consumer_unix_link_flag_required"])
        self.assertTrue(contract["derivation"]["dependency_attach_precedes_consumer_attach_required"])
        self.assertTrue(contract["derivation"]["comments_must_not_satisfy_source_anchors"])
        self.assertTrue(all(value is False for value in contract["promotion"].values()))

    def test_makefile_parser_handles_continuations_and_append(self):
        values = MODULE.parse_makefile(
            "MODULE = opengl32.dll\n"
            "UNIXLIB = opengl32.so\n"
            "IMPORTS = user32 gdi32 \\\n  win32u\n"
            "UNIX_LIBS = -lm\n"
            "UNIX_LIBS += -lwin32u\n"
        )
        self.assertEqual(values["MODULE"], "opengl32.dll")
        self.assertEqual(values["UNIXLIB"], "opengl32.so")
        self.assertEqual(values["IMPORTS"].split(), ["user32", "gdi32", "win32u"])
        self.assertEqual(values["UNIX_LIBS"].split(), ["-lm", "-lwin32u"])

    def test_relation_requires_normal_import_and_unix_link_and_provider(self):
        consumer = self.module_record(
            path="dlls/opengl32/Makefile.in",
            module="opengl32.dll",
            unixlib="opengl32.so",
            imports="user32 gdi32 win32u",
            unix_libs="-lm -lwin32u",
        )
        provider = self.module_record(
            path="dlls/win32u/Makefile.in",
            module="win32u.dll",
            unixlib="win32u.so",
            importlib="win32u",
            imports="ntdll",
        )
        relations = MODULE.derive_candidate_relations({consumer["path"]: consumer, provider["path"]: provider})
        self.assertEqual(len(relations), 1)
        self.assertEqual(relations[0]["consumer_unixlib"], "opengl32.so")
        self.assertEqual(relations[0]["provider_unixlib"], "win32u.so")
        self.assertEqual(relations[0]["link_name"], "win32u")

        no_import = dict(consumer)
        no_import["values"] = dict(consumer["values"], IMPORTS="user32 gdi32")
        self.assertEqual(
            MODULE.derive_candidate_relations({no_import["path"]: no_import, provider["path"]: provider}),
            [],
        )

    def test_attach_init_evidence_requires_process_attach_case(self):
        sources = {
            "dlls/win32u/main.c": {
                "text": "BOOL DllMain(void *m, unsigned reason, void *r) { switch(reason) { case DLL_PROCESS_ATTACH: if (!__wine_init_unix_call()) return TRUE; case DLL_PROCESS_DETACH: return TRUE; } }",
                "sha256": "b" * 64,
            }
        }
        evidence = MODULE.attach_init_evidence("dlls/win32u", sources)
        self.assertEqual(evidence["path"], "dlls/win32u/main.c")
        self.assertTrue(evidence["process_attach_unix_init_verified"])

    def test_comment_only_process_attach_init_does_not_create_evidence(self):
        sources = {
            "dlls/win32u/main.c": {
                "text": "BOOL DllMain(void) { /* case DLL_PROCESS_ATTACH: __wine_init_unix_call(); */ return TRUE; }",
                "sha256": "b" * 64,
            }
        }
        self.assertIsNone(MODULE.attach_init_evidence("dlls/win32u", sources))

    def test_duplicate_attach_sources_fail_closed(self):
        text = "switch(reason) { case DLL_PROCESS_ATTACH: __wine_init_unix_call(); case DLL_PROCESS_DETACH: break; }"
        sources = {
            "dlls/example/a.c": {"text": text, "sha256": "a" * 64},
            "dlls/example/b.c": {"text": text, "sha256": "b" * 64},
        }
        with self.assertRaisesRegex(MODULE.UnixlibPreloadSourceError, "ambiguous process-attach unix init"):
            MODULE.attach_init_evidence("dlls/example", sources)


if __name__ == "__main__":
    unittest.main()
