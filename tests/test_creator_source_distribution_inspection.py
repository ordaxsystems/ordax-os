"""Read-only metadata coverage for the official 17-source Creator distribution."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/release-signing"))
from inspect_creator_source_distribution import inspect, SCHEMA, REPOSITORY, PreparationError


class CreatorDistributionInspectionTests(unittest.TestCase):
    def setUp(self):
        self.commit = "a" * 40
        self.tag = "ordax-stable-v4-" + self.commit
        self.prefix = f"https://github.com/{REPOSITORY}/releases/download/{self.tag}/"
        self.bindings = {
            "$schema": "prototype-ordax.portable-media-bindings/1",
            "artifacts": [
                {"id": f"source-{index:02}", "sha256": f"{index:064x}", "size_bytes": index + 1}
                for index in range(17)
            ],
        }
        self.release = {"tag_name": self.tag, "draft": False, "assets": [
            {"name": item["id"], "digest": "sha256:" + item["sha256"],
             "size": item["size_bytes"], "browser_download_url": self.prefix + item["id"]}
            for item in self.bindings["artifacts"]
        ]}

    def test_all_metadata_matches_still_requires_full_byte_readback(self):
        result = inspect(self.bindings, self.release, self.commit)
        self.assertEqual(result["$schema"], SCHEMA)
        self.assertEqual(result["status"], "metadata-complete-readback-pending")
        self.assertEqual(result["matching_metadata_count"], 17)
        self.assertEqual(result["missing_asset_ids"], [])
        self.assertEqual(result["mismatched_asset_ids"], [])
        for key in ("remote_byte_readback_passed", "release_published_with_complete_verified_bytes",
                    "signed_creator_physical_writer_published", "physical_write_authorized", "physical_write_performed"):
            self.assertIs(result[key], False)
        self.assertIs(result["metadata_only"], True)

    def test_legacy_five_asset_release_does_not_count_as_seventeen(self):
        legacy = json.loads(json.dumps(self.release))
        legacy["assets"] = [
            {"name": name, "size": 10, "digest": "sha256:" + "f" * 64,
             "browser_download_url": self.prefix + name}
            for name in ("system.erofs", "native-surface-runtime.erofs", "local-ai-runtime.erofs",
                         "release-manifest.json", "release-envelope.json")
        ]
        result = inspect(self.bindings, legacy, self.commit)
        self.assertEqual(result["status"], "blocked-incomplete-remote-distribution")
        self.assertEqual(result["matching_metadata_count"], 0)
        self.assertEqual(len(result["missing_asset_ids"]), 17)
        self.assertIs(result["release_published_with_complete_verified_bytes"], False)

    def test_absent_and_metadata_mismatch_are_distinct(self):
        self.release["assets"].pop()
        self.release["assets"][0]["size"] += 1
        self.release["assets"][1]["digest"] = None
        self.release["assets"][2]["browser_download_url"] = "https://example.invalid/"
        result = inspect(self.bindings, self.release, self.commit)
        self.assertEqual(result["matching_metadata_count"], 13)
        self.assertEqual(result["missing_asset_ids"], ["source-16"])
        self.assertEqual(result["mismatched_asset_ids"], ["source-00", "source-01", "source-02"])
        self.assertEqual(result["status"], "blocked-incomplete-remote-distribution")

    def test_forged_release_identity_and_duplicate_assets_rejected(self):
        for alteration in (
            lambda r: r.update(tag_name="other-tag"),
            lambda r: r.update(draft=True),
            lambda r: r["assets"].append(dict(r["assets"][0])),
            lambda r: r["assets"][0].update(name="../evil"),
        ):
            with self.subTest(alteration=alteration):
                release = json.loads(json.dumps(self.release))
                alteration(release)
                with self.assertRaises(PreparationError):
                    inspect(self.bindings, release, self.commit)

    def test_invalid_creator_bindings_rejected_not_reinvented(self):
        bad = json.loads(json.dumps(self.bindings))
        bad["artifacts"].pop()
        with self.assertRaises(PreparationError):
            inspect(bad, self.release, self.commit)
        with self.assertRaises(PreparationError):
            inspect(self.bindings, self.release, "main")

    def test_cli_inspection_writes_exclusive_read_only_receipt(self):
        from inspect_creator_source_distribution import main
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bindings = root / "bindings.json"
            release = root / "release.json"
            out = root / "inspection.json"
            bindings.write_text(json.dumps(self.bindings))
            release.write_text(json.dumps(self.release))
            cli = ["inspector", "--bindings", str(bindings), "--release-metadata", str(release),
                   "--source-commit", self.commit, "--output", str(out)]
            with patch.object(sys, "argv", cli):
                self.assertEqual(main(), 0)
                self.assertEqual(json.loads(out.read_text())["matching_metadata_count"], 17)
                with self.assertRaises(SystemExit) as error:
                    main()
                self.assertEqual(error.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
