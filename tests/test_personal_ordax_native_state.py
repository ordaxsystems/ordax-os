import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system" / "surface" / "runtime" / "native_personal_ordax_state.py"
spec = importlib.util.spec_from_file_location("native_personal_ordax_state", MODULE)
state_owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state_owner)


def personal_state(owner_kind="account", owner_id="user-1", *, authority="none", background=False):
    return {
        "schema": "ordax.personal-work-store-state/1",
        "ownerKind": owner_kind,
        "ownerId": None if owner_kind == "device" else owner_id,
        "nextOrdinal": 2,
        "workItems": [{
            "schema": "ordax.personal-work-item/1",
            "id": "personal-work-1",
            "ownerKind": owner_kind,
            "ownerId": None if owner_kind == "device" else owner_id,
            "goal": "Pesquisar estado local",
            "state": "completed",
            "spaceId": None,
            "projectId": None,
            "pendingApprovalId": None,
            "backgroundExecution": background,
            "contextRefs": [],
            "createdAt": "2026-10-03T15:00:00.000Z",
            "updatedAt": "2026-10-03T15:01:00.000Z",
        }],
        "activities": [],
        "results": [{
            "schema": "ordax.personal-work-result/1",
            "id": "personal-result-personal-work-1",
            "workItemId": "personal-work-1",
            "kind": "intelligence-response",
            "text": "resultado",
            "engineId": "engine-1",
            "modelId": "model-1",
            "authority": authority,
            "artifactRefs": [],
            "createdAt": "2026-10-03T15:01:00.000Z",
        }],
        "approvals": [],
        "decisions": [],
        "attempts": [],
    }


def payload(**kwargs):
    return json.dumps(personal_state(**kwargs), separators=(",", ":"), ensure_ascii=False)


class NativePersonalOrdaxStateTests(unittest.TestCase):
    def test_account_partition_is_private_atomic_and_filename_hides_subject(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "personal")
            record = state_owner.compare_and_swap_personal_ordax_payload(
                "account", "private-user@example.test", 0,
                payload(owner_id="private-user@example.test"), root,
            )
            self.assertEqual(record["revision"], 1)
            restored = state_owner.read_personal_ordax_record(
                "account", "private-user@example.test", root,
            )
            self.assertEqual(restored["revision"], 1)
            self.assertEqual(restored["ownerId"], "private-user@example.test")
            files = list(Path(root).iterdir())
            self.assertTrue(any(path.name.startswith("account-") and path.suffix == ".json" for path in files))
            self.assertFalse(any("private-user" in path.name for path in files))
            state_path = next(path for path in files if path.suffix == ".json")
            self.assertEqual(stat.S_IMODE(os.stat(state_path).st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(os.stat(root).st_mode), 0o700)
            if hasattr(os, "geteuid"):
                self.assertEqual(os.stat(state_path).st_uid, os.geteuid())
                self.assertEqual(os.stat(root).st_uid, os.geteuid())

    def test_cas_rejects_stale_writer_and_partitions_device_from_accounts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "personal")
            first = state_owner.compare_and_swap_personal_ordax_payload(
                "account", "user-1", 0, payload(owner_id="user-1"), root,
            )
            self.assertEqual(first["revision"], 1)
            second = state_owner.compare_and_swap_personal_ordax_payload(
                "account", "user-1", 1, payload(owner_id="user-1"), root,
            )
            self.assertEqual(second["revision"], 2)
            self.assertIsNone(state_owner.compare_and_swap_personal_ordax_payload(
                "account", "user-1", 1, payload(owner_id="user-1"), root,
            ))
            device = state_owner.compare_and_swap_personal_ordax_payload(
                "device", None, 0, payload(owner_kind="device", owner_id=None), root,
            )
            self.assertEqual(device["revision"], 1)
            self.assertEqual(state_owner.read_personal_ordax_record("account", "user-1", root)["revision"], 2)
            self.assertEqual(state_owner.read_personal_ordax_record("device", None, root)["ownerKind"], "device")

    def test_owner_mismatch_background_enable_and_authority_escalation_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "personal")
            with self.assertRaisesRegex(ValueError, "owner"):
                state_owner.compare_and_swap_personal_ordax_payload(
                    "account", "user-1", 0, payload(owner_id="user-2"), root,
                )
            with self.assertRaisesRegex(ValueError, "background"):
                state_owner.compare_and_swap_personal_ordax_payload(
                    "account", "user-1", 0, payload(owner_id="user-1", background=True), root,
                )
            with self.assertRaisesRegex(ValueError, "authority"):
                state_owner.compare_and_swap_personal_ordax_payload(
                    "account", "user-1", 0, payload(owner_id="user-1", authority="grant"), root,
                )
            self.assertIsNone(state_owner.read_personal_ordax_record("account", "user-1", root))

    def test_corrupt_existing_partition_is_preserved_and_blocks_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "personal")
            state_owner.compare_and_swap_personal_ordax_payload(
                "account", "user-1", 0, payload(owner_id="user-1"), root,
            )
            path = Path(state_owner._state_path(root, "account", "user-1"))
            path.write_text("{broken-json", encoding="utf-8")
            os.chmod(path, 0o600)
            before = path.read_bytes()
            with self.assertRaisesRegex(ValueError, "corrupt"):
                state_owner.compare_and_swap_personal_ordax_payload(
                    "account", "user-1", 1, payload(owner_id="user-1"), root,
                )
            self.assertEqual(path.read_bytes(), before)

    def test_symlink_partition_and_unsafe_root_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            root = directory / "personal"
            root.mkdir(mode=0o700)
            target = directory / "outside.json"
            target.write_text("{}", encoding="utf-8")
            partition = Path(state_owner._state_path(str(root), "device", None))
            partition.symlink_to(target)
            with self.assertRaises((OSError, ValueError)):
                state_owner.read_personal_ordax_record("device", None, str(root))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "personal"
            root.mkdir(mode=0o755)
            with self.assertRaisesRegex(ValueError, "permissions"):
                state_owner.read_personal_ordax_record("device", None, str(root))

        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            actual = directory / "actual"
            actual.mkdir(mode=0o700)
            root = directory / "personal"
            root.symlink_to(actual, target_is_directory=True)
            with self.assertRaises((OSError, ValueError)):
                state_owner.read_personal_ordax_record("device", None, str(root))

    @unittest.skipUnless(hasattr(os, "geteuid"), "POSIX ownership semantics required")
    def test_foreign_root_ownership_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "personal"
            root.mkdir(mode=0o700)
            real_fstat = os.fstat

            def foreign_root(descriptor):
                metadata = real_fstat(descriptor)
                if stat.S_ISDIR(metadata.st_mode):
                    values = list(metadata)
                    values[4] = os.geteuid() + 1
                    return os.stat_result(values)
                return metadata

            with mock.patch.object(state_owner.os, "fstat", side_effect=foreign_root):
                with self.assertRaisesRegex(ValueError, "ownership"):
                    state_owner.read_personal_ordax_record("device", None, str(root))

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
