"""Read-only Independent Base TAR inventory regression tests."""
import io
import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "bootstrap/independent-base/verify_rootfs.py"
spec = importlib.util.spec_from_file_location("ordax_independent_rootfs_audit", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IndependentRootfsInventoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def archive(self, items):
        path = Path(self.temp.name) / "rootfs.tar"
        with tarfile.open(path, "w") as handle:
            for name, payload in items:
                info = tarfile.TarInfo(name)
                info.size = len(payload)
                handle.addfile(info, io.BytesIO(payload))
        return str(path)

    def test_clean_rootfs_measures_elf_and_bytes(self):
        result = module.audit(self.archive([
            ("./bin/busybox", b"\x7fELFtest"),
            ("./etc/os-release", b"NAME=OrdaX"),
        ]))
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["elf_files"], ["bin/busybox"])
        self.assertFalse(result["elf_linkage_verified"])
        self.assertFalse(result["boot_verified"])
        self.assertEqual(result["uncompressed_file_bytes"], 18)

    def test_tar_root_directory_is_allowed(self):
        path = Path(self.temp.name) / 'rootfs.tar'
        with tarfile.open(path, 'w') as handle:
            root = tarfile.TarInfo('./')
            root.type = tarfile.DIRTYPE
            handle.addfile(root)
            binary = tarfile.TarInfo('./bin/tool')
            binary.size = 4
            handle.addfile(binary, io.BytesIO(b'\\x7fELF'))
        self.assertEqual(module.audit(str(path))['elf_files'], ['bin/tool'])

    def test_alpine_apk_residue_is_rejected(self):
        result = module.audit(self.archive([("etc/apk/repositories", b"index")]))
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["alpine_paths"], ["etc/apk/repositories"])

    def test_duplicate_normalized_name_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            module.audit(self.archive([("etc/x", b"a"), ("./etc/x", b"b")]))

    def test_traversal_rejected(self):
        with self.assertRaises(ValueError):
            module.normalized("../bin/sh")


if __name__ == "__main__":
    unittest.main()
