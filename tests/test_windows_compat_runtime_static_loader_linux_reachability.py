import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_static_loader_linux_reachability_probe.py"
SPEC = importlib.util.spec_from_file_location("runtime_static_loader_linux_reachability_probe", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


CONFIGURE = r'''
case $host_os in
  darwin*)
    enable_winemac_drv=${enable_winemac_drv:-yes}
    ;;
  linux-android*)
    enable_wineandroid_drv=${enable_wineandroid_drv:-yes}
    ;;
esac

enable_wineandroid_drv=${enable_wineandroid_drv:-no}
enable_winemac_drv=${enable_winemac_drv:-no}

WINE_CONFIG_MAKEFILE(dlls/wineandroid.drv)
WINE_CONFIG_MAKEFILE(dlls/winemac.drv)
'''

ACLOCAL = r'''
wine_fn_config_makefile ()
{
    AS_VAR_APPEND([SUBDIRS],[" \\$as_nl\t$[1]"])
    AS_VAR_COPY([enable],[$[2]])
    case "$enable" in
      no) AS_VAR_APPEND([DISABLED_SUBDIRS],[" $[1]"]) ;;
      yes) ;;
    esac
}
AC_DEFUN([WINE_CONFIG_MAKEFILE],[
wine_fn_config_makefile [$1] ac_enable[]dnl
])
'''

ANDROID_MAKEFILE = '''MODULE = wineandroid.drv\nUNIXLIB = wineandroid.so\n'''
MAC_MAKEFILE = '''MODULE = winemac.drv\nUNIXLIB = winemac.so\n'''


class StaticLoaderLinuxReachabilityTests(unittest.TestCase):
    def contract(self):
        return MODULE.load_contract()

    def members(self, configure=CONFIGURE, aclocal=ACLOCAL):
        return {
            "configure.ac": {"text": configure, "sha256": "a" * 64, "size": len(configure)},
            "aclocal.m4": {"text": aclocal, "sha256": "b" * 64, "size": len(aclocal)},
            "dlls/wineandroid.drv/Makefile.in": {
                "text": ANDROID_MAKEFILE, "sha256": "c" * 64, "size": len(ANDROID_MAKEFILE)
            },
            "dlls/winemac.drv/Makefile.in": {
                "text": MAC_MAKEFILE, "sha256": "d" * 64, "size": len(MAC_MAKEFILE)
            },
        }

    def static_proof(self):
        records = []
        line = 10
        for rule_id, count in (
            ("android-libhardware", 1),
            ("android-libandroid", 2),
            ("android-liblog", 1),
            ("android-ntdll-bootstrap", 1),
            ("macos-opengl-framework", 1),
        ):
            for _ in range(count):
                records.append({
                    "path": "dlls/wineandroid.drv/init.c" if rule_id.startswith("android-") else "dlls/winemac.drv/opengl.c",
                    "line": line,
                    "column": 3,
                    "api": "dlopen",
                    "expression": '"target"',
                    "rule_id": rule_id,
                    "category": "fixture",
                    "host_platform": "android" if rule_id.startswith("android-") else "macos",
                })
                line += 1
        return {
            "classifications": records,
            "counts": {"static_callsites": 6},
        }

    def authority(self):
        return MODULE.source_semantics(self.members(), self.contract())

    def evaluate(self, *, host_os="linux-musl", disabled=None, stage=None, static=None):
        subdirs = ["dlls/wineandroid.drv", "dlls/winemac.drv"]
        if disabled is None:
            disabled = list(subdirs)
        if stage is None:
            stage = {"usr/bin/wine": {"type": "file", "sha256": "e" * 64}}
        if static is None:
            static = self.static_proof()
        return MODULE.evaluate_reachability(
            self.contract(), static, host_os, subdirs, disabled, stage, self.authority()
        )

    def test_source_authority_proves_host_rules_module_identity_and_disable_macro(self):
        result = self.authority()
        self.assertTrue(result["disabled_subdir_macro_verified"])
        by_id = {item["id"]: item for item in result["modules"]}
        self.assertEqual(by_id["wineandroid-driver"]["module"], "wineandroid.drv")
        self.assertEqual(by_id["wineandroid-driver"]["unixlib"], "wineandroid.so")
        self.assertEqual(by_id["winemac-driver"]["module"], "winemac.drv")
        self.assertEqual(by_id["winemac-driver"]["unixlib"], "winemac.so")
        self.assertTrue(by_id["wineandroid-driver"]["configure"]["nonmatching_host_defaults_disabled"])
        self.assertTrue(by_id["winemac-driver"]["configure"]["nonmatching_host_defaults_disabled"])

    def test_linux_musl_build_excludes_all_six_static_callsites(self):
        modules, callsites, counts = self.evaluate()
        self.assertEqual(counts["modules"], 2)
        self.assertEqual(counts["static_callsites"], 6)
        self.assertEqual(counts["reachable_static_callsites"], 0)
        self.assertEqual(counts["unreachable_host_disabled_static_callsites"], 6)
        self.assertEqual({item["reachability"] for item in modules}, {"unreachable-host-disabled"})
        self.assertEqual({item["reachability"] for item in callsites}, {"unreachable-host-disabled"})

    def test_matching_android_host_fails_closed_instead_of_marking_target_resolved(self):
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "host enables wineandroid-driver"):
            self.evaluate(host_os="linux-android26")

    def test_missing_generated_disabled_subdir_fails_closed(self):
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "not in generated DISABLED_SUBDIRS"):
            self.evaluate(disabled=["dlls/winemac.drv"])

    def test_staged_artifact_for_disabled_module_fails_closed(self):
        stage = {
            "usr/bin/wine": {"type": "file", "sha256": "e" * 64},
            "usr/lib/wine/x86_64-unix/wineandroid.so": {"type": "file", "sha256": "f" * 64},
        }
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "unexpectedly produced staged artifacts"):
            self.evaluate(stage=stage)

    def test_unknown_static_classification_rule_fails_closed(self):
        static = self.static_proof()
        static["classifications"].append({
            "path": "dlls/other/init.c", "line": 100, "api": "dlopen",
            "expression": '"other.so"', "rule_id": "unmapped-rule",
        })
        static["counts"]["static_callsites"] = 7
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "outside reachability contract"):
            self.evaluate(static=static)

    def test_configure_default_disable_drift_fails_closed(self):
        configure = CONFIGURE.replace(
            "enable_wineandroid_drv=${enable_wineandroid_drv:-no}",
            "enable_wineandroid_drv=${enable_wineandroid_drv:-yes}",
        )
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "default-disable semantics"):
            MODULE.source_semantics(self.members(configure=configure), self.contract())

    def test_disabled_subdir_macro_drift_fails_closed(self):
        aclocal = ACLOCAL.replace("AS_VAR_APPEND([DISABLED_SUBDIRS]", "AS_VAR_APPEND([IGNORED_SUBDIRS]")
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "disabled-subdir macro semantics drifted"):
            MODULE.source_semantics(self.members(aclocal=aclocal), self.contract())

    def test_make_variable_parses_continuations_and_rejects_duplicates(self):
        makefile = "SUBDIRS = \\\n  dlls/wineandroid.drv \\\n  dlls/winemac.drv\n"
        self.assertEqual(
            MODULE.make_variable(makefile, "SUBDIRS"),
            ["dlls/wineandroid.drv", "dlls/winemac.drv"],
        )
        duplicate = "DISABLED_SUBDIRS = dlls/wineandroid.drv dlls/wineandroid.drv\n"
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "contains duplicates"):
            MODULE.make_variable(duplicate, "DISABLED_SUBDIRS")

    def test_config_log_identity_requires_one_unambiguous_value(self):
        text = "host='x86_64-alpine-linux-musl'\nhost_os='linux-musl'\n"
        self.assertEqual(MODULE.config_log_value(text, "host"), "x86_64-alpine-linux-musl")
        self.assertEqual(MODULE.config_log_value(text, "host_os"), "linux-musl")
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "exactly one host_os"):
            MODULE.config_log_value("host_os='linux-musl'\nhost_os='darwin'\n", "host_os")


if __name__ == "__main__":
    unittest.main()
