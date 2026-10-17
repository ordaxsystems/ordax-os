from __future__ import annotations

import importlib.util
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


if __name__ == "__main__":
    unittest.main()
