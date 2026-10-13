#!/usr/bin/env python3
"""Regression tests for the clean-room kernel source/config contract."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = json.loads((ROOT / "bootstrap/kernel/source.json").read_text(encoding="utf-8"))
FRAGMENT = (ROOT / SOURCE["configuration"]["fragment"]).read_text(encoding="utf-8")


class KernelSourceContractTest(unittest.TestCase):
    def test_linux_source_identity_is_pinned(self):
        version = SOURCE["version"]
        self.assertRegex(version, r"^[0-9]+[.][0-9]+[.][0-9]+$")
        self.assertRegex(SOURCE["archive_sha256"], r"^[0-9a-f]{64}$")
        prefix = f"https://cdn.kernel.org/pub/linux/kernel/v{version.split('.')[0]}.x/"
        self.assertEqual(SOURCE["archive_url"], prefix + f"linux-{version}.tar.xz")
        self.assertEqual(SOURCE["signature_url"], prefix + f"linux-{version}.tar.sign")

    def test_laptop_power_supply_support_is_explicit(self):
        for selector in (
            "CONFIG_ACPI=y",
            "CONFIG_POWER_SUPPLY=y",
            "CONFIG_ACPI_AC=y",
            "CONFIG_ACPI_BATTERY=y",
            "CONFIG_MAGIC_SYSRQ=y",
        ):
            self.assertIn(selector + "\n", FRAGMENT, selector)

    def test_clean_fragment_has_no_old_layout_or_forge_language(self):
        for forbidden in (
            "ORDAX-PLATFORM",
            "ORDAX-HOME",
            "MISSION-",
            "Milestone",
            "Forge",
        ):
            self.assertNotIn(forbidden, FRAGMENT)

    def test_rejected_legacy_kconfig_spellings_cannot_return(self):
        self.assertNotIn("CONFIG_MT76=m", FRAGMENT)
        self.assertNotIn("CONFIG_FB_SIMPLE=y", FRAGMENT)
        self.assertNotIn("CONFIG_FIRMWARE_LOADER=y", FRAGMENT)

    def test_required_resolved_selectors_use_linux_6_6_names(self):
        for required in (
            "CONFIG_EFI_STUB=y",
            "CONFIG_EFI_PARTITION=y",
            "CONFIG_ATA=y",
            "CONFIG_ATA_PIIX=y",
            "CONFIG_SATA_AHCI=y",
            "CONFIG_BLK_DEV_NVME=y",
            "CONFIG_SCSI=y",
            "CONFIG_BLK_DEV_SD=y",
            "CONFIG_USB_STORAGE=y",
            "CONFIG_USB_UAS=y",
            "CONFIG_SYSFB_SIMPLEFB=y",
            "CONFIG_FW_LOADER=y",
            "CONFIG_WLAN_VENDOR_MEDIATEK=y",
            "CONFIG_MT76x2U=m",
            "CONFIG_IWLWIFI=m",
            "CONFIG_EXT4_FS=y",
            "CONFIG_VFAT_FS=y",
            "CONFIG_BLK_DEV_LOOP=y",
            "CONFIG_EXFAT_FS=y",
            "CONFIG_EROFS_FS=y",
            "CONFIG_EROFS_FS_ZIP=y",
            "CONFIG_OVERLAY_FS=y",
            "CONFIG_BLK_DEV_DM=y",
            "CONFIG_DM_CRYPT=y",
            "CONFIG_CRYPTO_AES=y",
            "CONFIG_CRYPTO_XTS=y",
            "CONFIG_BTRFS_FS=y",
            "CONFIG_BTRFS_FS_POSIX_ACL=y",
        ):
            self.assertIn(required, FRAGMENT)

    def test_kernel_candidate_binds_checkout_and_provenance_to_exact_pr_head(self):
        workflow = (ROOT / ".github/workflows/kernel-candidate.yml").read_text(
            encoding="utf-8"
        )
        identity = "${{ github.event.pull_request.head.sha || github.sha }}"
        self.assertIn(f"ref: {identity}", workflow)
        self.assertIn(f"ORDAX_SOURCE_COMMIT: {identity}", workflow)
        self.assertNotIn(f"GITHUB_SHA: {identity}", workflow)
        self.assertIn(f"ordax-kernel-{identity}", workflow)

        builder = (ROOT / "bootstrap/kernel/build.py").read_text(encoding="utf-8")
        self.assertIn('os.environ.get("ORDAX_SOURCE_COMMIT"', builder)
        self.assertIn("reserved GITHUB_SHA is not provenance authority", builder)
        self.assertIn('[git, "rev-parse", "HEAD"]', builder)
        self.assertNotIn('os.environ.get("GITHUB_SHA")', builder)

    def test_kernel_builder_can_verify_detached_head_without_git_binary(self):
        builder = (ROOT / "bootstrap/kernel/build.py").read_text(encoding="utf-8")
        self.assertIn("def repository_head_without_git(root: Path)", builder)
        self.assertIn('head_path = gitdir / "HEAD"', builder)
        self.assertIn('git = shutil.which("git")', builder)
        self.assertIn("actual = repository_head_without_git(ROOT)", builder)

    def test_every_kernel_build_workflow_binds_exact_source_identity(self):
        identity = "${{ github.event.pull_request.head.sha || github.sha }}"
        workflow_root = ROOT / ".github/workflows"
        offenders = []
        workflows = sorted(workflow_root.glob("*.yml")) + sorted(workflow_root.glob("*.yaml"))
        for path in workflows:
            text = path.read_text(encoding="utf-8")
            if "bootstrap/kernel/build.py build" not in text:
                continue
            if f"ref: {identity}" not in text:
                offenders.append(f"{path.name}:missing-exact-checkout")
            if f"ORDAX_SOURCE_COMMIT: {identity}" not in text:
                offenders.append(f"{path.name}:missing-source-identity")
        self.assertEqual(offenders, [])

    def test_portable_usb_v2_filesystems_are_builtin_before_release_handoff(self):
        for selector in (
            "CONFIG_BLK_DEV_LOOP=y",
            "CONFIG_EXFAT_FS=y",
            "CONFIG_EROFS_FS=y",
            "CONFIG_EROFS_FS_ZIP=y",
            "CONFIG_OVERLAY_FS=y",
            "CONFIG_EXT4_FS=y",
        ):
            self.assertIn(selector + "\n", FRAGMENT, selector)

    def test_environment_is_pinned_but_physical_use_remains_fail_closed(self):
        self.assertIsInstance(SOURCE["build"]["pinned_environment_resolved"], bool)
        self.assertFalse(SOURCE["build"]["physical_artifact_authorized"])
        if SOURCE["version"] != "6.6.52":
            self.assertEqual(SOURCE["upstream_signature"]["algorithm"], "openpgp-detached-tar")
            self.assertRegex(SOURCE["upstream_signature"]["trusted_primary_fingerprint"], r"^[0-9A-F]{40}$")


if __name__ == "__main__":
    unittest.main()
