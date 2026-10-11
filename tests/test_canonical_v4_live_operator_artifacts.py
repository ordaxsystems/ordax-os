"""Fail closed if canonical v4 operator artifacts expired between builds."""
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/release-operator"))
import test_build_canonical_v4_request as builder_tests
import build_canonical_v4_request as builder
import probe_active_operator_artifacts as probe


class LiveCanonicalV4OperatorArtifactsTests(unittest.TestCase):
    def setUp(self):
        self.runs, self.inventories, self.historical = builder_tests.CanonicalRequestBuilderTests().fixture()
        self.source_commit = builder_tests.CanonicalRequestBuilderTests.SOURCE
        self.request = builder.build_request(
            self.source_commit, self.runs, self.inventories, self.historical
        )

    def fetch(self, route, _token):
        parts = route.split("/")
        rid = int(parts[3])
        kind = next(kind for kind, run in self.runs.items() if run["id"] == rid)
        return (self.inventories[kind] if parts[-1].startswith("artifacts?")
                else self.runs[kind])

    def test_exact_live_artifacts_admitted_without_download(self):
        self.assertTrue(probe.live_request_matches(ROOT, self.request, "test-token", fetch=self.fetch))

    def test_expired_or_missing_artifacts_rejected(self):
        asset = self.inventories["system"]["artifacts"][0]
        self.inventories["system"]["artifacts"] = []
        self.inventories["system"]["total_count"] = 0
        with self.assertRaises(builder.ValidationError):
            probe.live_request_matches(ROOT, self.request, "test-token", fetch=self.fetch)
        asset["expired"] = True
        self.inventories["system"]["artifacts"] = [asset]
        self.inventories["system"]["total_count"] = 1
        with self.assertRaises(builder.ValidationError):
            probe.live_request_matches(ROOT, self.request, "test-token", fetch=self.fetch)

    def test_swapped_artifact_id_or_source_rejected(self):
        self.request["operator_artifacts"]["surface"]["artifact_id"] += 900
        self.assertFalse(probe.live_request_matches(ROOT, self.request, "test-token", fetch=self.fetch))
        self.request["operator_artifacts"]["surface"]["artifact_id"] -= 900
        self.runs["surface"]["head_sha"] = "c" * 40
        with self.assertRaises(builder.ValidationError):
            probe.live_request_matches(ROOT, self.request, "test-token", fetch=self.fetch)

    def test_frozen_candidate_ref_is_rechecked_at_live_assembly_boundary(self):
        branch = "release-candidate/" + self.source_commit
        for kind in self.runs:
            self.runs[kind]["head_branch"] = branch
            self.inventories[kind]["artifacts"][0]["workflow_run"]["head_branch"] = branch
        self.request = builder.build_request(
            self.source_commit, self.runs, self.inventories, self.historical
        )
        self.assertEqual(self.request["operator_ref"], branch)
        seen = []
        def get_live(route, token):
            seen.append(route)
            if route.startswith("/git/ref/heads/"):
                return {
                    "ref": "refs/heads/" + branch,
                    "object": {"type": "commit", "sha": self.source_commit},
                }
            return self.fetch(route, token)
        self.assertTrue(probe.live_request_matches(
            ROOT, self.request, "read-only-test-token", fetch=get_live
        ))
        self.assertEqual(seen[-1], "/git/ref/heads/" + branch)

        for changed in (
            {"ref": "refs/heads/" + branch,
             "object": {"type": "commit", "sha": "f" * 40}},
            {"ref": "refs/heads/main",
             "object": {"type": "commit", "sha": self.source_commit}},
            {"ref": "refs/heads/" + branch,
             "object": {"type": "tag", "sha": self.source_commit}},
        ):
            with self.subTest(changed=changed):
                def moved(route, token):
                    if route.startswith("/git/ref/heads/"):
                        return changed
                    return self.fetch(route, token)
                with self.assertRaisesRegex(builder.ValidationError, "no longer points"):
                    probe.live_request_matches(
                        ROOT, self.request, "read-only-test-token", fetch=moved
                    )

    def test_historical_main_request_never_depends_on_candidate_branch(self):
        def get_without_ref(route, token):
            self.assertFalse(route.startswith("/git/ref/heads/"))
            return self.fetch(route, token)
        self.assertTrue(probe.live_request_matches(
            ROOT, self.request, "read-only-test-token", fetch=get_without_ref
        ))

    def test_workflow_uses_live_proof_not_static_selection(self):
        source = (ROOT / ".github/workflows/canonical-v4-signing-request.yml").read_text(encoding="utf-8")
        self.assertIn("active: $" + "{{ steps.probe.outputs.active }}", source)
        self.assertIn("if: steps.select.outputs.active == 'true'", source)
        self.assertIn("probe_active_operator_artifacts.py", source)
        self.assertIn("test_canonical_v4_live_operator_artifacts.py", source)
        self.assertIn("Independently reconstruct exact request with canonical GitHub-backed builder", source)
        self.assertIn("tools/release-operator/build_canonical_v4_request.py", source)
        self.assertIn("ACTIVE_CANONICAL_V4_REQUEST=CANONICAL_BUILDER_MATCH", source)
        self.assertIn("RELEASE_SIGNED=NO", source)
        self.assertIn("PHYSICAL_WRITE_AUTHORIZED=NO", source)
        self.assertIn("if rebuilt != doc:", source)
        self.assertNotIn("active: $" + "{{ steps.select.outputs.active }}", source)

    def test_missing_live_proof_writes_inactive_and_no_signature(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "github-output"
            with (
                patch.dict(os.environ, {"GH_TOKEN": "synthetic-only", "GITHUB_REPOSITORY": builder.REPOSITORY}),
                patch.object(probe, "selection", return_value={"active": True}),
                patch.object(probe, "live_request_matches", return_value=False),
                contextlib.redirect_stdout(io.StringIO()) as stdout,
            ):
                self.assertEqual(probe.main(["--github-output", str(output)]), 0)
            self.assertEqual(output.read_text(encoding="utf-8"), "active=false\n")
            state = json.loads(stdout.getvalue())
            self.assertFalse(state["active"])
            self.assertFalse(state["signing_performed"])
            self.assertFalse(state["publication_performed"])
            self.assertFalse(state["physical_write_performed"])


if __name__ == "__main__":
    unittest.main()
