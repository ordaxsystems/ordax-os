"""Direct image orchestration must never build or write a physical disk."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "tools/creator/direct_owner_dev_image.py"
spec = importlib.util.spec_from_file_location("direct_owner_dev_image", SOURCE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class DirectOwnerDevTests(unittest.TestCase):
    def test_preflight_rejects_missing_components_before_any_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(mod, "run") as run:
                with self.assertRaises(ValueError):
                    mod.preflight(Path(tmp) / "image", Path(tmp) / "creator",
                                  Path(tmp) / "surface", Path(tmp) / "rootfs",
                                  Path(tmp) / "vmlinuz", Path(tmp) / "initramfs")
                run.assert_not_called()

    def test_preflight_rejects_output_inside_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(mod, "run") as run:
                with self.assertRaises(ValueError):
                    mod.preflight(mod.ROOT / "out" / "direct", Path(tmp), Path(tmp),
                                  Path(tmp), Path(tmp), Path(tmp))
                run.assert_not_called()

    def test_rejects_unseeded_dev_rootfs_before_verification(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "surface").mkdir()
            (root / "rootfs").mkdir()
            (root / "kernel").write_text("kernel")
            (root / "initramfs").write_text("initramfs")
            (root / "creator").write_text("creator")
            with patch.object(mod.os, "access", return_value=True), patch.object(mod, "run") as run:
                with self.assertRaisesRegex(ValueError, "lacks Git"):
                    mod.preflight(root / "image", root / "creator", root / "surface",
                                  root / "rootfs", root / "kernel", root / "initramfs")
                run.assert_not_called()

    def test_no_implicit_kernel_or_base_build(self):
        source = SOURCE.read_text(encoding="utf-8")
        self.assertNotIn('"bootstrap/kernel/build.py", "build"', source)
        self.assertNotIn('"bootstrap/independent-base/build.py", "build"', source)
        self.assertNotIn("GITHUB_ACTIONS", source)
        self.assertIn("physical_write_authorized", source)
        self.assertIn('run(["sudo", sys.executable, "tools/creator/owner_dev_raw.py"', source)


if __name__ == "__main__":
    unittest.main()
