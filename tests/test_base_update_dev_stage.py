#!/usr/bin/env python3
"""Integration regressions for development Base -> shared A/B staging."""

from __future__ import annotations

import hashlib
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system/services/base-update/dev_stage.py"
SOURCE = "c" * 40


def load_module():
    spec = spec_from_file_location("ordax_dev_stage_test", MODULE)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


dev_stage = load_module()


class DevelopmentBaseStageTests(unittest.TestCase):
    def fixture(self, root: Path):
        esp = root / "esp"
        candidates = root / "candidates"
        versions = root / "versions"
        candidate = candidates / SOURCE
        version = versions / SOURCE

        (esp / "loader/entries").mkdir(parents=True)
        (esp / "ordax/base/a").mkdir(parents=True)
        (esp / "loader/entries/ordax.conf").write_text(
            "title OrdaX Current\n"
            "linux /ordax/base/a/vmlinuz\n"
            "initrd /ordax/base/a/initrd.gz\n"
            "options console=tty0 ordax.mode=normal ordax.base_slot=a\n",
            encoding="utf-8",
        )
        (esp / "loader/entries/ordax-recovery.conf").write_text(
            "title OrdaX Recovery\n"
            "linux /ordax/base/a/vmlinuz\n"
            "initrd /ordax/base/a/initrd.gz\n"
            "options console=tty0 ordax.mode=recovery ordax.base_slot=a\n",
            encoding="utf-8",
        )
        (esp / "ordax/base/a/vmlinuz").write_bytes(b"known-good-kernel\n")
        (esp / "ordax/base/a/initrd.gz").write_bytes(b"known-good-initramfs\n")

        candidate.mkdir(parents=True)
        kernel = b"development-kernel\n"
        initramfs = b"development-initramfs\n"
        rootfs = b"development-rootfs-tar\n"
        (candidate / "vmlinuz").write_bytes(kernel)
        (candidate / "initrd.gz").write_bytes(initramfs)
        (candidate / "rootfs.tar").write_bytes(rootfs)

        def binding(name: str, payload: bytes):
            tag = f"ordax-dev-base-{SOURCE}"
            return {
                "name": name,
                "url": (
                    "https://github.com/ordaxsystems/ordax-os/"
                    f"releases/download/{tag}/{name}"
                ),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "size": len(payload),
            }

        manifest = {
            "$schema": dev_stage._channel.LEGACY_SCHEMA,
            "status": "development-candidate",
            "source_repository": dev_stage._channel.REPOSITORY,
            "source_commit": SOURCE,
            "tag": f"ordax-dev-base-{SOURCE}",
            "activation": "inactive-slot-next-boot",
            "rootfs_activation": "slot-coupled-one-shot-health-gated",
            "manual_usb_rewrite_required": False,
            "kernel": binding("vmlinuz", kernel),
            "initramfs": binding("initrd.gz", initramfs),
            "rootfs": binding("rootfs.tar", rootfs),
        }
        (candidate / "dev-base.json").write_text(
            json.dumps(manifest, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        version.mkdir(parents=True)
        for relative in dev_stage._channel.REQUIRED_ROOTFS_PATHS:
            target = version / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            target.chmod(0o755)
        for relative in (*dev_stage._channel.REQUIRED_ROOTFS_DIRS, ".ordax-base"):
            (version / relative).mkdir(parents=True, exist_ok=True)
        (version / dev_stage._channel.ROOTFS_MARKER).write_text(
            SOURCE + "\n",
            encoding="ascii",
        )
        return esp, candidates, versions, kernel, initramfs

    def test_verified_development_candidate_uses_shared_ab_stager(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, candidates, versions, kernel, initramfs = self.fixture(root)
            current_before = (esp / "loader/entries/ordax.conf").read_bytes()
            recovery_before = (esp / "loader/entries/ordax-recovery.conf").read_bytes()
            active_kernel_before = (esp / "ordax/base/a/vmlinuz").read_bytes()

            result = dev_stage.stage_ready_candidate(
                repo_root=ROOT,
                esp_root=esp,
                active_slot="a",
                candidate_root=candidates,
                version_root=versions,
                source_commit=SOURCE,
            )

            self.assertEqual(
                result["$schema"],
                "prototype-ordax.dev-base-stage-result/1",
            )
            self.assertTrue(result["candidate_manifest_verified"])
            self.assertTrue(result["versioned_rootfs_verified"])
            self.assertEqual(result["active_slot"], "a")
            self.assertEqual(result["candidate_slot"], "b")
            self.assertTrue(result["activation_ready"])
            self.assertFalse(result["activation_performed"])
            self.assertFalse(result["efi_variable_written"])
            self.assertFalse(result["reboot_requested"])
            self.assertEqual(
                (esp / "loader/entries/ordax.conf").read_bytes(),
                current_before,
            )
            self.assertEqual(
                (esp / "loader/entries/ordax-recovery.conf").read_bytes(),
                recovery_before,
            )
            self.assertEqual(
                (esp / "ordax/base/a/vmlinuz").read_bytes(),
                active_kernel_before,
            )
            self.assertEqual((esp / "ordax/base/b/vmlinuz").read_bytes(), kernel)
            self.assertEqual((esp / "ordax/base/b/initrd.gz").read_bytes(), initramfs)
            entry = (esp / "loader/entries/ordax-candidate+01-00.conf").read_text(
                encoding="utf-8"
            )
            self.assertIn("ordax.base_slot=b", entry)
            self.assertIn(f"ordax.base_candidate={SOURCE}", entry)

    def test_invalid_versioned_rootfs_blocks_before_esp_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, candidates, versions, _kernel, _initramfs = self.fixture(root)
            (versions / SOURCE / dev_stage._channel.ROOTFS_MARKER).write_text(
                "d" * 40 + "\n",
                encoding="ascii",
            )

            with self.assertRaises(dev_stage.DevStageError):
                dev_stage.stage_ready_candidate(
                    repo_root=ROOT,
                    esp_root=esp,
                    active_slot="a",
                    candidate_root=candidates,
                    version_root=versions,
                    source_commit=SOURCE,
                )

            self.assertFalse(
                (esp / "loader/entries/ordax-candidate+01-00.conf").exists()
            )
            self.assertFalse((esp / "ordax/base/b").exists())


    def test_offline_rootfs_materializes_before_shared_esp_staging(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, candidates, versions, kernel, initramfs = self.fixture(root)
            active = (esp / "loader/entries/ordax.conf").read_bytes()
            version = versions / SOURCE
            # The Windows fixture cannot represent POSIX execute mode or fsync
            # directories. Keep the real Linux gates unchanged and tested there.
            original_load = dev_stage._load

            def load_stager(path, name):
                module = original_load(path, name)
                if os.name == "nt":
                    module.fsync_directory = lambda _path: None
                return module

            with (
                mock.patch.object(dev_stage, "_load", side_effect=load_stager),
                mock.patch.object(
                    dev_stage._channel, "materialize_versioned_rootfs",
                    return_value=(version, True),
                ) as materialize,
                mock.patch.object(
                    dev_stage._channel, "verify_versioned_rootfs",
                    return_value=None,
                ),
                mock.patch.object(
                    dev_stage._channel, "resolve_published_source",
                    return_value=(
                        SOURCE, (candidates / SOURCE / "dev-base.json").read_bytes(),
                    ),
                ) as authority,
            ):
                receipt = dev_stage.stage_offline_candidate(
                    repo_root=ROOT, esp_root=esp, active_slot="a",
                    candidate_root=candidates, version_root=versions,
                    source_commit=SOURCE, requested_source_commit=SOURCE,
                )
            materialize.assert_called_once_with(
                candidates / SOURCE, SOURCE, versions,
            )
            authority.assert_called_once_with(SOURCE, ROOT)
            self.assertEqual(receipt["status"], "staged-not-activated")
            self.assertEqual(
                receipt["$schema"], "prototype-ordax.dev-base-offline-stage/1",
            )
            self.assertTrue(receipt["published_base_manifest_verified"])
            self.assertEqual(receipt["requested_source_commit"], SOURCE)
            self.assertTrue(receipt["versioned_rootfs_materialized"])
            self.assertTrue(receipt["versioned_rootfs_reused"])
            self.assertTrue(receipt["inactive_esp_candidate_staged"])
            self.assertFalse(receipt["physical_disk_identity_verified"])
            self.assertFalse(receipt["activation_performed"])
            self.assertFalse(receipt["efi_variable_written"])
            self.assertFalse(receipt["reboot_requested"])
            self.assertEqual(
                (esp / "loader/entries/ordax.conf").read_bytes(), active,
            )
            self.assertTrue(
                (esp / "loader/entries/ordax-candidate+01-00.conf").is_file()
            )
            self.assertEqual((esp / "ordax/base/b/vmlinuz").read_bytes(), kernel)
            self.assertEqual((esp / "ordax/base/b/initrd.gz").read_bytes(), initramfs)

    def test_offline_materialization_failure_cannot_stage_efi(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, candidates, versions, _kernel, _initramfs = self.fixture(root)
            current = (esp / "loader/entries/ordax.conf").read_bytes()
            with (
                mock.patch.object(
                    dev_stage._channel, "resolve_published_source",
                    return_value=(
                        SOURCE, (candidates / SOURCE / "dev-base.json").read_bytes(),
                    ),
                ),
                mock.patch.object(
                    dev_stage._channel, "materialize_versioned_rootfs",
                    side_effect=dev_stage._channel.DevBaseChannelError(
                        "candidate archive rejected",
                    ),
                ),
            ):
                with self.assertRaisesRegex(
                    dev_stage.DevStageError, "candidate archive rejected",
                ):
                    dev_stage.stage_offline_candidate(
                        repo_root=ROOT, esp_root=esp, active_slot="a",
                        candidate_root=candidates, version_root=versions,
                        source_commit=SOURCE, requested_source_commit=SOURCE,
                    )
            self.assertEqual(
                (esp / "loader/entries/ordax.conf").read_bytes(), current,
            )
            self.assertFalse(
                (esp / "loader/entries/ordax-candidate+01-00.conf").exists()
            )

    def test_offline_unpublished_manifest_blocks_before_any_write(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, candidates, versions, _kernel, _initramfs = self.fixture(root)
            original = (esp / "loader/entries/ordax.conf").read_bytes()
            with (
                mock.patch.object(
                    dev_stage._channel, "resolve_published_source",
                    return_value=(SOURCE, b'{"untrusted":"different"}'),
                ) as authority,
                mock.patch.object(
                    dev_stage._channel, "materialize_versioned_rootfs",
                ) as materialize,
            ):
                with self.assertRaisesRegex(
                    dev_stage.DevStageError, "canonical published authority",
                ):
                    dev_stage.stage_offline_candidate(
                        repo_root=ROOT, esp_root=esp, active_slot="a",
                        candidate_root=candidates, version_root=versions,
                        source_commit=SOURCE, requested_source_commit=SOURCE,
                    )
                authority.assert_called_once_with(SOURCE, ROOT)
                materialize.assert_not_called()
            self.assertEqual(
                (esp / "loader/entries/ordax.conf").read_bytes(), original,
            )
            self.assertFalse(
                (esp / "loader/entries/ordax-candidate+01-00.conf").exists()
            )

    def test_offline_stage_rejects_overlapping_esp_and_ext4_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            esp, candidates, _versions, _kernel, _initramfs = self.fixture(root)
            with mock.patch.object(
                dev_stage._channel, "materialize_versioned_rootfs",
            ) as materialize:
                with self.assertRaisesRegex(dev_stage.DevStageError, "overlap"):
                    dev_stage.stage_offline_candidate(
                        repo_root=ROOT, esp_root=esp, active_slot="a",
                        candidate_root=candidates, version_root=esp,
                        source_commit=SOURCE, requested_source_commit=SOURCE,
                    )
                materialize.assert_not_called()

if __name__ == "__main__":
    unittest.main()
