import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
sys.path.insert(0, str(RUNTIME))
MODULE = RUNTIME / "native_partitioned_json_state.py"
spec = importlib.util.spec_from_file_location("native_partitioned_json_state", MODULE)
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


def validator(value):
    if not isinstance(value, dict) or set(value) != {"$schema", "revision", "payload"}:
        raise ValueError("test record shape is invalid")
    if value.get("$schema") != "test.private-record/1":
        raise ValueError("test record schema is invalid")
    revision = value.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise ValueError("test record revision is invalid")
    payload = value.get("payload")
    if not isinstance(payload, str) or not payload or len(payload) > 1024:
        raise ValueError("test payload is invalid")
    return {
        "$schema": "test.private-record/1",
        "revision": revision,
        "payload": payload,
    }


def record(revision, payload="value"):
    return {
        "$schema": "test.private-record/1",
        "revision": revision,
        "payload": payload,
    }


class NativePartitionedJsonStateTests(unittest.TestCase):
    def cas(self, root, stem, expected, value):
        return store.compare_and_swap_partitioned_json_record(
            root,
            stem,
            expected,
            value,
            max_record_bytes=4096,
            validate_record=validator,
            label="Test Native",
        )

    def read(self, root, stem):
        return store.read_partitioned_json_record(
            root,
            stem,
            max_record_bytes=4096,
            validate_record=validator,
            label="Test Native",
        )

    def test_partitions_are_private_atomic_and_isolated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "state")
            first = self.cas(root, "partition-a", 0, record(1, "alpha"))
            second = self.cas(root, "partition-b", 0, record(1, "beta"))

            self.assertEqual(first["payload"], "alpha")
            self.assertEqual(second["payload"], "beta")
            self.assertEqual(self.read(root, "partition-a")["payload"], "alpha")
            self.assertEqual(self.read(root, "partition-b")["payload"], "beta")

            root_path = Path(root)
            self.assertEqual(stat.S_IMODE(os.stat(root_path).st_mode), 0o700)
            for stem in ("partition-a", "partition-b"):
                state_path = Path(store.partition_state_path(root, stem))
                lock_path = root_path / f"{stem}.lock"
                self.assertEqual(stat.S_IMODE(os.stat(state_path).st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(os.stat(lock_path).st_mode), 0o600)
                if hasattr(os, "geteuid"):
                    self.assertEqual(os.stat(state_path).st_uid, os.geteuid())

    def test_stale_writer_and_invalid_next_revision_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "state")
            self.assertEqual(self.cas(root, "partition-a", 0, record(1))["revision"], 1)
            self.assertEqual(self.cas(root, "partition-a", 1, record(2))["revision"], 2)
            self.assertIsNone(self.cas(root, "partition-a", 1, record(2, "stale")))
            self.assertEqual(self.read(root, "partition-a")["payload"], "value")

            with self.assertRaisesRegex(ValueError, "next revision"):
                self.cas(root, "partition-a", 2, record(4))

    def test_partition_stem_is_opaque_and_cannot_escape_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "state")
            for stem in ("../escape", "/absolute", "a/b", "UPPER", "", "a" * 129):
                with self.assertRaisesRegex(ValueError, "partition stem"):
                    self.read(root, stem)

    def test_corrupt_target_is_preserved_and_blocks_cas(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "state")
            self.cas(root, "partition-a", 0, record(1))
            path = Path(store.partition_state_path(root, "partition-a"))
            path.write_text("{broken", encoding="utf-8")
            os.chmod(path, 0o600)
            before = path.read_bytes()

            with self.assertRaisesRegex(ValueError, "corrupt"):
                self.cas(root, "partition-a", 1, record(2))
            self.assertEqual(path.read_bytes(), before)

    def test_symlink_target_and_unsafe_root_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "state"
            root.mkdir(mode=0o700)
            outside = base / "outside.json"
            outside.write_text("{}", encoding="utf-8")
            (root / "partition-a.json").symlink_to(outside)
            with self.assertRaises((OSError, ValueError)):
                self.read(str(root), "partition-a")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "state"
            root.mkdir(mode=0o755)
            with self.assertRaisesRegex(ValueError, "permissions"):
                self.read(str(root), "partition-a")

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            actual = base / "actual"
            actual.mkdir(mode=0o700)
            root = base / "state"
            root.symlink_to(actual, target_is_directory=True)
            with self.assertRaises((OSError, ValueError)):
                self.read(str(root), "partition-a")

    @unittest.skipUnless(hasattr(os, "geteuid"), "POSIX ownership semantics required")
    def test_foreign_root_ownership_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "state"
            root.mkdir(mode=0o700)
            real_fstat = os.fstat

            def foreign_root(descriptor):
                metadata = real_fstat(descriptor)
                if stat.S_ISDIR(metadata.st_mode):
                    values = list(metadata)
                    values[4] = os.geteuid() + 1
                    return os.stat_result(values)
                return metadata

            with mock.patch.object(store.os, "fstat", side_effect=foreign_root):
                with self.assertRaisesRegex(ValueError, "ownership"):
                    self.read(str(root), "partition-a")

    def test_record_validator_remains_domain_owned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "state")
            with self.assertRaisesRegex(ValueError, "schema"):
                self.cas(root, "partition-a", 0, {
                    "$schema": "foreign/1",
                    "revision": 1,
                    "payload": "x",
                })
            self.assertIsNone(self.read(root, "partition-a"))

    def test_source_uses_fd_anchored_private_atomic_primitives(self):
        source = MODULE.read_text(encoding="utf-8")
        for marker in (
            "O_NOFOLLOW", "O_DIRECTORY", "fcntl.flock", "os.fsync", "os.replace",
            "dir_fd=root_fd", "src_dir_fd=root_fd", "dst_dir_fd=root_fd", "0o600", "0o700",
            "os.geteuid", "os.fstat",
        ):
            self.assertIn(marker, source)
        self.assertNotIn("localStorage", source)


if __name__ == "__main__":
    unittest.main()
