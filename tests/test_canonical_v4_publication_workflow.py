"""Fail-closed shape checks for the manual signed HTTPS publisher (no publishing)."""
from pathlib import Path
import hashlib
import json
import subprocess
import shutil
import tempfile
import os
import textwrap
import unittest
from unittest.mock import patch

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
        self.assertIn('os.environ["OPERATION"] == "publish" and os.environ["CONFIRM_TAG"] != tag', self.yaml)
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

    def test_live_operator_preflight_must_refuse_inactive_status(self):
        self.assertLess(
            self.yaml.index("operator-live-probe.json"),
            self.yaml.index("name: Download signed proof"),
        )
        # Exercise the exact predicate embedded in the workflow, not a copy
        # with subtly different fail-closed behavior.
        expr = self.yaml.split("          jq -e '", 1)[1].split(
            "' \"$RUNNER_TEMP/operator-live-probe.json\"", 1
        )[0]
        self.assertIn('.active == true', expr)
        self.assertIsNotNone(shutil.which("jq"), "jq must exist on Ubuntu runner")
        base = {
            "status": "live-artifacts-verified", "active": True,
            "signing_performed": False, "publication_performed": False,
            "physical_write_performed": False,
        }
        for field, value, expected in (
            ("active", True, True),
            ("active", False, False),
            ("status", "blocked", False),
            ("signing_performed", True, False),
            ("publication_performed", True, False),
            ("physical_write_performed", True, False),
        ):
            with self.subTest(field=field, value=value):
                input_doc = dict(base)
                input_doc[field] = value
                check = subprocess.run(
                    ["jq", "-e", expr], input=json.dumps(input_doc),
                    text=True, capture_output=True,
                )
                self.assertEqual(check.returncode == 0, expected, check.stderr)

    def test_publish_requires_official_main_and_verify_mode_is_read_only(self):
        self.assertIn("default: verify", self.yaml)
        self.assertIn("if: ${{ inputs.mode == 'publish' }}", self.yaml)
        self.assertIn('"$GITHUB_REF" != "refs/heads/main"', self.yaml)
        self.assertIn("PUBLICATION=BLOCKED_MAIN_MOVED_BEFORE_UPLOAD", self.yaml)
        self.assertIn("path: ${{ runner.temp }}/canonical-v4-readonly-plan.json", self.yaml)
        # Execute the actual production Bash gate, with only the gh metadata
        # query replaced by a deterministic local stub; no writes/network.
        block = self.yaml.split(
            "      - name: Prove official main owner and deliberate operation", 1
        )[1].split("      - name: Configure frozen Go toolchain", 1)[0]
        script = textwrap.dedent(block.split("        run: |", 1)[1])
        self.assertIn("gh api", script)
        self.assertIsNotNone(shutil.which("bash"), "production guard requires bash")
        self.assertIsNotNone(shutil.which("jq"), "production guard requires jq")
        local_sha = subprocess.check_output(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True
        ).strip()
        with tempfile.TemporaryDirectory() as directory:
            fake_gh = Path(directory) / "gh"
            fake_gh.write_text('#!/bin/sh\nprintf "%s\\n" "$FAKE_MAIN_SHA"\n',
                               encoding="utf-8")
            fake_gh.chmod(0o700)
            base = dict(os.environ)
            base.update({
                "PATH": directory + os.pathsep + os.environ["PATH"],
                "GITHUB_REPOSITORY": REPO, "REPO_SLUG": REPO,
                "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": local_sha,
                "FAKE_MAIN_SHA": local_sha, "OPERATION": "verify", "CONFIRM_TAG": "",
            })
            for overrides, accepted in [
                ({}, True),
                ({"GITHUB_REF": "refs/heads/feature"}, False),
                ({"GITHUB_REPOSITORY": "untrusted/fork"}, False),
                ({"FAKE_MAIN_SHA": "0" * 40}, False),
                ({"GITHUB_SHA": "0" * 40}, False),
                ({"OPERATION": "publish", "CONFIRM_TAG": ""}, False),
                ({"OPERATION": "verify", "CONFIRM_TAG": self.request["release_tag"]}, False),
                ({"OPERATION": "invalid"}, False),
                ({"OPERATION": "publish", "CONFIRM_TAG": self.request["release_tag"]}, True),
            ]:
                with self.subTest(overrides=overrides):
                    env = dict(base, **overrides)
                    result = subprocess.run(
                        ["bash", "-c", script], cwd=ROOT, env=env,
                        text=True, capture_output=True,
                    )
                    self.assertEqual(result.returncode == 0, accepted,
                                     result.stdout + result.stderr)

    def test_real_admission_python_accepts_verify_without_tag_and_rejects_wrong_publish(self):
        # Execute the literal Python admission script from the production YAML.
        # GH metadata is mocked; no publish action, network or devices are used.
        marker = "          python3 - <<'PY'"
        body = self.yaml.split(marker, 1)[1].split("          PY", 1)[0]
        script = textwrap.dedent(body)
        tag = self.request["release_tag"]
        by_id = {
            item["artifact_id"]: (item, self.request[kind]["run_id"])
            for kind, item in (
                ("signing_request", self.request["signing_request"]),
                ("signed_handoff", self.request["signed_handoff"]),
            )
        }

        def fake_gh(args, **_kwargs):
            route = args[-1]
            if "/actions/artifacts/" in route:
                aid = int(route.rsplit("/", 1)[1])
                item, run_id = by_id[aid]
                return json.dumps({
                    "id": aid, "name": item["artifact_name"],
                    "expired": False, "digest": "sha256:" + "a" * 64,
                    "workflow_run": {"id": run_id},
                }).encode()
            if "/actions/runs/" in route:
                rid = int(route.rsplit("/", 1)[1])
                if rid not in (x[1] for x in by_id.values()):
                    raise AssertionError("unexpected workflow run")
                return json.dumps({
                    "conclusion": "success", "status": "completed",
                    "repository": {"full_name": REPO},
                }).encode()
            raise AssertionError("unexpected gh API invocation: " + route)

        for operation, confirmed, allowed in (
            ("verify", "", True),
            ("publish", tag, True),
            ("publish", "", False),
            ("publish", "not-the-tag", False),
        ):
            with self.subTest(operation=operation, confirmed=confirmed):
                with patch.dict(os.environ, {
                    "OPERATION": operation, "CONFIRM_TAG": confirmed,
                }), patch("subprocess.check_output", side_effect=fake_gh):
                    if allowed:
                        exec(compile(script, "<canonical-v4-publish-admission>", "exec"), {})
                    else:
                        with self.assertRaises(SystemExit):
                            exec(compile(script, "<canonical-v4-publish-admission>", "exec"), {})

    def test_no_erofs_or_private_material_in_uploaded_receipt(self):
        self.assertIn("path: ${{ runner.temp }}/canonical-v4-publication-receipt.json", self.yaml)
        tail = self.yaml.split("- name: Save only the public publication receipt", 1)[1]
        self.assertNotIn(".erofs", tail)
        self.assertNotIn("release-ed25519.json", tail)


if __name__ == "__main__":
    unittest.main()
