from __future__ import annotations

import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/base/kernel_module_payload.py"

spec = importlib.util.spec_from_file_location("ordax_kernel_module_payload", MODULE_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load kernel module payload helper")
PAYLOAD = importlib.util.module_from_spec(spec)
spec.loader.exec_module(PAYLOAD)


class KernelModulePayloadTests(unittest.TestCase):
    def test_wifi_policy_has_one_existing_ssot(self) -> None:
        policy = PAYLOAD.load_wifi_policy()
        self.assertEqual(
            policy["module_basenames"],
            ["iwlwifi", "iwlmvm", "rtl8xxxu", "mt76x2u", "ath9k_htc"],
        )
        self.assertEqual(
            policy["coldplug_entrypoints"],
            ["iwlwifi", "rtl8xxxu", "mt76x2u", "ath9k_htc"],
        )
        self.assertRegex(policy["matrix_sha256"], r"^[0-9a-f]{64}$")

    def test_helper_is_distribution_neutral_and_has_no_second_hardware_list(self) -> None:
        text = MODULE_PATH.read_text(encoding="utf-8")
        self.assertNotIn("alpine_core", text)
        self.assertNotIn("apk add", text)
        self.assertNotIn("WIFI_MODULE_BASENAMES", text)
        self.assertIn("hardware-support-matrix.json", text)
        self.assertIn('item.get("id") == "wifi-after-base-start"', text)

    def test_modprobe_output_maps_target_root_paths_without_dependency_parser(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            release = root / "lib/modules/6.6.158"
            module = release / "kernel/drivers/net/wireless/example.ko"
            module.parent.mkdir(parents=True)
            module.write_bytes(b"module")
            selected = PAYLOAD.parse_modprobe_output(
                "insmod /lib/modules/6.6.158/kernel/drivers/net/wireless/example.ko\n",
                root,
                release,
            )
            self.assertEqual(selected, {module.resolve()})

    def test_modprobe_output_rejects_path_outside_release(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            release = root / "lib/modules/6.6.158"
            release.mkdir(parents=True)
            escaped = root / "tmp/escape.ko"
            escaped.parent.mkdir()
            escaped.write_bytes(b"module")
            with self.assertRaises(PAYLOAD.KernelModulePayloadError):
                PAYLOAD.parse_modprobe_output(
                    f"insmod {escaped}\n",
                    root,
                    release,
                )

    def test_archive_rejects_links_and_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            archive_path = root / "unsafe.tar"
            payload = root / "payload"
            payload.write_bytes(b"x")
            with tarfile.open(archive_path, "w") as archive:
                archive.add(payload, arcname="../escape")
            with tarfile.open(archive_path, "r") as archive:
                with self.assertRaises(PAYLOAD.KernelModulePayloadError):
                    PAYLOAD.validate_archive_members(archive)

            link_archive = root / "link.tar"
            with tarfile.open(link_archive, "w") as archive:
                info = tarfile.TarInfo("lib/modules/6.6.158/build")
                info.type = tarfile.SYMTYPE
                info.linkname = "/tmp"
                archive.addfile(info)
            with tarfile.open(link_archive, "r") as archive:
                with self.assertRaises(PAYLOAD.KernelModulePayloadError):
                    PAYLOAD.validate_archive_members(archive)

    def test_receipt_schema_binds_canonical_inputs(self) -> None:
        text = MODULE_PATH.read_text(encoding="utf-8")
        for marker in (
            '"$schema": "prototype-ordax.kernel-module-payload/1"',
            '"kernel_module_archive_sha256"',
            '"hardware_matrix_sha256"',
            '"requested_module_basenames"',
            '"coldplug_entrypoints"',
            '"kernel_built_here": False',
            '"network_download_used": False',
        ):
            self.assertIn(marker, text)


if __name__ == "__main__":
    unittest.main()
