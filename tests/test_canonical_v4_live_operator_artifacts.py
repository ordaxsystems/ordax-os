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

    def test_workflow_uses_live_proof_not_static_selection(self):
        source = (ROOT / ".github/workflows/canonical-v4-signing-request.yml").read_text(encoding="utf-8")
        self.assertIn("active: $" + "{{ steps.probe.outputs.active }}", source)
        self.assertIn("if: steps.select.outputs.active == 'true'", source)
        self.assertIn("probe_active_operator_artifacts.py", source)
        self.assertIn("test_canonical_v4_live_operator_artifacts.py", source)
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
