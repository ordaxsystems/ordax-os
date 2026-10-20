"""Read-only Independent Base TAR inventory regression tests."""
import io
import importlib.util
import struct
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "bootstrap/independent-base/verify_rootfs.py"
spec = importlib.util.spec_from_file_location("ordax_independent_rootfs_audit", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)



def sample_elf(interpreter=None):
    size = 128 + (len(interpreter.encode()) + 1 if interpreter else 0)
    data = bytearray(size)
    data[:6] = b"\\x7fELF\\x02\\x01"
    struct.pack_into("<Q", data, 32, 64)
    struct.pack_into("<H", data, 54, 56)
    struct.pack_into("<H", data, 56, 1 if interpreter else 0)
    if interpreter:
        struct.pack_into("<I", data, 64, 3)
        struct.pack_into("<Q", data, 72, 128)
        struct.pack_into("<Q", data, 96, len(interpreter.encode()) + 1)
        data[128:] = interpreter.encode() + b"\\0"
    return bytes(data)


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
        self.assertEqual(result["uncompressed_file_bytes"], 128 + len(b"NAME=OrdaX"))

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


    def test_dynamic_interpreter_present(self):
        result = module.audit(self.archive([
            ("bin/tool", sample_elf("/lib/ld-musl.so.1")),
            ("lib/ld-musl.so.1", b"linker")
        ]))
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["elf_interpreters"]["bin/tool"], "/lib/ld-musl.so.1")

    def test_dynamic_interpreter_missing(self):
        result = module.audit(self.archive([
            ("bin/tool", sample_elf("/lib/ld-musl.so.1"))
        ]))
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["missing_interpreters"]["bin/tool"], "/lib/ld-musl.so.1")

    def test_malformed_elf_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "malformed ELF"):
            module.audit(self.archive([("bin/tool", b"\\x7fELFbad")]))

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
