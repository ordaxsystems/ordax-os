"""Exact GitHub operator run/artifact metadata produces one unsigned request."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/release-operator"))
import build_canonical_v4_request as builder


class CanonicalRequestBuilderTests(unittest.TestCase):
    SOURCE = "a" * 40

    def fixture(self):
        historical = builder.load_historical_request(ROOT)
        runs, inventories = {}, {}
        for index, (kind, spec) in enumerate(builder.KIND_SPECS.items()):
            run_id, artifact_id = 10000 + index, 20000 + index
            runs[kind] = {
                "id": run_id,
                "repository": {"full_name": builder.REPOSITORY, "id": builder.REPOSITORY_ID},
                "event": "workflow_dispatch", "status": "completed", "conclusion": "success",
                "head_branch": "main", "head_sha": self.SOURCE, "path": spec["workflow_path"],
            }
            inventories[kind] = {"total_count": 1, "artifacts": [{
                "id": artifact_id,
                "name": spec["artifact_prefix"] + self.SOURCE,
                "expired": False,
                "digest": "sha256:" + "b" * 64,
                "workflow_run": {
                    "id": run_id, "repository_id": builder.REPOSITORY_ID,
                    "head_repository_id": builder.REPOSITORY_ID,
                    "head_branch": "main", "head_sha": self.SOURCE,
                },
            }]}
        return runs, inventories, historical

    def test_valid_unsigned_draft_writes_only_once(self):
        runs, inventories, historical = self.fixture()
        doc = builder.build_request(self.SOURCE, runs, inventories, historical)
        self.assertEqual(doc["source_repository"], builder.REPOSITORY)
        self.assertEqual(set(doc["operator_artifacts"]), set(builder.KIND_SPECS))
        self.assertTrue(all(doc[field] is False for field in builder.UNSAFE_FIELDS))
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "active.json"
            builder.write_once(output, doc)
            self.assertEqual(json.loads(output.read_text())["source_commit"], self.SOURCE)
            with self.assertRaisesRegex(builder.ValidationError, "refusing to overwrite"):
                builder.write_once(output, doc)

    def test_wrong_physical_repo_or_event_fails(self):
        for edit in ({"repository": {"full_name": builder.REPOSITORY, "id": 0}},
                     {"repository": {"full_name": "washingtonmsdj/prototipo-ordax-os", "id": builder.REPOSITORY_ID}},
                     {"event": "push"}, {"event": "pull_request"},
                     {"head_branch": "feature"}, {"head_sha": "c" * 40},
                     {"conclusion": "failure"}):
            with self.subTest(edit=edit):
                runs, inventories, historical = self.fixture()
                runs["surface"].update(edit)
                with self.assertRaises(builder.ValidationError):
                    builder.build_request(self.SOURCE, runs, inventories, historical)

    def test_artifact_integrity_and_binding_is_required(self):
        for edit in ({"expired": True}, {"digest": "sha256:bad"},
                     {"id": 0}, {"name": "not-the-exact-operator-artifact"}):
            with self.subTest(edit=edit):
                runs, inv, hist = self.fixture()
                inv["local-ai"]["artifacts"][0].update(edit)
                with self.assertRaises(builder.ValidationError):
                    builder.build_request(self.SOURCE, runs, inv, hist)
        runs, inv, hist = self.fixture()
        inv["local-ai"]["artifacts"][0]["workflow_run"]["head_repository_id"] = 0
        with self.assertRaises(builder.ValidationError):
            builder.build_request(self.SOURCE, runs, inv, hist)

    def test_duplicate_or_partial_metadata_fails_closed(self):
        runs, inv, hist = self.fixture()
        inv["system"]["artifacts"].append(inv["system"]["artifacts"][0].copy())
        inv["system"]["total_count"] = 2
        with self.assertRaises(builder.ValidationError):
            builder.build_request(self.SOURCE, runs, inv, hist)
        runs, inv, hist = self.fixture()
        inv["system"]["total_count"] = 2
        with self.assertRaises(builder.ValidationError):
            builder.build_request(self.SOURCE, runs, inv, hist)
        runs, inv, hist = self.fixture()
        runs["surface"]["id"] = runs["system"]["id"]
        with self.assertRaises(builder.ValidationError):
            builder.build_request(self.SOURCE, runs, inv, hist)

    def test_historical_source_and_artifact_cannot_be_reused(self):
        runs, inv, hist = self.fixture()
        old = hist["source_commit"]
        for run in runs.values():
            run["head_sha"] = old
        for data in inv.values():
            asset = data["artifacts"][0]
            asset["name"] = asset["name"].replace(self.SOURCE, old)
            asset["workflow_run"]["head_sha"] = old
        with self.assertRaisesRegex(builder.ValidationError, "historical source commit"):
            builder.build_request(old, runs, inv, hist)
        runs, inv, hist = self.fixture()
        inv["system"]["artifacts"][0]["id"] = hist["operator_artifacts"]["system"]["artifact_id"]
        with self.assertRaisesRegex(builder.ValidationError, "reuses historical"):
            builder.build_request(self.SOURCE, runs, inv, hist)


if __name__ == "__main__":
    unittest.main()
