import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/wine_bootstrap_source_probe.py"
SPEC = importlib.util.spec_from_file_location("wine_bootstrap_source_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


VALID_SOURCE = r'''
#include <dlfcn.h>
static void *load_ntdll(void)
{
    const char *arch_dir = get_arch_dir( get_default_target() );
    void *handle;
    if ((handle = dlopen( strmake( "%s/wine%s/ntdll.so", libdir, arch_dir ), RTLD_NOW )))
        return handle;
    exit(1);
}
int main( int argc, char *argv[] )
{
    void (*init_func)(int, char **);
    init_func = dlsym( load_ntdll(), "__wine_main" );
    if (init_func) init_func( argc, argv );
    return 1;
}
'''


class WineBootstrapSourceProofTests(unittest.TestCase):
    def test_contract_binds_locked_source_identity(self):
        contract = MODULE.load_runtime_contract()
        source, authority = MODULE.validate_contract_binding(MODULE.SOURCE.load_source(), contract)
        self.assertEqual(authority["archive_sha256"], source["upstream"]["archive_sha256"])
        self.assertEqual(authority["source_path"], "tools/wine/wine.c")
        self.assertEqual(contract["loader_bootstrap"]["preloaded_shortnames"][0]["soname"], "ntdll.so")

    def test_source_semantics_prove_bootstrap_without_execution(self):
        behavior = MODULE.prove_source_text(VALID_SOURCE)
        self.assertEqual(
            behavior,
            {
                "load_ntdll_function_present": True,
                "installed_arch_ntdll_uses_rtld_now": True,
                "main_resolves_wine_main_from_load_ntdll": True,
            },
        )

    def test_comments_cannot_fake_semantic_anchor(self):
        source = VALID_SOURCE.replace(
            'if ((handle = dlopen( strmake( "%s/wine%s/ntdll.so", libdir, arch_dir ), RTLD_NOW )))',
            'if (handle) /* dlopen( strmake( "%s/wine%s/ntdll.so", libdir, arch_dir ), RTLD_NOW ) */',
        )
        with self.assertRaisesRegex(MODULE.WineBootstrapSourceProofError, "installed_arch_ntdll_rtld_now"):
            MODULE.prove_source_text(source)

    def test_missing_rtld_now_fails_closed(self):
        source = VALID_SOURCE.replace("RTLD_NOW", "RTLD_LAZY")
        with self.assertRaisesRegex(MODULE.WineBootstrapSourceProofError, "installed_arch_ntdll_rtld_now"):
            MODULE.prove_source_text(source)

    def test_installed_ntdll_path_drift_fails_closed(self):
        source = VALID_SOURCE.replace("%s/wine%s/ntdll.so", "%s/other%s/ntdll.so")
        with self.assertRaisesRegex(MODULE.WineBootstrapSourceProofError, "installed_arch_ntdll_rtld_now"):
            MODULE.prove_source_text(source)

    def test_wine_main_must_be_resolved_from_load_ntdll(self):
        source = VALID_SOURCE.replace('dlsym( load_ntdll(), "__wine_main" )', 'dlsym( other_handle, "__wine_main" )')
        with self.assertRaisesRegex(MODULE.WineBootstrapSourceProofError, "main_resolves_from_load_ntdll"):
            MODULE.prove_source_text(source)

    def test_anchor_text_after_main_resolution_does_not_satisfy_ordering(self):
        source = VALID_SOURCE.replace(
            'if ((handle = dlopen( strmake( "%s/wine%s/ntdll.so", libdir, arch_dir ), RTLD_NOW )))\n        return handle;',
            'if (handle) return handle;',
        )
        source += '\nvoid later(void) { dlopen( strmake( "%s/wine%s/ntdll.so", libdir, arch_dir ), RTLD_NOW ); }\n'
        with self.assertRaisesRegex(MODULE.WineBootstrapSourceProofError, "installed ntdll RTLD_NOW load is not before __wine_main"):
            MODULE.prove_source_text(source)


if __name__ == "__main__":
    unittest.main()
