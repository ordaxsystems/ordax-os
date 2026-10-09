"""Exact GitHub operator run/artifact metadata produces one unsigned request."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

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

    def test_frozen_candidate_accepts_only_exact_ref_and_same_sha_for_three_runs(self):
        runs, inventories, historical = self.fixture()
        branch = "release-candidate/" + self.SOURCE
        for kind in runs:
            runs[kind]["head_branch"] = branch
            inventories[kind]["artifacts"][0]["workflow_run"]["head_branch"] = branch
        request = builder.build_request(self.SOURCE, runs, inventories, historical)
        self.assertEqual(request["operator_ref"], branch)
        self.assertFalse(request["publication_performed"])
        self.assertFalse(request["physical_write_authorized"])
        with mock.patch.object(builder, "fetch_json", return_value={
            "ref": "refs/heads/" + branch,
            "object": {"type": "commit", "sha": self.SOURCE},
        }) as fetch:
            builder.verify_frozen_candidate_ref(self.SOURCE, branch, "read-only-token")
            self.assertEqual(fetch.call_args.args[0], "/git/ref/heads/" + branch)

    def test_mixed_refs_and_lookalike_candidate_names_fail_closed(self):
        branch = "release-candidate/" + self.SOURCE
        runs, inventories, historical = self.fixture()
        runs["system"]["head_branch"] = branch
        inventories["system"]["artifacts"][0]["workflow_run"]["head_branch"] = branch
        with self.assertRaisesRegex(builder.ValidationError, "same frozen source ref"):
            builder.build_request(self.SOURCE, runs, inventories, historical)

        for bad in (
            "release-candidate/" + "b" * 40,
            "release-candidate/" + self.SOURCE + "-suffix",
            "release-candidate/../" + self.SOURCE,
            "release-candidate/" + self.SOURCE.upper(),
            "feature/my-code",
            "refs/tags/ordax-stable-v4-" + self.SOURCE,
        ):
            with self.subTest(branch=bad):
                runs, inventories, historical = self.fixture()
                for kind in runs:
                    runs[kind]["head_branch"] = bad
                    inventories[kind]["artifacts"][0]["workflow_run"]["head_branch"] = bad
                with self.assertRaisesRegex(builder.ValidationError, "operator ref"):
                    builder.build_request(self.SOURCE, runs, inventories, historical)

    def test_frozen_ref_cannot_move_after_successful_workflows(self):
        branch = "release-candidate/" + self.SOURCE
        for identity in (
            {"ref": "refs/heads/" + branch, "object": {"type": "commit", "sha": "b" * 40}},
            {"ref": "refs/heads/" + branch, "object": {"type": "tag", "sha": self.SOURCE}},
            {"ref": "refs/heads/main", "object": {"type": "commit", "sha": self.SOURCE}},
        ):
            with self.subTest(identity=identity):
                with mock.patch.object(builder, "fetch_json", return_value=identity):
                    with self.assertRaisesRegex(builder.ValidationError, "no longer points"):
                        builder.verify_frozen_candidate_ref(self.SOURCE, branch, "readonly-token")
        with mock.patch.object(builder, "fetch_json") as fetch:
            builder.verify_frozen_candidate_ref(self.SOURCE, "main", "readonly-token")
            fetch.assert_not_called()

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

    def test_comparison_is_bounded_without_relaxing_metadata_limit(self):
        self.assertEqual(builder.BOUNDED_ANCESTRY_QUERY, "?per_page=1&page=2")
        self.assertEqual(builder.MAX_BYTES, 2 * 1024 * 1024)
        with mock.patch.object(builder, "urlopen") as opener:
            response = opener.return_value.__enter__.return_value
            response.status = 200
            response.geturl.return_value = builder.API + "/example"
            response.read.return_value = b"x" * (builder.MAX_BYTES + 1)
            with self.assertRaisesRegex(
                builder.ValidationError, "metadata exceeds the maximum size"
            ):
                builder.fetch_json("/example", "read-only-token")
            response.read.assert_called_once_with(builder.MAX_BYTES + 1)

    def test_source_must_descend_from_cutover_and_remain_on_main(self):
        source = self.SOURCE

        def comparison(base, status="ahead", behind=0, merge=None):
            return {
                "status": status,
                "behind_by": behind,
                "base_commit": {"sha": base},
                "merge_base_commit": {"sha": merge or base},
            }

        valid = [
            {"sha": source},
            comparison(builder.CUTOVER_COMMIT),
            comparison(source),
        ]
        with mock.patch.object(builder, "fetch_json", side_effect=valid) as fetch:
            builder.verify_cutover_ancestry(source, "readonly-token")
            self.assertEqual(fetch.call_args_list[0].args[0], f"/git/commits/{source}")
            self.assertEqual(
                fetch.call_args_list[1].args[0],
                f"/compare/{builder.CUTOVER_COMMIT}...{source}{builder.BOUNDED_ANCESTRY_QUERY}",
            )
            self.assertEqual(fetch.call_args_list[2].args[0], f"/compare/{source}...main{builder.BOUNDED_ANCESTRY_QUERY}")

        with mock.patch.object(builder, "fetch_json", return_value={"sha": "c" * 40}):
            with self.assertRaisesRegex(builder.ValidationError, "resolved exactly"):
                builder.verify_cutover_ancestry(source, "readonly-token")

        for bad in (
            comparison(builder.CUTOVER_COMMIT, status="diverged"),
            comparison(builder.CUTOVER_COMMIT, behind=1),
            comparison(builder.CUTOVER_COMMIT, merge="f" * 40),
            {"status": "ahead", "head_commit": {"sha": source}},
        ):
            with self.subTest(bad=bad):
                with mock.patch.object(builder, "fetch_json", side_effect=[
                    {"sha": source}, bad,
                ]):
                    with self.assertRaisesRegex(builder.ValidationError, "does not descend"):
                        builder.verify_cutover_ancestry(source, "readonly-token")
        for bad in (
            comparison(source, status="behind"),
            comparison(source, behind=1),
            comparison(source, merge="f" * 40),
        ):
            with self.subTest(bad=bad):
                with mock.patch.object(builder, "fetch_json", side_effect=[
                    {"sha": source}, comparison(builder.CUTOVER_COMMIT), bad,
                ]):
                    with self.assertRaisesRegex(builder.ValidationError, "ancestor of current main"):
                        builder.verify_cutover_ancestry(source, "readonly-token")


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
