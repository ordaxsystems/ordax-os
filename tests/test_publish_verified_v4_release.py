"""Synthetic-only tests; no GitHub publication, network or physical-media writes."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "tools/release-operator/publish_verified_v4_release.py"
sys.path.insert(0, str(SOURCE.parent))
spec = importlib.util.spec_from_file_location("ordax_publication_operator", SOURCE)
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

SHA = "a" * 40
TAG = "ordax-stable-v4-" + SHA
PLAN = {
    "source_commit": SHA,
    "release_tag": TAG,
    "assets": [{"name": name, "sha256": str(i + 1) * 64, "size": i + 10}
               for i, name in enumerate(publisher.ASSET_NAMES)],
}


def remote(*, draft):
    return {
        "id": 409954063, "tag_name": TAG, "target_commitish": SHA,
        "draft": draft, "prerelease": True,
        "assets": [{"name": row["name"], "digest": "sha256:" + row["sha256"],
                    "size": row["size"], "state": "uploaded"}
                   for row in PLAN["assets"]],
    }


class PublicationOperatorTests(unittest.TestCase):
    def test_exact_five_remote_digests_required_before_publication(self):
        publisher.verify_uploaded_release(remote(draft=True), PLAN, draft=True)

    def test_remote_asset_mutation_blocks_publication(self):
        bad = remote(draft=True)
        bad["assets"][0]["digest"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(publisher.AdmissionError, "digest mismatch"):
            publisher.verify_uploaded_release(bad, PLAN, draft=True)

    def test_unexpected_assets_and_target_refused(self):
        bad = remote(draft=True)
        bad["assets"].append({"name": "extra", "state": "uploaded"})
        with self.assertRaisesRegex(publisher.AdmissionError, "inventory"):
            publisher.verify_uploaded_release(bad, PLAN, draft=True)
        bad = remote(draft=True)
        bad["target_commitish"] = "b" * 40
        with self.assertRaisesRegex(publisher.AdmissionError, "identity"):
            publisher.verify_uploaded_release(bad, PLAN, draft=True)

    def test_mismatched_explicit_confirmation_never_calls_gh(self):
        with patch.object(publisher, "command") as call:
            with self.assertRaisesRegex(publisher.AdmissionError, "explicit confirmation"):
                publisher.publish_reviewed(PLAN, Path("/tmp"), confirmed_tag="wrong")
            call.assert_not_called()

    def test_new_release_created_only_after_absence_then_verified(self):
        with patch.object(publisher, "require_tag_absent") as tag_check, \
             patch.object(publisher, "remote_release", side_effect=[
                 None, remote(draft=True), remote(draft=False)]) as fetch, \
             patch.object(publisher, "command", return_value="") as call:
            report = publisher.publish_reviewed(PLAN, Path("/tmp"), confirmed_tag=TAG)
        self.assertEqual(report["status"], "published-prerelease-verifiable-https")
        self.assertFalse(report["physical_write_authorized"])
        self.assertEqual(fetch.call_count, 3)
        tag_check.assert_called_once_with(TAG)
        self.assertEqual(call.call_count, 2)
        create_args = call.call_args_list[0].args[0]
        self.assertEqual(create_args[:4], ["gh", "release", "create", TAG])
        self.assertEqual([Path(name).name for name in create_args[4:9]],
                         list(publisher.ASSET_NAMES))
        self.assertIn("--draft", create_args)
        self.assertIn("--prerelease", create_args)
        patch_args = call.call_args_list[1].args[0]
        self.assertEqual(patch_args, [
            "gh", "api", "--method", "PATCH",
            "repos/" + publisher.REPO + "/releases/409954063",
            "-F", "draft=false", "-F", "prerelease=true",
        ])

    def test_existing_exact_draft_is_reused_without_reupload_or_tag_creation(self):
        with patch.object(publisher, "require_tag_absent") as tag_check, \
             patch.object(publisher, "remote_release", side_effect=[
                 remote(draft=True), remote(draft=False)]) as fetch, \
             patch.object(publisher, "command", return_value="") as call:
            report = publisher.publish_reviewed(PLAN, Path("/tmp"), confirmed_tag=TAG)
        self.assertTrue(report["release_published"])
        self.assertEqual(fetch.call_count, 2)
        tag_check.assert_not_called()
        call.assert_called_once()
        args = call.call_args.args[0]
        self.assertEqual(args[:5], [
            "gh", "api", "--method", "PATCH",
            "repos/" + publisher.REPO + "/releases/409954063",
        ])
        self.assertNotIn("release", args[:3])

    def test_existing_draft_must_match_all_five_hashes_before_patch(self):
        bad = remote(draft=True)
        bad["assets"][2]["size"] = -1
        with patch.object(publisher, "require_tag_absent") as tag_check, \
             patch.object(publisher, "remote_release", return_value=bad), \
             patch.object(publisher, "command") as call:
            with self.assertRaisesRegex(publisher.AdmissionError, "digest mismatch"):
                publisher.publish_reviewed(PLAN, Path("/tmp"), confirmed_tag=TAG)
        tag_check.assert_not_called()
        call.assert_not_called()

    def test_public_or_incorrect_existing_release_never_rewritten(self):
        for mutate in (
            lambda x: x.update(draft=False),
            lambda x: x.update(target_commitish="b" * 40),
            lambda x: x.update(id="unsafe"),
            lambda x: x["assets"].append({"name": "unexpected", "size": 1}),
        ):
            draft = remote(draft=True)
            mutate(draft)
            with self.subTest(draft=draft), \
                 patch.object(publisher, "require_tag_absent") as tag_check, \
                 patch.object(publisher, "remote_release", return_value=draft), \
                 patch.object(publisher, "command") as call:
                with self.assertRaises(publisher.AdmissionError):
                    publisher.publish_reviewed(PLAN, Path("/tmp"), confirmed_tag=TAG)
                tag_check.assert_not_called()
                call.assert_not_called()

    def test_new_staging_mismatch_never_publishes(self):
        bad = remote(draft=True)
        bad["assets"][2]["size"] = -1
        with patch.object(publisher, "require_tag_absent"), \
             patch.object(publisher, "remote_release", side_effect=[None, bad]), \
             patch.object(publisher, "command") as call:
            with self.assertRaisesRegex(publisher.AdmissionError, "digest mismatch"):
                publisher.publish_reviewed(PLAN, Path("/tmp"), confirmed_tag=TAG)
            self.assertEqual(call.call_count, 1)
            self.assertEqual(call.call_args.args[0][:3],
                             ["gh", "release", "create"])

    def test_post_publish_metadata_must_keep_same_immutable_id(self):
        wrong = remote(draft=False)
        wrong["id"] = 777
        with patch.object(publisher, "remote_release", side_effect=[
                 remote(draft=True), wrong]), \
             patch.object(publisher, "command") as call:
            with self.assertRaisesRegex(publisher.AdmissionError, "identity changed"):
                publisher.publish_reviewed(PLAN, Path("/tmp"), confirmed_tag=TAG)
        call.assert_called_once()

    def test_drafts_visible_in_authenticated_release_collection(self):
        with patch.object(publisher, "command", return_value=json.dumps([
            {"id": 1, "tag_name": "unrelated"},
            remote(draft=True),
        ])) as call:
            release = publisher.remote_release(TAG)
        self.assertEqual(release["id"], 409954063)
        call.assert_called_once_with([
            "gh", "api", "repos/" + publisher.REPO +
            "/releases?per_page=100&page=1",
        ])

    def test_ambiguous_or_broken_release_inventory_fails_closed(self):
        for value in (
            json.dumps([remote(draft=True), remote(draft=True)]),
            json.dumps({"not": "a release array"}),
            "not-json",
        ):
            with self.subTest(value=value), \
                 patch.object(publisher, "command", return_value=value):
                with self.assertRaises(publisher.AdmissionError):
                    publisher.remote_release(TAG)

    def test_existing_tag_or_auth_error_is_not_treated_as_absence(self):
        cases = [(0, "HTTP/2 200 OK\r\n"), (1, "HTTP/2 403 Forbidden\r\n"),
                 (1, "HTTP/2 500 Error\r\n"), (1, "")]
        for code, body in cases:
            with self.subTest(code=code, body=body):
                fake = type("Process", (), {"returncode": code, "stdout": body})()
                with patch.object(publisher.subprocess, "run", return_value=fake):
                    with self.assertRaisesRegex(publisher.AdmissionError, "already exists"):
                        publisher.require_tag_absent(TAG)

    def test_missing_tag_is_distinguished_by_http_404(self):
        fake = type("Process", (), {"returncode": 1,
                                   "stdout": "HTTP/2 404 Not Found\r\n"})()
        with patch.object(publisher.subprocess, "run", return_value=fake):
            publisher.require_tag_absent(TAG)


if __name__ == "__main__":
    unittest.main()
