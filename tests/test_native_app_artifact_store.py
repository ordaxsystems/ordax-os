from __future__ import annotations

import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from system.surface.runtime import native_app_artifact_store as store


def identity(name: str, payload: bytes) -> dict:
    return {
        "name": name,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
    }


class NativeAppArtifactStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "artifacts"

    def tearDown(self) -> None:
        self.temp.cleanup()


    def test_artifact_identity_rejects_payload_larger_than_runtime_verifier_ceiling(self) -> None:
        oversized = {
            "name": "notes.zip",
            "sha256": "a" * 64,
            "size": (32 * 1024 * 1024) + 1,
        }
        with self.assertRaisesRegex(store.AppArtifactStoreError, "artifact identity is invalid"):
            store.validate_artifact_identity(oversized)

    def test_verified_artifact_is_content_addressed_and_reused(self) -> None:
        payload = b"verified-package"
        item = identity("notes.zip", payload)

        path = store.store_verified_artifact(item, payload, root=str(self.root))
        self.assertEqual(path.name, item["sha256"])
        self.assertEqual(path.parent.name, item["sha256"][:2])
        self.assertEqual(path.stat().st_nlink, 1, "published artifact has no staging hardlink")
        self.assertEqual(
            store.read_cached_artifact(item, root=str(self.root)),
            payload,
        )

        path_again = store.store_verified_artifact(item, payload, root=str(self.root))
        self.assertEqual(path_again, path)

    def test_tampered_payload_is_rejected_before_persistence(self) -> None:
        payload = b"expected"
        item = identity("notes.zip", payload)
        with self.assertRaisesRegex(store.AppArtifactStoreError, "does not match verified identity"):
            store.store_verified_artifact(item, b"tampered", root=str(self.root))
        target = self.root / "sha256" / item["sha256"][:2] / item["sha256"]
        self.assertFalse(target.exists())

    def test_racing_writer_cannot_be_overwritten_during_publication(self) -> None:
        payload = b"verified"
        item = identity("notes.zip", payload)
        target = self.root / "sha256" / item["sha256"][:2] / item["sha256"]
        competitor = b"another-process"

        original_link = os.link

        def race_with_uncooperative_writer(source, destination):
            Path(destination).write_bytes(competitor)
            return original_link(source, destination)

        with patch.object(store.os, "link", side_effect=race_with_uncooperative_writer):
            with self.assertRaisesRegex(store.AppArtifactStoreError, "persistence failed"):
                store.store_verified_artifact(item, payload, root=str(self.root))

        self.assertEqual(target.read_bytes(), competitor)
        self.assertEqual(list(target.parent.glob(".artifact-*")), [])
        with self.assertRaisesRegex(store.AppArtifactStoreError, "size mismatch|digest mismatch"):
            store.read_cached_artifact(item, root=str(self.root))

    def test_symlink_created_during_publication_is_not_replaced(self) -> None:
        payload = b"verified"
        item = identity("notes.zip", payload)
        target = self.root / "sha256" / item["sha256"][:2] / item["sha256"]
        protected = Path(self.temp.name) / "unrelated"
        protected.write_bytes(b"untouched")
        original_link = os.link

        def race_with_symlink(source, destination):
            Path(destination).symlink_to(protected)
            return original_link(source, destination)

        with patch.object(store.os, "link", side_effect=race_with_symlink):
            with self.assertRaisesRegex(store.AppArtifactStoreError, "persistence failed"):
                store.store_verified_artifact(item, payload, root=str(self.root))

        self.assertTrue(target.is_symlink())
        self.assertEqual(protected.read_bytes(), b"untouched")
        self.assertEqual(list(target.parent.glob(".artifact-*")), [])
        with self.assertRaisesRegex(store.AppArtifactStoreError, "unavailable or unsafe"):
            store.read_cached_artifact(item, root=str(self.root))

    def test_cached_tampering_fails_closed_instead_of_refetching_silently(self) -> None:
        payload = b"expected"
        item = identity("notes.zip", payload)
        path = store.store_verified_artifact(item, payload, root=str(self.root))
        path.chmod(0o600)
        path.write_bytes(b"tampered")
        path.chmod(0o400)

        calls = 0

        def loader(_identity):
            nonlocal calls
            calls += 1
            return payload

        with self.assertRaisesRegex(store.AppArtifactStoreError, "size mismatch|digest mismatch"):
            store.acquire_verified_artifact(item, loader=loader, root=str(self.root))
        self.assertEqual(calls, 0)

    def test_acquisition_provider_receives_only_verified_identity_not_url_or_version(self) -> None:
        payload = b"component-envelope"
        item = identity("notes.runtime-component-envelope.json", payload)
        seen = []

        def loader(value):
            seen.append(value)
            return payload

        path, changed = store.acquire_verified_artifact(
            item,
            loader=loader,
            root=str(self.root),
        )
        self.assertTrue(changed)
        self.assertTrue(path.is_file())
        self.assertEqual(seen, [item])
        self.assertNotIn("url", seen[0])
        self.assertNotIn("version", seen[0])

        path_again, changed_again = store.acquire_verified_artifact(
            item,
            loader=lambda _value: (_ for _ in ()).throw(RuntimeError("must not refetch")),
            root=str(self.root),
        )
        self.assertEqual(path_again, path)
        self.assertFalse(changed_again)

    def test_canonical_artifact_set_is_materialized_by_fixed_roles(self) -> None:
        payloads = {
            "package": b"package",
            "release": b"release",
            "compatibility": b"compatibility",
            "componentEnvelope": b"envelope",
        }
        artifacts = {
            "package": identity("notes.zip", payloads["package"]),
            "release": identity("notes.release.json", payloads["release"]),
            "compatibility": identity("notes.compatibility.json", payloads["compatibility"]),
            "componentEnvelope": identity(
                "notes.runtime-component-envelope.json",
                payloads["componentEnvelope"],
            ),
        }
        by_digest = {
            value["sha256"]: payloads[role]
            for role, value in artifacts.items()
        }
        seen = []

        def loader(value):
            seen.append(value["name"])
            return by_digest[value["sha256"]]

        resolved = store.acquire_verified_artifact_set(
            artifacts,
            loader=loader,
            root=str(self.root),
        )
        self.assertEqual(
            list(resolved),
            ["package", "release", "compatibility", "componentEnvelope"],
        )
        self.assertEqual(
            seen,
            [
                "notes.zip",
                "notes.release.json",
                "notes.compatibility.json",
                "notes.runtime-component-envelope.json",
            ],
        )
        for path in resolved.values():
            self.assertTrue(Path(path).is_file())

    def test_symlink_cache_entry_is_rejected(self) -> None:
        payload = b"expected"
        item = identity("notes.zip", payload)

        self.root.mkdir(parents=True, mode=0o700)
        self.root.chmod(0o700)
        sha_root = self.root / "sha256"
        sha_root.mkdir(mode=0o700)
        sha_root.chmod(0o700)
        digest_parent = sha_root / item["sha256"][:2]
        digest_parent.mkdir(mode=0o700)
        digest_parent.chmod(0o700)

        target = digest_parent / item["sha256"]
        other = self.root / "other"
        other.write_bytes(payload)
        try:
            target.symlink_to(other)
        except (OSError, NotImplementedError):
            self.skipTest("symlink creation unavailable")

        with self.assertRaisesRegex(store.AppArtifactStoreError, "unavailable or unsafe"):
            store.read_cached_artifact(item, root=str(self.root))

    def test_broad_existing_cache_subdirectory_permissions_fail_closed(self) -> None:
        payload = b"expected"
        item = identity("notes.zip", payload)
        self.root.mkdir(parents=True, mode=0o700)
        self.root.chmod(0o700)
        sha_root = self.root / "sha256"
        sha_root.mkdir(mode=0o700)
        sha_root.chmod(0o755)

        with self.assertRaisesRegex(store.AppArtifactStoreError, "permissions are not private"):
            store.store_verified_artifact(item, payload, root=str(self.root))

    def test_cached_artifact_requires_private_read_only_single_link_metadata(self) -> None:
        payload = b"expected"
        item = identity("notes.zip", payload)
        path = store.store_verified_artifact(item, payload, root=str(self.root))

        path.chmod(0o600)
        with self.assertRaisesRegex(store.AppArtifactStoreError, "read-only private"):
            store.read_cached_artifact(item, root=str(self.root))

        path.chmod(0o400)
        hardlink = self.root / "extra-hardlink"
        try:
            os.link(path, hardlink)
        except OSError:
            self.skipTest("hardlink creation unavailable")
        with self.assertRaisesRegex(store.AppArtifactStoreError, "one hardlink"):
            store.read_cached_artifact(item, root=str(self.root))


if __name__ == "__main__":
    unittest.main()
