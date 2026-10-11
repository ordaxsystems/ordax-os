"""The published Owner/Development ZIP is identified by its manifest, not its historical tag target."""
import hashlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/creator"))
from verify_owner_published_release import NAMES, TAG, verify

COMMIT = "a" * 40


class OwnerPublishedReleaseTests(unittest.TestCase):
    def setUp(self):
        self.local = {
            NAMES[0]: b"PK-developer-zip-for-test",
            NAMES[2]: b"Owner development only\n",
        }
        self.local[NAMES[1]] = (
            hashlib.sha256(self.local[NAMES[0]]).hexdigest()
            + "  " + NAMES[0] + "\n"
        ).encode()
        self.meta = {
            "$schema": "prototype-ordax.creator-owner-bundle-update/1",
            "source_commit": COMMIT,
            "channel": "owner-prototype",
            "automatic_in_app_update": False,
            "artifact": NAMES[0],
            "sha256": hashlib.sha256(self.local[NAMES[0]]).hexdigest(),
            "size": len(self.local[NAMES[0]]),
            "download_url": (
                "https://github.com/ordaxsystems/ordax-os/releases/"
                "download/" + TAG + "/" + NAMES[0]
            ),
        }
        self.refresh()

    def refresh(self):
        self.local[NAMES[3]] = (json.dumps(self.meta, sort_keys=True) + "\n").encode()
        self.release = {
            "tag_name": TAG,
            "target_commitish": "b" * 40,
            "draft": False,
            "prerelease": True,
            "assets": [
                {
                    "name": name, "size": len(self.local[name]),
                    "digest": "sha256:" + hashlib.sha256(self.local[name]).hexdigest(),
                    "state": "uploaded",
                }
                for name in NAMES
            ],
        }

    def test_exact_remote_assets_pass_with_historic_tag_target(self):
        verify(self.release, self.local, COMMIT)

    def test_asset_digest_drift_fails(self):
        self.release["assets"][0]["digest"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(ValueError, "published-asset"):
            verify(self.release, self.local, COMMIT)

    def test_source_commit_drift_fails(self):
        self.meta["source_commit"] = "c" * 40
        self.refresh()
        with self.assertRaisesRegex(ValueError, "wrong-published-source"):
            verify(self.release, self.local, COMMIT)

    def test_stable_mislabeled_as_development_fails(self):
        self.release["prerelease"] = False
        with self.assertRaisesRegex(ValueError, "wrong-release"):
            verify(self.release, self.local, COMMIT)

    def test_missing_asset_fails(self):
        self.release["assets"].pop()
        with self.assertRaisesRegex(ValueError, "wrong-asset-count"):
            verify(self.release, self.local, COMMIT)

    def test_surprise_standalone_executable_fails(self):
        self.release["assets"].append({
            "name": "OrdaX-Creator.exe", "size": 1,
            "digest": "sha256:" + "0" * 64,
        })
        with self.assertRaisesRegex(ValueError, "wrong-asset-count"):
            verify(self.release, self.local, COMMIT)

    def test_zip_mismatch_in_manifest_fails(self):
        self.meta["sha256"] = "0" * 64
        self.refresh()
        with self.assertRaisesRegex(ValueError, "remote-manifest"):
            verify(self.release, self.local, COMMIT)

    def test_wrong_download_channel_fails(self):
        self.meta["download_url"] = "https://example.com/file.zip"
        self.refresh()
        with self.assertRaisesRegex(ValueError, "unexpected-download"):
            verify(self.release, self.local, COMMIT)


if __name__ == "__main__":
    unittest.main()
