import importlib.util
from pathlib import Path
import tempfile
import unittest

from tests.test_windows_compat_runtime_dependency_discovery import synthetic_elf32, synthetic_elf64

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "bootstrap/windows-compat-runtime/runtime_dependency_first_hit_guard.py"
SPEC = importlib.util.spec_from_file_location("runtime_dependency_first_hit_guard", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def write(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


class RuntimeDependencyFirstHitGuardTests(unittest.TestCase):
    def test_contract_requires_first_pathname_hit_validation(self):
        contract = MODULE.load_contract()
        self.assertTrue(contract["inspection"]["first_pathname_hit_validation_required"])

    def test_wrong_arch_first_hit_blocks_later_compatible_candidate(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            consumer_path = write(
                stage / "usr/bin/wine",
                synthetic_elf64(runpath=b"/first:/second"),
            )
            write(rootfs / "first/libexample.so.1", synthetic_elf32(b"libc.so.6"))
            write(rootfs / "second/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            consumer = MODULE.PROBE.parse_elf_dynamic(consumer_path)
            with self.assertRaisesRegex(MODULE.FirstHitGuardError, "incompatible ELF identity"):
                MODULE.resolve_first_pathname_hit(
                    stage,
                    rootfs,
                    "libexample.so.1",
                    consumer,
                    "usr/bin/wine",
                )

    def test_non_elf_first_hit_blocks_later_compatible_candidate(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            consumer_path = write(
                stage / "usr/bin/wine",
                synthetic_elf64(runpath=b"/first:/second"),
            )
            write(rootfs / "first/libexample.so.1", b"not-an-elf-runtime-object\n")
            write(rootfs / "second/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            consumer = MODULE.PROBE.parse_elf_dynamic(consumer_path)
            with self.assertRaisesRegex(MODULE.FirstHitGuardError, "non-ELF first pathname hit"):
                MODULE.resolve_first_pathname_hit(
                    stage,
                    rootfs,
                    "libexample.so.1",
                    consumer,
                    "usr/bin/wine",
                )

    def test_matching_first_hit_is_selected_without_scanning_later_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            consumer_path = write(
                stage / "usr/bin/wine",
                synthetic_elf64(runpath=b"/first:/second"),
            )
            write(rootfs / "first/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            write(rootfs / "second/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            consumer = MODULE.PROBE.parse_elf_dynamic(consumer_path)
            hit, _ = MODULE.resolve_first_pathname_hit(
                stage,
                rootfs,
                "libexample.so.1",
                consumer,
                "usr/bin/wine",
            )
            self.assertEqual(hit["scope"], "rootfs-external")
            self.assertEqual(hit["path"], "first/libexample.so.1")
            self.assertEqual(hit["search_position"], 0)

    def test_cross_scope_first_hit_collision_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stage = root / "stage"
            rootfs = root / "rootfs"
            consumer_path = write(
                stage / "usr/bin/wine",
                synthetic_elf64(runpath=b"/usr/lib"),
            )
            write(stage / "usr/lib/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            write(rootfs / "usr/lib/libexample.so.1", synthetic_elf64(b"libc.so.6"))
            consumer = MODULE.PROBE.parse_elf_dynamic(consumer_path)
            with self.assertRaisesRegex(MODULE.FirstHitGuardError, "cross-scope first pathname collision"):
                MODULE.resolve_first_pathname_hit(
                    stage,
                    rootfs,
                    "libexample.so.1",
                    consumer,
                    "usr/bin/wine",
                )


if __name__ == "__main__":
    unittest.main()
