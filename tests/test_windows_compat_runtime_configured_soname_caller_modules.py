import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_configured_soname_caller_module_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_configured_soname_caller_module_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ConfiguredSonameCallerModuleTests(unittest.TestCase):
    def test_contract_keeps_loader_context_and_promotion_closed(self):
        contract = MODULE.load_contract()
        self.assertEqual(contract["expected"]["configured_soname_callsites"], 32)
        self.assertEqual(contract["expected"]["configured_soname_symbols"], 24)
        self.assertEqual(contract["expected"]["caller_module_directories"], 18)
        self.assertTrue(all(value is False for value in contract["open_boundaries"].values()))
        self.assertTrue(all(value is False for value in contract["promotion"].values()))

    def test_module_dir_is_derived_strictly_from_dll_path(self):
        self.assertEqual(MODULE.module_dir_from_callsite("dlls/winex11.drv/opengl.c"), "dlls/winex11.drv")
        with self.assertRaisesRegex(MODULE.CallerModuleProofError, "outside dll module tree"):
            MODULE.module_dir_from_callsite("programs/wine/main.c")
        with self.assertRaisesRegex(MODULE.CallerModuleProofError, "outside dll module tree"):
            MODULE.module_dir_from_callsite("dlls/../loader/main.c")

    def test_makefile_authority_requires_unique_module_and_source_membership(self):
        text = """\
MODULE = winex11.drv
SOURCES = x11drv_main.c mouse.c \\
          clipboard.c
UNIX_SOURCES = opengl.c
"""
        result = MODULE.makefile_authority(
            "dlls/winex11.drv", text, {"x11drv_main.c", "mouse.c", "clipboard.c", "opengl.c"}
        )
        self.assertEqual(result["module"], "winex11.drv")
        self.assertEqual(result["translation_unit_source_variables"]["opengl.c"], ["UNIX_SOURCES"])
        self.assertEqual(result["translation_unit_source_variables"]["mouse.c"], ["SOURCES"])

    def test_translation_unit_missing_from_makefile_fails_closed(self):
        text = "MODULE = bcrypt.dll\nSOURCES = bcrypt_main.c\n"
        with self.assertRaisesRegex(MODULE.CallerModuleProofError, "translation unit gnutls.c is not listed"):
            MODULE.makefile_authority("dlls/bcrypt", text, {"gnutls.c"})

    def test_duplicate_module_definition_fails_closed(self):
        text = "MODULE = a.dll\nMODULE = b.dll\nSOURCES = a.c\n"
        with self.assertRaisesRegex(MODULE.CallerModuleProofError, "exactly one MODULE"):
            MODULE.makefile_authority("dlls/a", text, {"a.c"})

    def test_source_variable_can_be_append_assignment(self):
        text = "MODULE = kerberos.dll\nUNIX_SOURCES = unixlib.c\nUNIX_SOURCES += helper.c\n"
        result = MODULE.makefile_authority("dlls/kerberos", text, {"unixlib.c", "helper.c"})
        self.assertEqual(result["translation_unit_source_variables"]["unixlib.c"], ["UNIX_SOURCES"])
        self.assertEqual(result["translation_unit_source_variables"]["helper.c"], ["UNIX_SOURCES"])

    def test_non_source_variables_do_not_fake_translation_unit_membership(self):
        text = "MODULE = qcap.dll\nIMPORTS = v4l.c\nSOURCES = main.c\n"
        with self.assertRaisesRegex(MODULE.CallerModuleProofError, "translation unit v4l.c is not listed"):
            MODULE.makefile_authority("dlls/qcap", text, {"v4l.c"})

    def test_module_identity_rejects_whitespace_or_expansion(self):
        for value in ("foo bar.dll", "$(MODULE_NAME)"):
            text = f"MODULE = {value}\nSOURCES = main.c\n"
            with self.assertRaisesRegex(MODULE.CallerModuleProofError, "unsafe MODULE identity"):
                MODULE.makefile_authority("dlls/test", text, {"main.c"})


if __name__ == "__main__":
    unittest.main()
