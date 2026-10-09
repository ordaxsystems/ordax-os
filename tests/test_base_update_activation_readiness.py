#!/usr/bin/env python3
"""Regress the development Base activation-readiness boundary."""

from __future__ import annotations

import hashlib
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system/services/base-update/dev_activation_readiness.py"
AGENT = ROOT / "system/services/base-update/agent.sh"
CONTRACT = json.loads(
    (ROOT / "docs/contracts/base-update.json").read_text(encoding="utf-8")
)
SOURCE = "d" * 40


def load_module():
    spec = spec_from_file_location("ordax_activation_readiness_test", MODULE)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


readiness = load_module()


class DevelopmentActivationReadinessTests(unittest.TestCase):
    def fixture(self, root: Path):
        candidates = root / "candidates"
        versions = root / "versions"
        candidate = candidates / SOURCE
        version = versions / SOURCE
        candidate.mkdir(parents=True)
        version.mkdir(parents=True)

        kernel = b"activation-readiness-kernel\n"
        initramfs = b"activation-readiness-initramfs\n"
        rootfs = b"activation-readiness-rootfs\n"

        for name, payload in (
            ("vmlinuz", kernel),
            ("initrd.gz", initramfs),
            ("rootfs.tar", rootfs),
        ):
            (candidate / name).write_bytes(payload)

        tag = f"ordax-dev-base-{SOURCE}"

        def binding(name: str, payload: bytes):
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
            "$schema": readiness._channel.SCHEMA,
            "status": "development-candidate",
            "source_repository": readiness._channel.REPOSITORY,
            "source_commit": SOURCE,
            "tag": tag,
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

        for relative in readiness._channel.REQUIRED_ROOTFS_PATHS:
            target = version / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            target.chmod(0o755)
        for relative in (*readiness._channel.REQUIRED_ROOTFS_DIRS, ".ordax-base"):
            (version / relative).mkdir(parents=True, exist_ok=True)
        (version / readiness._channel.ROOTFS_MARKER).write_text(
            SOURCE + "\n",
            encoding="ascii",
        )

        staged = root / "dev-base-staged-sha"
        staged.write_text(SOURCE + "\n", encoding="ascii")
        stage_result = root / "dev-base-stage-result.json"
        stage_result.write_text(
            json.dumps(
                {
                    "$schema": "prototype-ordax.dev-base-physical-stage/1",
                    "status": "staged",
                    "source_commit": SOURCE,
                    "active_slot": "legacy",
                    "candidate_slot": "b",
                    "candidate_manifest_verified": True,
                    "versioned_rootfs_verified": True,
                    "activation_ready": True,
                    "activation_performed": False,
                    "efi_variable_written": False,
                    "reboot_requested": False,
                }
            )
            + "\n",
            encoding="utf-8",
        )
        return candidates, versions, staged, stage_result, manifest

    def test_exact_staged_candidate_becomes_readiness_evidence_not_authority(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidates, versions, staged, stage_result, manifest = self.fixture(root)
            layout = {
                "layout": "legacy",
                "stage_active_slot": "legacy",
                "active_slot": "legacy",
                "recovery_slot": "legacy",
                "candidate_entry_present": True,
                "candidate_slot": "b",
                "candidate_release_sha": SOURCE,
            }

            with (
                mock.patch.object(
                    readiness._readonly,
                    "readonly_preflight",
                    return_value={"layout": layout, "esp_device": "/dev/fake-esp"},
                ),
                mock.patch.object(
                    readiness._physical_stage._discovery,
                    "discover_esp",
                    return_value={"esp_device": "/dev/fake-esp"},
                ),
                mock.patch.object(
                    readiness._readonly,
                    "_run_mount_command",
                    return_value=None,
                ),
                mock.patch.object(
                    readiness._physical_stage._layout,
                    "inspect_layout",
                    return_value=layout,
                ),
                mock.patch.object(
                    readiness._physical_stage,
                    "_sha256",
                    side_effect=[
                        manifest["kernel"]["sha256"],
                        manifest["initramfs"]["sha256"],
                    ],
                ),
                mock.patch.object(
                    readiness._readonly,
                    "_mount_record",
                    return_value=None,
                ),
            ):
                result = readiness.activation_readiness(
                    root_source=Path("/dev/fake-root"),
                    mount_root=root / "mount",
                    candidate_root=candidates,
                    version_root=versions,
                    source_commit=SOURCE,
                    staged_sha_file=staged,
                    stage_result_file=stage_result,
                )

            self.assertEqual(
                result["$schema"],
                "prototype-ordax.dev-base-activation-readiness/1",
            )
            self.assertEqual(result["status"], "ready")
            self.assertTrue(result["ready_for_activation_gate"])
            self.assertTrue(result["persisted_stage_result_verified"])
            self.assertTrue(result["live_esp_candidate_verified"])
            self.assertTrue(result["live_kernel_hash_verified"])
            self.assertTrue(result["live_initramfs_hash_verified"])
            self.assertFalse(result["activation_authorized"])
            self.assertFalse(result["runtime_activation_wiring_enabled"])
            self.assertFalse(result["efi_variable_written"])
            self.assertFalse(result["reboot_requested"])
            self.assertEqual(
                result["blocker"],
                "runtime-activation-wiring-disabled",
            )

    def test_staged_sha_mismatch_blocks_before_live_esp_access(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            candidates, versions, staged, stage_result, _manifest = self.fixture(root)
            staged.write_text("e" * 40 + "\n", encoding="ascii")

            with mock.patch.object(
                readiness._readonly,
                "readonly_preflight",
                side_effect=AssertionError("mismatch must block before ESP access"),
            ):
                with self.assertRaisesRegex(
                    readiness.ActivationReadinessError,
                    "staged SHA does not match",
                ):
                    readiness.activation_readiness(
                        root_source=Path("/dev/fake-root"),
                        mount_root=root / "mount",
                        candidate_root=candidates,
                        version_root=versions,
                        source_commit=SOURCE,
                        staged_sha_file=staged,
                        stage_result_file=stage_result,
                    )

    def test_contract_and_owner_keep_readiness_non_authoritative(self):
        gate = CONTRACT["activation"]["readiness"]
        self.assertTrue(gate["owner_readiness_wiring_enabled"])
        self.assertFalse(gate["readiness_authorizes_activation"])
        self.assertFalse(gate["runtime_activation_wiring_enabled"])
        self.assertFalse(gate["efi_variable_written"])
        self.assertFalse(gate["reboot_requested"])

        agent = AGENT.read_text(encoding="utf-8")
        self.assertIn("prepare_dev_base_activation_readiness()", agent)
        self.assertIn(
            "DEV_BASE_ACTIVATION_READINESS_FILE=$HOST_STATE_ROOT/base-update/dev-base-activation-readiness.json",
            agent,
        )
        self.assertIn(
            "DEV_BASE_ACTIVATION_READINESS_SHA_FILE=$HOST_STATE_ROOT/base-update/dev-base-activation-readiness-sha",
            agent,
        )
        self.assertIn(
            "helper=/srv/ordax-system/services/base-update/dev_activation_readiness.py",
            agent,
        )
        loop = agent.split("while :; do", 1)[1]
        self.assertLess(
            loop.index("prepare_dev_base_physical_stage"),
            loop.index("prepare_dev_base_activation_readiness"),
        )
        fn = agent.split("prepare_dev_base_activation_readiness() {", 1)[1].split(
            "\n}",
            1,
        )[0]
        self.assertNotIn("activate.py", fn)
        self.assertNotIn("LoaderEntryOneShot", fn)
        self.assertNotIn("/sys/firmware/efi/efivars", fn)
        self.assertNotIn("reboot -f", fn)
        self.assertNotIn("busybox reboot", fn)
        self.assertNotIn("power-request", fn)


if __name__ == "__main__":
    unittest.main()
