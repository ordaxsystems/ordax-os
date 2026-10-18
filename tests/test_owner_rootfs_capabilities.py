#!/usr/bin/env python3
"""Regression gates for the Owner rootfs command/capability closure."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import tempfile
import tarfile
import stat
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools/ci/owner_rootfs_capabilities.py"
SPEC = importlib.util.spec_from_file_location("owner_rootfs_capabilities", MODULE)
assert SPEC is not None and SPEC.loader is not None
capabilities = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capabilities)


class OwnerRootfsCapabilitiesTest(unittest.TestCase):
    def test_inventory_is_closed_and_covers_owner_critical_commands(self) -> None:
        inventory = capabilities.owner_inventory(ROOT)
        self.assertEqual(inventory["missing_sources"], [])
        self.assertEqual(inventory["unknown_commands"], [])
        commands = set(inventory["commands"])
        self.assertTrue({
            "git", "ip", "iw", "wpa_supplicant", "wpa_cli", "wpa_passphrase",
            "udhcpc", "ntpd", "timeout", "stty", "setsid", "killall", "df",
            "tr", "wc", "mount", "pivot_root", "switch_root", "sync", "reboot",
        }.issubset(commands))

    def test_explicit_busybox_calls_are_separately_proven(self) -> None:
        inventory = capabilities.owner_inventory(ROOT)
        explicit = set(inventory["explicit_busybox_applets"])
        self.assertTrue({
            "ntpd", "timeout", "setsid", "test", "mount", "pivot_root",
            "reboot", "sync", "stat", "flock",
        }.issubset(explicit))

    def test_parser_does_not_treat_case_labels_or_options_as_commands(self) -> None:
        source = """#!/bin/sh
helper() { /bin/busybox true; }
case "$1" in
    usb|native-disk)
        /bin/busybox ntpd -q -n -p pool.ntp.org
        ;;
    reload)
        helper
        ;;
esac
for tool in iw wpa_cli; do
    command -v "$tool" >/dev/null 2>&1 || exit 1
