from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / "bootstrap/base/firmware_policy.py"
spec = importlib.util.spec_from_file_location("ordax_firmware_policy", POLICY_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError("cannot load firmware policy")
POLICY = importlib.util.module_from_spec(spec)
spec.loader.exec_module(POLICY)


class NeutralFirmwarePolicyTests(unittest.TestCase):
    def make_rootfs(self, root: Path, *, with_firmware: bool) -> Path:
        module = root / "lib/modules/6.6.158/kernel/drivers/net/wireless/example.ko"
        module.parent.mkdir(parents=True)
        module.write_bytes(b"fixture\x00firmware=vendor/example.bin\x00")
        firmware = root / "lib/firmware/vendor/example.bin"
        firmware.parent.mkdir(parents=True)
        if with_firmware:
            firmware.write_bytes(b"firmware-fixture")
        return root

    def test_coverage_receipt_binds_declared_firmware_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.make_rootfs(Path(raw), with_firmware=True)
            receipt = POLICY.coverage_receipt(root, log_prefix="ORDAX_TEST")
            self.assertEqual(receipt["$schema"], "prototype-ordax.firmware-coverage/1")
            self.assertEqual(receipt["status"], "kernel-declarations-covered")
            self.assertEqual(receipt["selected_firmware_count"], 1)
            self.assertEqual(receipt["files"][0]["name"], "vendor/example.bin")
            self.assertRegex(receipt["files"][0]["sha256"], r"^[0-9a-f]{64}$")
            self.assertFalse(receipt["firmware_downloaded_by_policy"])

    def test_missing_firmware_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.make_rootfs(Path(raw), with_firmware=False)
            with self.assertRaises(POLICY.FirmwareSelectionError):
                POLICY.coverage_receipt(root, log_prefix="ORDAX_TEST")

    def test_unsafe_firmware_declaration_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            module = root / "lib/modules/6.6.158/example.ko"
            module.parent.mkdir(parents=True)
            module.write_bytes(b"fixture\x00firmware=../../escape.bin\x00")
            (root / "lib/firmware").mkdir(parents=True)
            with self.assertRaises(POLICY.FirmwareSelectionError):
                POLICY.module_firmware_declarations(root)

    def test_policy_is_distribution_neutral_and_does_not_acquire_firmware(self) -> None:
        text = POLICY_PATH.read_text(encoding="utf-8").lower()
        self.assertNotIn("alpine base", text)
        self.assertNotIn("apk add", text)
        self.assertNotIn("urlopen", text)
        self.assertIn("distribution-neutral", text)

    def test_owner_prune_keeps_every_available_declared_blob_and_required_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.make_rootfs(Path(raw), with_firmware=True)
            firmware = root / "lib/firmware"
            (firmware / "unused" / "large.bin").parent.mkdir(parents=True)
            (firmware / "unused" / "large.bin").write_bytes(b"x" * 4096)
            (firmware / "regulatory.db").write_bytes(b"signed-regdb")
            (firmware / "regulatory.db.p7s").write_bytes(b"signature")
            (firmware / "LICENCE.vendor").write_text("license", encoding="ascii")

            result = POLICY.prune_unreferenced_firmware(root)

            self.assertEqual(result["removed_files"], 1)
            self.assertEqual(result["removed_bytes"], 4096)
            self.assertEqual(result["firmware_bytes_after"], 44)
            self.assertFalse((firmware / "unused/large.bin").exists())
            receipt = POLICY.coverage_receipt(root, log_prefix="ORDAX_TEST")
            self.assertEqual(receipt["selected_firmware_count"], 1)
            self.assertTrue((firmware / "regulatory.db").is_file())
            self.assertTrue((firmware / "regulatory.db.p7s").is_file())
            self.assertTrue((firmware / "LICENCE.vendor").is_file())

    def test_owner_prune_preserves_compressed_symlink_target(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.make_rootfs(Path(raw), with_firmware=False)
            firmware = root / "lib/firmware/vendor"
            compressed = firmware / "example.bin.zst"
            compressed.write_bytes(b"compressed-firmware")
            link = firmware / "example.bin"
            try:
                link.symlink_to("example.bin.zst")
            except OSError as exc:
                self.skipTest(f"symlink creation is unavailable: {exc}")
            (firmware / "unused.bin").write_bytes(b"unused")

            result = POLICY.prune_unreferenced_firmware(root)

            self.assertEqual(result["removed_files"], 1)
            self.assertTrue(link.is_symlink())
            self.assertEqual(POLICY.resolve_firmware_source(root / "lib/firmware", "vendor/example.bin"), compressed)
            self.assertFalse((firmware / "unused.bin").exists())

    def test_owner_prune_keeps_matrix_firmware_reached_through_directory_alias(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.make_rootfs(Path(raw), with_firmware=True)
            module = next((root / "lib/modules").rglob("*.ko"))
            module.write_bytes(b"fixture\x00firmware=matrix-vendor/example.bin\x00")
            firmware = root / "lib/firmware"
            (firmware / "vendor/unused.bin").write_bytes(b"not requested")
            try:
                (firmware / "matrix-vendor").symlink_to("vendor", target_is_directory=True)
            except OSError as exc:
                self.skipTest(f"symlink creation is unavailable: {exc}")

            result = POLICY.prune_unreferenced_firmware(root)

            self.assertTrue((firmware / "matrix-vendor").is_symlink())
            self.assertTrue((firmware / "vendor/example.bin").is_file())
            self.assertFalse((firmware / "vendor/unused.bin").exists())
            self.assertEqual(result["removed_files"], 1)
            receipt = POLICY.coverage_receipt(root, log_prefix="ORDAX_TEST")
            self.assertEqual(receipt["files"][0]["source"], "/lib/firmware/vendor/example.bin")

    def test_owner_prune_validates_coverage_before_removing_anything(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.make_rootfs(Path(raw), with_firmware=False)
            unrelated = root / "lib/firmware/unrelated.bin"
            unrelated.write_bytes(b"keep-until-validated")

            with self.assertRaises(POLICY.FirmwareSelectionError):
                POLICY.prune_unreferenced_firmware(root)

            self.assertEqual(unrelated.read_bytes(), b"keep-until-validated")

    def test_owner_prune_metrics_count_hardlinked_payload_once(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            root = self.make_rootfs(Path(raw), with_firmware=True)
            firmware = root / "lib/firmware"
            os.link(firmware / "vendor/example.bin", firmware / "vendor/alias.bin")
            (firmware / "vendor/unused.bin").write_bytes(b"x" * 4096)

            result = POLICY.prune_unreferenced_firmware(root)

            self.assertEqual(result["firmware_bytes_before"], 16 + 4096)
            self.assertEqual(result["firmware_bytes_after"], 16)
            self.assertEqual(result["removed_bytes"], 4096)


if __name__ == "__main__":
    unittest.main()
