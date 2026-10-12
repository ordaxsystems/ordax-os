#!/usr/bin/env python3
"""Owner-level recovery with real immutable blobs; no public update grant."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from tests.test_native_app_data import app_data, endpoint, identity, only_partition

RELEASE = {
    "componentId": "notes",
    "version": "1.0.0",
    "sourceCommit": "1111111111111111111111111111111111111111",
}
OTHER_RELEASE = {
    "componentId": "notes",
    "version": "1.1.0",
    "sourceCommit": "2222222222222222222222222222222222222222",
}


def blob(root: Path, payload: bytes) -> Path:
    return only_partition(root) / "blobs" / (hashlib.sha256(payload).hexdigest() + ".bin")


class NativeAppDataCheckpointTests(unittest.TestCase):
    def test_pin_update_delete_reboot_restore_and_monotonic_revision(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "state", b"known-good", 0, str(root))
            app_data.put_app_data(identity(), "second", b"retained", 1, str(root))
            pinned = app_data.create_app_data_checkpoint(identity(), RELEASE, 2, str(root))
            self.assertEqual(pinned["pinnedRevision"], 2)
            pin_file = only_partition(root) / app_data.APP_DATA_CHECKPOINT_NAME
            self.assertEqual(os.stat(pin_file).st_mode & 0o777, 0o600)
            old = blob(root, b"known-good")
            self.assertTrue(old.exists())

            app_data.put_app_data(identity(), "state", b"updated", 2, str(root))
            app_data.delete_app_data(identity(), "second", 3, str(root))
            self.assertTrue(old.exists(), "owner GC discarded pinned bytes")
            self.assertTrue(blob(root, b"retained").exists())

            # Real persisted bytes are reopened, not a remembered Python snapshot.
            restored = app_data.restore_app_data_checkpoint(identity(), RELEASE, 4, str(root))
            self.assertEqual(restored, {"revision": 5, "restoredFromRevision": 2, "restored": True})
            self.assertEqual(app_data.read_app_data(identity(), "state", str(root))["value"], b"known-good")
            self.assertEqual(app_data.read_app_data(identity(), "second", str(root))["value"], b"retained")
            self.assertEqual(app_data.list_app_data(identity(), str(root))["revision"], 5)
            self.assertFalse(blob(root, b"updated").exists(), "unreferenced later data was not GC'ed")

    def test_pin_creation_rejects_mismatched_revision_and_duplicate_pin(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = str(Path(temporary) / "app-data")
            with self.assertRaisesRegex(ValueError, "persisted generation"):
                app_data.create_app_data_checkpoint(identity(), RELEASE, 0, root)
            app_data.put_app_data(identity(), "key", b"a", 0, root)
            with self.assertRaises(app_data.AppDataConflictError):
                app_data.create_app_data_checkpoint(identity(), RELEASE, 0, root)
            app_data.create_app_data_checkpoint(identity(), RELEASE, 1, root)
            with self.assertRaisesRegex(ValueError, "already has"):
                app_data.create_app_data_checkpoint(identity(), RELEASE, 1, root)
            with self.assertRaisesRegex(ValueError, "source release"):
                app_data.restore_app_data_checkpoint(identity(), OTHER_RELEASE, 1, root)
            with self.assertRaises(app_data.AppDataConflictError):
                app_data.restore_app_data_checkpoint(identity(), RELEASE, 0, root)
            self.assertEqual(app_data.read_app_data(identity(), "key", root)["value"], b"a")

    def test_checkpoint_source_release_cannot_switch_partition_or_self_claim(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = str(Path(temporary) / "app-data")
            app_data.put_app_data(identity(), "key", b"a", 0, root)
            forged = dict(RELEASE, componentId="studio")
            with self.assertRaisesRegex(ValueError, "partition identity"):
                app_data.create_app_data_checkpoint(identity(), forged, 1, root)
            with self.assertRaisesRegex(ValueError, "source commit"):
                app_data.create_app_data_checkpoint(identity(), dict(RELEASE, sourceCommit="bad"), 1, root)
            # The app-facing endpoint has NO pin / retire / restore operation.
            for action in ("checkpoint", "restore", "retire-checkpoint"):
                with self.assertRaisesRegex(endpoint.AppDataEndpointRequestError, "action or request"):
                    endpoint.handle_app_data_request(
                        json.dumps({"action": action}).encode(), identity=identity(), root=root,
                    )

    def test_corrupt_recovery_pin_blocks_mutation_without_rewriting_active_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "key", b"original", 0, str(root))
            app_data.create_app_data_checkpoint(identity(), RELEASE, 1, str(root))
            pin_file = only_partition(root) / app_data.APP_DATA_CHECKPOINT_NAME
            pin_file.write_bytes(b"{corrupt")
            os.chmod(pin_file, 0o600)
            with self.assertRaisesRegex(ValueError, "checkpoint is corrupt"):
                app_data.put_app_data(identity(), "key", b"new", 1, str(root))
            with self.assertRaisesRegex(ValueError, "checkpoint is corrupt"):
                app_data.delete_app_data(identity(), "key", 1, str(root))
            self.assertEqual(app_data.read_app_data(identity(), "key", str(root))["value"], b"original")
            self.assertTrue(blob(root, b"original").exists())

    def test_symlink_checkpoint_is_rejected_before_any_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "key", b"original", 0, str(root))
            pin_file = only_partition(root) / app_data.APP_DATA_CHECKPOINT_NAME
            target = Path(temporary) / "outside"
            target.write_text("untrusted")
            pin_file.symlink_to(target)
            with self.assertRaisesRegex(ValueError, "checkpoint is unsafe"):
                app_data.put_app_data(identity(), "key", b"new", 1, str(root))
            self.assertEqual(target.read_text(), "untrusted")
            self.assertEqual(app_data.list_app_data(identity(), str(root))["revision"], 1)

    def test_pinned_blob_corruption_prevents_restore_and_preserves_current(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "key", b"old", 0, str(root))
            app_data.create_app_data_checkpoint(identity(), RELEASE, 1, str(root))
            app_data.put_app_data(identity(), "key", b"new", 1, str(root))
            old_blob = blob(root, b"old")
            old_blob.write_bytes(b"tampered")
            os.chmod(old_blob, 0o600)
            with self.assertRaisesRegex(ValueError, "blob integrity"):
                app_data.restore_app_data_checkpoint(identity(), RELEASE, 2, str(root))
            self.assertEqual(app_data.read_app_data(identity(), "key", str(root))["value"], b"new")
            self.assertEqual(app_data.list_app_data(identity(), str(root))["revision"], 2)

    def test_crash_before_manifest_commit_leaves_old_current_and_checkpoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "key", b"old", 0, str(root))
            app_data.create_app_data_checkpoint(identity(), RELEASE, 1, str(root))
            original = app_data._atomic_replace_bytes

            def crash_on_manifest(path, parent, payload, *, label):
                if label == "App Data manifest":
                    raise OSError("simulated power loss before manifest switch")
                return original(path, parent, payload, label=label)

            with mock.patch.object(app_data, "_atomic_replace_bytes", side_effect=crash_on_manifest):
                with self.assertRaisesRegex(OSError, "simulated power loss"):
                    app_data.put_app_data(identity(), "key", b"new", 1, str(root))
            self.assertEqual(app_data.read_app_data(identity(), "key", str(root))["value"], b"old")
            self.assertEqual(app_data.list_app_data(identity(), str(root))["revision"], 1)
            self.assertTrue(blob(root, b"old").exists())
            # The committed pin is durable and remains readable after restart.
            result = app_data.restore_app_data_checkpoint(identity(), RELEASE, 1, str(root))
            self.assertEqual(result["revision"], 2)

    def test_crash_after_manifest_commit_keeps_restore_path_and_old_blobs(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "key", b"old", 0, str(root))
            app_data.create_app_data_checkpoint(identity(), RELEASE, 1, str(root))
            with mock.patch.object(
                app_data, "_cleanup_unreferenced_blobs",
                side_effect=OSError("simulated interruption after commit"),
            ):
                with self.assertRaisesRegex(OSError, "simulated interruption"):
                    app_data.put_app_data(identity(), "key", b"new", 1, str(root))
            self.assertEqual(app_data.read_app_data(identity(), "key", str(root))["value"], b"new")
            self.assertTrue(blob(root, b"old").exists())
            self.assertEqual(app_data.restore_app_data_checkpoint(
                identity(), RELEASE, 2, str(root),
            )["revision"], 3)
            self.assertEqual(app_data.read_app_data(identity(), "key", str(root))["value"], b"old")

    def test_explicit_retirement_releases_pin_and_garbage_collects_only_orphans(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "key", b"old", 0, str(root))
            app_data.create_app_data_checkpoint(identity(), RELEASE, 1, str(root))
            app_data.put_app_data(identity(), "key", b"new", 1, str(root))
            with self.assertRaises(app_data.AppDataConflictError):
                app_data.retire_app_data_checkpoint(identity(), RELEASE, 1, str(root))
            with self.assertRaisesRegex(ValueError, "source release"):
                app_data.retire_app_data_checkpoint(identity(), OTHER_RELEASE, 2, str(root))
            self.assertTrue(blob(root, b"old").exists())
            self.assertEqual(app_data.retire_app_data_checkpoint(
                identity(), RELEASE, 2, str(root),
            ), {"revision": 2, "retired": True})
            self.assertFalse(blob(root, b"old").exists())
            self.assertTrue(blob(root, b"new").exists())
            with self.assertRaisesRegex(ValueError, "checkpoint for source release is unavailable"):
                app_data.restore_app_data_checkpoint(identity(), RELEASE, 2, str(root))


if __name__ == "__main__":
    unittest.main()
