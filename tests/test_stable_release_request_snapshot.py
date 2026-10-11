from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/ops/stable_release_request_snapshot.py"
ACTIVE = json.loads((ROOT / "docs/contracts/canonical-v4-signing-request-active.json").read_text(encoding="utf-8"))
spec = importlib.util.spec_from_file_location("stable_release_request_snapshot", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class StableReleaseRequestSnapshotTests(unittest.TestCase):
    def test_existing_canonical_request_can_be_classified_only_for_its_exact_source(self):
        sha = ACTIVE["source_commit"]
        record = module.evaluate(ROOT, sha)
        self.assertEqual(record["$schema"], "prototype-ordax.stable-release-request-snapshot/1")
        self.assertEqual(record["status"], "exact-source-request-present")
        self.assertIs(record["canonical_request_validated_locally"], True)
        self.assertIs(record["request_matches_snapshot_commit"], True)
        self.assertEqual(record["validated_request_source_commit"], sha)
        for k in ("operator_artifact_bytes_checked_by_this_snapshot", 
                  "artifact_expiration_checked_by_this_snapshot",
                  "canonical_private_key_read", "release_signed_by_this_snapshot",
                  "release_published_by_this_snapshot", "physical_target_selected",
                  "physical_write_authorized", "physical_write_performed"):
            self.assertIs(record[k], False, k)

    def test_current_snapshot_does_not_rebind_a_frozen_older_candidate(self):
        old = ACTIVE["source_commit"]
        other = "a" * 40 if old != "a" * 40 else "b" * 40
        record = module.evaluate(ROOT, other)
        self.assertEqual(record["status"], "source-request-differs")
        self.assertEqual(record["validated_request_source_commit"], old)
        self.assertIs(record["request_matches_snapshot_commit"], False)
        self.assertIs(record["requested_commit_may_be_a_frozen_release_candidate"], True)
        self.assertIs(record["physical_write_authorized"], False)

    def test_changed_repository_identity_fails_closed(self):
        record = module.evaluate(ROOT, ACTIVE["source_commit"], execution_repository="legacy/ordax-os")
        self.assertEqual(record["status"], "no-validated-request")
        self.assertIs(record["canonical_request_validated_locally"], False)
        self.assertIs(record["physical_write_authorized"], False)

    def test_rejects_malformed_commit(self):
        for wrong in ("main", "A"*40, "f"*39, "f"*41, " f"*20):
            with self.assertRaises(ValueError):
                module.evaluate(ROOT, wrong)

    def test_invalid_request_selector_failure_does_not_infer_readiness(self):
        with mock.patch.object(module.subprocess, "run") as run:
            run.return_value = subprocess.CompletedProcess([], 2, "", "blocked")
            record = module.evaluate(ROOT, ACTIVE["source_commit"])
        self.assertEqual(record["status"], "no-validated-request")
        self.assertIs(record["request_matches_snapshot_commit"], False)

    def test_fail_closed_operator_flag_and_non_authorizing_default(self):
        actual = subprocess.run(
            [sys.executable, str(SCRIPT), "--source-commit", "b"*40, "--require-exact-source"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(actual.returncode, 2)
        record = json.loads(actual.stdout)
        self.assertEqual(record["status"], "source-request-differs")
        self.assertIs(record["physical_write_performed"], False)

    def test_no_side_effects_are_implemented_by_wrapper(self):
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertIn("select_active_signing_request.py", source)
        for forbidden in ("generate-key", "sign-trust-transition", "mkfs", "write-disk",
                          "workflow_dispatch", "Invoke-WebRequest", "curl ", "git push"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