done
/bin/busybox setsid --help >/dev/null 2>&1
"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fixture.sh"
            path.write_text(source, encoding="utf-8")
            commands = capabilities.extract_commands(path)
        self.assertTrue({"ntpd", "setsid", "true", "iw", "wpa_cli"}.issubset(commands))
        self.assertFalse({"usb", "native-disk", "reload", "--help", "helper"} & commands)

    def test_current_minimal_buildroot_is_not_mislabeled_owner_ready(self) -> None:
        result = capabilities.check_buildroot(
            ROOT / "bootstrap/independent-base/configs/ordax_minimal_defconfig",
            ROOT / "bootstrap/independent-base/configs/portable-handoff.busybox.fragment",
            ROOT,
        )
        self.assertEqual(result["status"], "missing-capabilities")
        missing_packages = set(result["missing_buildroot_program_symbols"])
        self.assertTrue({
            "BR2_PACKAGE_GIT",
            "BR2_PACKAGE_IW",
            "BR2_PACKAGE_WPA_SUPPLICANT",
            "BR2_PACKAGE_WPA_SUPPLICANT_CLI",
        }.issubset(missing_packages))
        missing_applets = set(result["missing_busybox_symbols"])
        self.assertTrue({
            "CONFIG_NTPD", "CONFIG_TEST", "CONFIG_STTY", "CONFIG_KILLALL",
            "CONFIG_UDHCPC", "CONFIG_SETSID",
        }.issubset(missing_applets))


    def test_helpers_are_manifest_owned_and_owner_sources_include_remote(self) -> None:
        inventory = capabilities.owner_inventory(ROOT)
        helpers = inventory["runtime_helpers"]
        targets = {entry["target"] for entry in helpers}
        self.assertIn("usr/local/bin/ordax-main-watch", targets)
        self.assertIn("usr/local/bin/ordax-remote", targets)
        self.assertIn("ordax/bootstrap/recovery/entrypoint", targets)
        self.assertIn(
            "bootstrap/base-update/owner-development/ordax-remote",
            inventory["sources"],
        )
        self.assertIn("sha256sum", inventory["explicit_busybox_applets"])
        self.assertEqual(len(helpers), len(targets))

    def test_manifest_rejects_duplicate_targets_and_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            manifest = root / capabilities.DEV_HELPER_MANIFEST
            manifest.parent.mkdir(parents=True)
            source = root / "bootstrap/dev-base/ordax-run"
            source.parent.mkdir(parents=True)
            source.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            good = "bootstrap/dev-base/ordax-run\tusr/local/bin/ordax-run\n"
            manifest.write_text(good, encoding="utf-8")
            self.assertEqual(
                capabilities.owner_runtime_helpers(root),
                (("bootstrap/dev-base/ordax-run", "usr/local/bin/ordax-run"),),
            )
            manifest.write_text(good + good, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "conflicting"):
                capabilities.owner_runtime_helpers(root)
            manifest.write_text(
                "bootstrap/dev-base/../ordax-run\tusr/local/bin/ordax-run\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "unsafe"):
                capabilities.owner_runtime_helpers(root)
            manifest.write_text(good, encoding="utf-8")
            source.unlink()
            source.symlink_to(root / "outside")
            with self.assertRaisesRegex(ValueError, "unsafe"):
                capabilities.owner_runtime_helpers(root)

    def test_offline_seed_materializes_every_canonical_helper(self) -> None:
        spec = importlib.util.spec_from_file_location(
            "ordax_owner_alpine_core_under_test",
            ROOT / "bootstrap/base/alpine_core.py",
        )
        assert spec is not None and spec.loader is not None
        core = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(core)
        with tempfile.TemporaryDirectory() as td:
            directory = Path(td)
            archive = directory / "kernel-modules.tar"
            with tarfile.open(archive, "w"):
                pass
            rootfs = directory / "rootfs"
            rootfs.mkdir()
            with patch.object(core, "select_dev_module_members", return_value=[]):
                core.install_runtime(rootfs, archive)
            helpers = capabilities.owner_runtime_helpers(ROOT)
            for source, target in helpers:
                staged = rootfs / target
                self.assertTrue(staged.is_file(), target)
                self.assertFalse(staged.is_symlink(), target)
                self.assertEqual(staged.read_bytes(), (ROOT / source).read_bytes(), target)
                self.assertEqual(stat.S_IMODE(staged.stat().st_mode), 0o755, target)
            self.assertEqual(
                {str(path.relative_to(rootfs)).replace("\\", "/")
                 for path in rootfs.rglob("*") if path.is_file()},
                {target for _, target in helpers},
            )

    def test_initial_alpine_seed_and_preflight_consume_canonical_manifest(self) -> None:
        core = (ROOT / "bootstrap/base/alpine_core.py").read_text(encoding="utf-8")
        preflight = (ROOT / "tools/ci/preflight_owner_dev.py").read_text(encoding="utf-8")
        self.assertIn('for helper in inventory["runtime_helpers"]:', core)
        self.assertIn('helper["source"]', core)
        self.assertIn('helper["target"]', core)
        self.assertIn("Owner helper content differs from canonical manifest", core)
        self.assertNotIn('for name in ("ordax-network", "ordax-pull"', core)
        self.assertIn('paths = owner_inventory(ROOT)["sources"]', preflight)
        self.assertNotIn("OWNER_PATHS = (", preflight)

    def test_alpine_fallback_verifier_consumes_the_same_inventory(self) -> None:
        text = (ROOT / "bootstrap/base/alpine_core.py").read_text(encoding="utf-8")
        self.assertIn("owner_rootfs_inventory()", text)
        self.assertIn('set(inventory["explicit_busybox_applets"])', text)
        self.assertIn('for command in inventory["commands"]:', text)
        self.assertIn('helper["target"] for helper in inventory["runtime_helpers"]', text)
        self.assertNotIn('"usr/local/bin/ordax-main-watch"', text)
        self.assertNotIn('required_applets = {"mount", "pivot_root", "reboot", "sync"}', text)


if __name__ == "__main__":
    unittest.main()
