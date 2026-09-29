import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

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

    def full_build_fixture(self):
        source = MODULE.BUILD.validate_source(MODULE.BUILD.load_source())
        gates = {
            "source_lock_verified": True,
            "version_lock_verified": True,
            "apk_content_lock_verified": True,
            "offline_content_replay_passed": True,
            "proot_full_build_rejected_by_diagnostic": True,
            "locked_rootfs_container_imported": True,
            "container_network_disabled": True,
            "container_rootfs_read_only": True,
            "container_capabilities_dropped": True,
            "compiler_execution_reproven_inside_container": True,
            "configure_completed": True,
            "generated_idl_header_barrier_completed": True,
            "full_build_proof_passed": True,
            "staged_install_completed": True,
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        }
        full = {
            "$schema": "prototype-ordax.windows-compat-full-build-proof/2",
            "status": "full-build-proven-in-locked-container-staged-not-runtime-pinned-not-executable",
            "runtime_id": source["runtime_id"],
            "wine_version": source["version"],
            "source_archive_sha256": source["upstream"]["archive_sha256"],
            "compiler": {"triplet": "x86_64-alpine-linux-musl"},
            "staging": {
                "entry_count": 1,
                "regular_file_count": 1,
                "symlink_count": 0,
                "total_regular_bytes": 123,
                "canonical_manifest_sha256": "f" * 64,
            },
            "gates": gates,
        }
        inputs = (
            {"runtime_id": source["runtime_id"]},
            {"configure": {"native_compiler_triplet": "x86_64-alpine-linux-musl"}},
            {},
            {"native": {"triplet": "x86_64-alpine-linux-musl"}},
        )
        manifest = {"usr/bin/wine": {"type": "file", "sha256": "e" * 64}}
        return source, full, inputs, manifest

    def validate_full_build_fixture(self, full):
        source, _, inputs, manifest = self.full_build_fixture()
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(MODULE.FULL, "load_inputs", return_value=inputs), \
             patch.object(MODULE.FULL, "staging_manifest", return_value=(manifest, 123)), \
             patch.object(MODULE.FULL, "canonical_manifest_sha256", return_value="f" * 64):
            return MODULE.validate_full_build(full, source, Path(tmp))

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
        self.assertEqual(MODULE.config_log_value("host=x86_64-alpine-linux-musl\n", "host"), "x86_64-alpine-linux-musl")
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "exactly one host_os"):
            MODULE.config_log_value("host_os='linux-musl'\nhost_os='darwin'\n", "host_os")

    def test_full_build_exact_gate_set_is_accepted(self):
        _, full, _, _ = self.full_build_fixture()
        digest, triplet, manifest = self.validate_full_build_fixture(full)
        self.assertEqual(digest, "f" * 64)
        self.assertEqual(triplet, "x86_64-alpine-linux-musl")
        self.assertEqual(set(manifest), {"usr/bin/wine"})

    def test_full_build_missing_gate_fails_closed(self):
        _, full, _, _ = self.full_build_fixture()
        del full["gates"]["generated_idl_header_barrier_completed"]
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "full-build gate set drifted"):
            self.validate_full_build_fixture(full)

    def test_full_build_unexpected_gate_fails_closed(self):
        _, full, _, _ = self.full_build_fixture()
        full["gates"]["runtime_package_content_hashes_pinned"] = True
        with self.assertRaisesRegex(MODULE.StaticLoaderReachabilityError, "full-build gate set drifted"):
            self.validate_full_build_fixture(full)


if __name__ == "__main__":
    unittest.main()
