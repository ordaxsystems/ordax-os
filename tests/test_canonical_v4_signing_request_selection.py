"""The historical source cannot silently become a canonical release request."""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "tools/release-operator/select_active_signing_request.py"
spec = importlib.util.spec_from_file_location("select_active_signing_request", SCRIPT)
import sys
sys.path.insert(0, str(SCRIPT.parent))
selector = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(selector)


class CanonicalSigningRequestSelectionTests(unittest.TestCase):
    def sandbox(self, tmp):
        root = Path(tmp)
        old = root / selector.HISTORICAL_PATH
        old.parent.mkdir(parents=True)
        old.write_bytes((ROOT / selector.HISTORICAL_PATH).read_bytes())
        return root

    def approved_shape(self, root):
        old = json.loads((root / selector.HISTORICAL_PATH).read_text(encoding="utf-8"))
        result = json.loads(json.dumps(old))
        old_owner = selector.HISTORICAL_OWNER
        new_owner = selector.REPOSITORY
        result["source_repository"] = new_owner
        result["source_commit"] = "1" * 40
        result["release_tag"] = "ordax-stable-v4-" + result["source_commit"]
        for entry in result["operator_artifacts"].values():
            entry["run_id"] += 700
            entry["artifact_id"] += 700
            entry["artifact_name"] = entry["artifact_name"].replace(old["source_commit"], result["source_commit"])
        for name, url in result["artifact_urls"].items():
            result["artifact_urls"][name] = url.replace(old_owner, new_owner).replace(old["source_commit"], result["source_commit"])
        return result

    def test_no_active_request_is_explicitly_blocked_without_signing(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = selector.selection(self.sandbox(tmp))
            self.assertFalse(state["active"])
            self.assertEqual(state["status"], "blocked-no-canonical-operator-request")
            self.assertFalse(state["signing_performed"])
            self.assertFalse(state["publication_performed"])

    def test_historical_bytes_tampered_are_rejected_not_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.sandbox(tmp)
            p = root / selector.HISTORICAL_PATH
            p.write_bytes(p.read_bytes() + b" \n")
            with self.assertRaisesRegex(selector.ValidationError, "provenance changed"):
                selector.selection(root)

    def test_only_distinct_canonical_request_is_eligible(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.sandbox(tmp)
            p = root / selector.ACTIVE_PATH
            valid = self.approved_shape(root)
            p.write_text(json.dumps(valid), encoding="utf-8")
            state = selector.selection(root)
            self.assertTrue(state["active"])
            self.assertEqual(state["source_repository"], selector.REPOSITORY)
            self.assertFalse(state["signing_performed"])
            valid["source_repository"] = selector.HISTORICAL_OWNER
            p.write_text(json.dumps(valid), encoding="utf-8")
            with self.assertRaisesRegex(selector.ValidationError, "source repository"):
                selector.selection(root)

    def test_never_reuse_historical_run_or_artifact_or_source_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = self.sandbox(tmp)
            p = root / selector.ACTIVE_PATH
            good = self.approved_shape(root)
            old = json.loads((root / selector.HISTORICAL_PATH).read_text(encoding="utf-8"))
            for field in ("run_id", "artifact_id"):
                modified = json.loads(json.dumps(good))
                modified["operator_artifacts"]["system"][field] = old["operator_artifacts"]["system"][field]
                p.write_text(json.dumps(modified), encoding="utf-8")
                with self.assertRaisesRegex(selector.ValidationError, "reuses historical"):
                    selector.selection(root)
            old_commit = json.loads(json.dumps(good))
            old_commit["source_commit"] = old["source_commit"]
            old_commit["release_tag"] = old["release_tag"]
            for spec in old_commit["operator_artifacts"].values():
                spec["artifact_name"] = spec["artifact_name"].replace("1" * 40, old["source_commit"])
            old_commit["artifact_urls"] = {k:v.replace("1" * 40, old["source_commit"]) for k,v in old_commit["artifact_urls"].items()}
            p.write_text(json.dumps(old_commit), encoding="utf-8")
            with self.assertRaisesRegex(selector.ValidationError, "historical source commit"):
                selector.selection(root)


    def test_request_byte_pin_survives_checkout_and_gitattributes(self):
        import hashlib
        import subprocess

        for path in (
            selector.HISTORICAL_PATH,
            selector.ACTIVE_PATH,
            Path("docs/evidence/rename-ordax-os/canonical-v4-pre-rename-request.json"),
        ):
            relative = path.as_posix()
            attrs = subprocess.check_output(
                ["git", "check-attr", "text", "eol", "--", relative],
                cwd=ROOT, text=True,
            )
            self.assertIn(f"{relative}: text: set", attrs)
            self.assertIn(f"{relative}: eol: lf", attrs)
        original = (ROOT / selector.HISTORICAL_PATH).read_bytes()
        git_blob = hashlib.sha1(
            b"blob " + str(len(original)).encode("ascii") + b"\0" + original
        ).hexdigest()
        self.assertEqual(git_blob, selector.HISTORICAL_GIT_BLOB)


    def test_retired_unsigned_request_keeps_exact_pre_rename_bytes(self):
        import hashlib

        archived_path = ROOT / "docs/evidence/rename-ordax-os/canonical-v4-pre-rename-request.json"
        raw = archived_path.read_bytes()
        blob = hashlib.sha1(
            b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw
        ).hexdigest()
        self.assertEqual(blob, "c003cf92c58c9945bf07f63de5e9e2c8321f2b2e")
        issued = json.loads(raw)
        self.assertEqual(issued["source_repository"], "ordaxsystems/prototipo-ordax-os")
        self.assertEqual(
            issued["source_commit"],
            "6a629922d9acbbdca4229f115567d929d5efbec6",
        )
        for field in selector.UNSAFE_FIELDS:
            self.assertIs(issued[field], False)

        # New active requests cannot re-authorize a pre-rename issued request.
        active_path = ROOT / selector.ACTIVE_PATH
        if active_path.exists():
            current = json.loads(active_path.read_text(encoding="utf-8"))
            self.assertEqual(current["source_repository"], "ordaxsystems/ordax-os")
            self.assertNotEqual(current["source_commit"], issued["source_commit"])
            for kind in issued["operator_artifacts"]:
                self.assertNotEqual(
                    current["operator_artifacts"][kind]["artifact_id"],
                    issued["operator_artifacts"][kind]["artifact_id"],
                )

    def test_workflow_never_runs_assembly_for_history_or_unreviewed_pr(self):
        workflow = (ROOT / ".github/workflows/canonical-v4-signing-request.yml").read_text(encoding="utf-8")
        self.assertIn("needs.classify_request.outputs.active == 'true'", workflow)
        self.assertIn("github.event_name != 'pull_request'", workflow)
        self.assertIn("CANONICAL_V4_UNSIGNED_ASSEMBLY=BLOCKED_NO_CANONICAL_REQUEST", workflow)
        self.assertIn("CANONICAL_V4_REQUEST_PATH: docs/contracts/canonical-v4-signing-request-active.json", workflow)
        self.assertNotIn("--request docs/contracts/canonical-v4-signing-request.json", workflow)


if __name__ == "__main__":
    unittest.main()
