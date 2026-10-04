#!/usr/bin/env python3
from __future__ import annotations

import base64
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE = RUNTIME / "native_app_data.py"
ENDPOINT_MODULE = RUNTIME / "native_app_data_endpoint.py"

if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

spec = importlib.util.spec_from_file_location("native_app_data", MODULE)
app_data = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(app_data)

endpoint_spec = importlib.util.spec_from_file_location("native_app_data_endpoint", ENDPOINT_MODULE)
endpoint = importlib.util.module_from_spec(endpoint_spec)
assert endpoint_spec.loader is not None
endpoint_spec.loader.exec_module(endpoint)


def identity(app_id: str = "notes", publisher_id: str = "ordax.first-party") -> dict:
    return {"publisherId": publisher_id, "appId": app_id, "ownerScope": "device"}


def partition_dirs(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted(path for path in root.iterdir() if path.is_dir() and len(path.name) == 64)


def only_partition(root: Path) -> Path:
    partitions = partition_dirs(root)
    if len(partitions) != 1:
        raise AssertionError(f"expected one partition, got {partitions}")
    return partitions[0]


class NativeAppDataTests(unittest.TestCase):
    def test_missing_read_and_list_do_not_create_physical_partition_or_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = str(Path(temporary) / "app-data")
            result = app_data.read_app_data(identity(), "document.main", root)
            self.assertEqual(result["revision"], 0)
            self.assertFalse(result["found"])
            self.assertIsNone(result["value"])
            listing = app_data.list_app_data(identity(), root)
            self.assertEqual(listing["keys"], [])
            self.assertEqual(listing["bytesUsed"], 0)
            self.assertFalse(Path(root).exists())

    def test_put_reboot_read_delete_and_partition_wide_cas(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = str(Path(temporary) / "app-data")
            first = app_data.put_app_data(identity(), "document.main", b"alpha", 0, root)
            self.assertEqual(first, {"revision": 1, "stored": True})

            # Simulated reboot: each call reopens manifest/blob bytes; no process-local cache exists.
            read_back = app_data.read_app_data(identity(), "document.main", root)
            self.assertEqual(read_back["revision"], 1)
            self.assertEqual(read_back["value"], b"alpha")

            with self.assertRaises(app_data.AppDataConflictError) as conflict:
                app_data.put_app_data(identity(), "second", b"stale", 0, root)
            self.assertEqual(conflict.exception.actual_revision, 1)

            second = app_data.put_app_data(identity(), "second", b"beta", 1, root)
            self.assertEqual(second["revision"], 2)
            listing = app_data.list_app_data(identity(), root)
            self.assertEqual(listing["revision"], 2)
            self.assertEqual(listing["keys"], ["document.main", "second"])
            self.assertEqual(listing["bytesUsed"], len(b"alpha") + len(b"beta"))

            deleted = app_data.delete_app_data(identity(), "document.main", 2, root)
            self.assertEqual(deleted, {"revision": 3, "deleted": True})
            self.assertFalse(app_data.read_app_data(identity(), "document.main", root)["found"])

    def test_values_are_content_addressed_and_update_does_not_rewrite_unrelated_blob(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "a", b"alpha", 0, str(root))
            app_data.put_app_data(identity(), "b", b"beta", 1, str(root))
            partition = only_partition(root)
            blobs = partition / "blobs"
            alpha_digest = __import__("hashlib").sha256(b"alpha").hexdigest()
            beta_digest = __import__("hashlib").sha256(b"beta").hexdigest()
            alpha_path = blobs / f"{alpha_digest}.bin"
            beta_path = blobs / f"{beta_digest}.bin"
            self.assertEqual(alpha_path.read_bytes(), b"alpha")
            self.assertEqual(beta_path.read_bytes(), b"beta")
            alpha_inode = alpha_path.stat().st_ino

            app_data.put_app_data(identity(), "b", b"gamma", 2, str(root))
            self.assertEqual(alpha_path.stat().st_ino, alpha_inode)
            self.assertEqual(alpha_path.read_bytes(), b"alpha")
            self.assertFalse(beta_path.exists(), "unreferenced old blob should be collected")

    def test_publisher_and_app_identity_are_distinct_partitions(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = str(Path(temporary) / "app-data")
            app_data.put_app_data(identity(), "state", b"notes", 0, root)
            app_data.put_app_data(identity(app_id="studio"), "state", b"studio", 0, root)
            app_data.put_app_data(identity(publisher_id="example.publisher"), "state", b"other", 0, root)

            self.assertEqual(app_data.read_app_data(identity(), "state", root)["value"], b"notes")
            self.assertEqual(app_data.read_app_data(identity(app_id="studio"), "state", root)["value"], b"studio")
            self.assertEqual(app_data.read_app_data(identity(publisher_id="example.publisher"), "state", root)["value"], b"other")
            partitions = partition_dirs(Path(root))
            self.assertEqual(len(partitions), 3)
            self.assertTrue(all(len(path.name) == 64 for path in partitions))

    def test_quota_key_limit_and_per_value_hard_bound_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = str(Path(temporary) / "app-data")
            app_data.put_app_data(identity(), "one", b"1234", 0, root, quota_bytes=6, max_keys=1)
            with self.assertRaisesRegex(ValueError, "key quota"):
                app_data.put_app_data(identity(), "two", b"1", 1, root, quota_bytes=6, max_keys=1)
            with self.assertRaisesRegex(ValueError, "byte quota"):
                app_data.put_app_data(identity(), "one", b"1234567", 1, root, quota_bytes=6, max_keys=1)
            with self.assertRaisesRegex(ValueError, "per-value hard bound"):
                app_data.put_app_data(
                    identity(), "one", b"x" * (app_data.MAX_APP_DATA_VALUE_BYTES + 1), 1, root,
                )
            self.assertEqual(app_data.read_app_data(identity(), "one", root)["value"], b"1234")

    def test_corrupt_manifest_wrong_identity_and_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "state", b"ok", 0, str(root))
            manifest = only_partition(root) / "manifest.json"
            manifest.write_text("{broken", encoding="utf-8")
            os.chmod(manifest, 0o600)
            with self.assertRaisesRegex(ValueError, "manifest is corrupt"):
                app_data.list_app_data(identity(), str(root))

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "state", b"ok", 0, str(root))
            manifest = only_partition(root) / "manifest.json"
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            payload["identity"]["appId"] = "studio"
            manifest.write_text(json.dumps(payload, separators=(",", ":"), sort_keys=True), encoding="utf-8")
            os.chmod(manifest, 0o600)
            with self.assertRaisesRegex(ValueError, "identity binding mismatch"):
                app_data.list_app_data(identity(), str(root))

        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            real = parent / "real"
            real.mkdir(mode=0o700)
            root = parent / "app-data"
            root.symlink_to(real, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, "real directory"):
                app_data.list_app_data(identity(), str(root))

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "state", b"ok", 0, str(root))
            manifest = only_partition(root) / "manifest.json"
            backing = Path(temporary) / "backing"
            backing.write_bytes(manifest.read_bytes())
            os.chmod(backing, 0o600)
            manifest.unlink()
            manifest.symlink_to(backing)
            with self.assertRaisesRegex(ValueError, "unsafe"):
                app_data.list_app_data(identity(), str(root))

    def test_blob_corruption_fails_closed_on_read(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "state", b"known-good", 0, str(root))
            partition = only_partition(root)
            blob = next((partition / "blobs").glob("*.bin"))
            blob.write_bytes(b"tampered")
            os.chmod(blob, 0o600)
            with self.assertRaisesRegex(ValueError, "blob integrity check failed"):
                app_data.read_app_data(identity(), "state", str(root))

    def test_orphan_blob_and_temp_file_never_become_authoritative(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "app-data"
            app_data.put_app_data(identity(), "state", b"known-good", 0, str(root))
            partition = only_partition(root)
            blobs = partition / "blobs"
            orphan_payload = b"orphan"
            digest = __import__("hashlib").sha256(orphan_payload).hexdigest()
            orphan = blobs / f"{digest}.bin"
            orphan.write_bytes(orphan_payload)
            os.chmod(orphan, 0o600)
            temp = blobs / ".tmp-crash-simulation"
            temp.write_bytes(b"partial")
            os.chmod(temp, 0o600)
            self.assertEqual(app_data.read_app_data(identity(), "state", str(root))["value"], b"known-good")

            # Next successful mutation performs bounded garbage collection.
            app_data.put_app_data(identity(), "second", b"next", 1, str(root))
            self.assertFalse(orphan.exists())
            self.assertFalse(temp.exists())

    def test_endpoint_never_accepts_self_asserted_identity_and_read_does_not_create_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = str(Path(temporary) / "app-data")
            body = json.dumps({"action": "get", "key": "state"}).encode()
            result = endpoint.handle_app_data_request(body, identity=identity(), root=root)
            self.assertEqual(result["revision"], 0)
            self.assertFalse(result["found"])
            self.assertFalse(Path(root).exists())

            forged = json.dumps({"action": "list", "appId": "studio"}).encode()
            with self.assertRaisesRegex(endpoint.AppDataEndpointRequestError, "self-assert identity"):
                endpoint.handle_app_data_request(forged, identity=identity(), root=root)

    def test_endpoint_round_trip_and_conflict_response_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = str(Path(temporary) / "app-data")
            put_body = json.dumps({
                "action": "put",
                "key": "state",
                "valueBase64": base64.b64encode(b"payload").decode("ascii"),
                "expectedRevision": 0,
            }).encode()
            self.assertEqual(
                endpoint.handle_app_data_request(put_body, identity=identity(), root=root),
                {"revision": 1, "stored": True},
            )
            read_result = endpoint.handle_app_data_request(
                json.dumps({"action": "get", "key": "state"}).encode(),
                identity=identity(), root=root,
            )
            self.assertEqual(base64.b64decode(read_result["valueBase64"]), b"payload")

            stale = json.dumps({
                "action": "delete", "key": "state", "expectedRevision": 0,
            }).encode()
            with self.assertRaises(endpoint.AppDataEndpointRequestError) as conflict:
                endpoint.handle_app_data_request(stale, identity=identity(), root=root)
            self.assertEqual(conflict.exception.status_code, 409)
            self.assertEqual(conflict.exception.actual_revision, 1)

    def test_owner_source_contains_required_filesystem_hardening(self):
        source = MODULE.read_text(encoding="utf-8")
        for marker in ("O_NOFOLLOW", "fcntl.flock", "os.fsync", "os.replace", "0o600", "sha256"):
            self.assertIn(marker, source)


if __name__ == "__main__":
    unittest.main()
