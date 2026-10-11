"""Fail-closed shape checks for the manual signed HTTPS publisher (no publishing)."""
from pathlib import Path
import hashlib
import json
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/canonical-v4-verified-publication.yml"
PUBLICATION = ROOT / "docs/contracts/canonical-v4-publication-request.json"
ACTIVE = ROOT / "docs/contracts/canonical-v4-signing-request-active.json"
PHYSICAL = ROOT / "docs/contracts/physical-write-authorization.json"
REPO = "ordaxsystems/ordax-os"


class SignedPublicationWorkflowContractTests(unittest.TestCase):
    def setUp(self):
        self.request = json.loads(PUBLICATION.read_text(encoding="utf-8"))
        self.active = json.loads(ACTIVE.read_text(encoding="utf-8"))
        self.physical = json.loads(PHYSICAL.read_text(encoding="utf-8"))
        self.yaml = WORKFLOW.read_text(encoding="utf-8")

    def test_frozen_commit_and_exact_tag_match_active_ssot(self):
        sha = self.request["source_commit"]
        self.assertRegex(sha, r"^[0-9a-f]{40}$")
        self.assertEqual(self.request["release_tag"], "ordax-stable-v4-" + sha)
        self.assertEqual(self.request["release_tag"], self.active["release_tag"])
        self.assertEqual(sha, self.active["source_commit"])
        self.assertEqual(self.request["source_repository"], REPO)
        self.assertEqual(self.request["$schema"], "prototype-ordax.canonical-v4-publication-request/1")

    def test_operator_receipts_are_versioned_and_explicit(self):
        sha = self.request["source_commit"]
        for kind, prefix in (("signing_request", "canonical-v4-signing-request-"),
                             ("signed_handoff", "canonical-v4-signed-handoff-proof-")):
            handle = self.request[kind]
            self.assertIs(type(handle["run_id"]), int)
            self.assertGreater(handle["run_id"], 0)
            self.assertIs(type(handle["artifact_id"]), int)
            self.assertGreater(handle["artifact_id"], 0)
            self.assertEqual(handle["artifact_name"], prefix + sha)

    def test_frozen_public_envelope_digest_is_bound_to_git_blob(self):
        sha = self.request["source_commit"]
        path = "docs/evidence/canonical-v4-signed-envelope-" + sha + ".json"
        data = subprocess.check_output(["git", "-C", str(ROOT), "show", "HEAD:" + path])
        self.assertEqual(hashlib.sha256(data).hexdigest(), self.request["release_envelope_sha256"])

    def test_no_physical_or_release_authority_granted(self):
        self.assertFalse(self.physical["physical_write_allowed"])
        self.assertFalse(self.physical["explicit_owner_authorization"])
        for field in ("publication_performed", "release_activated",
                      "physical_write_authorized", "physical_write_performed"):
            self.assertIs(self.request[field], False)

    def test_workflow_is_manual_only_and_uses_exact_core_owners(self):
        self.assertIn("  workflow_dispatch:", self.yaml)
        self.assertNotIn("\n  push:", self.yaml)
        self.assertNotIn("\n  pull_request:", self.yaml)
        self.assertIn("CONFIRM_TAG: ${{ inputs.confirm_tag }}", self.yaml)
        self.assertIn('os.environ["CONFIRM_TAG"] != tag', self.yaml)
        self.assertIn("tools/release-operator/probe_active_operator_artifacts.py", self.yaml)
        self.assertIn("tools/release-operator/export_exact_signed_envelope.py", self.yaml)
        self.assertIn("tools/release-operator/publish_verified_v4_release.py", self.yaml)
        self.assertIn("go build -trimpath -buildvcs=false", self.yaml)

    def test_publication_step_is_behind_agent_and_receipt_verification(self):
        self.assertLess(self.yaml.index("name: Admit only exact signed candidate"),
                        self.yaml.index("name: Download signed proof"))
        self.assertLess(self.yaml.index("name: Build frozen Linux release-agent"),
                        self.yaml.index("name: Publish only remotely verified assets"))
        self.assertIn("contents: write", self.yaml)
        self.assertIn("--publish --confirm-tag", self.yaml)
        self.assertIn("physical_write_authorized == false", self.yaml)
        self.assertNotIn("--clobber", self.yaml)
        self.assertNotIn(" gh release delete ", self.yaml)
        self.assertNotIn("gh release upload", self.yaml)
        self.assertNotIn("signing-private", self.yaml)

    def test_no_erofs_or_private_material_in_uploaded_receipt(self):
        self.assertIn("path: ${{ runner.temp }}/canonical-v4-publication-receipt.json", self.yaml)
        tail = self.yaml.split("- name: Save only the public publication receipt", 1)[1]
        self.assertNotIn(".erofs", tail)
        self.assertNotIn("release-ed25519.json", tail)


if __name__ == "__main__":
    unittest.main()
