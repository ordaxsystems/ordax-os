"""Owner USB causal classification: no boot/provenance bypass on unknown deltas."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from tools.ci import creator_owner_impact as impact

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/creator-owner-dev-git.yml"
VISUAL = {
    "$schema": "prototype-ordax.surface-source/1", "status": "canonical",
    "source_repository": "ordaxsystems/ordax-surface", "source_commit": "a" * 40,
    "visual_source_paths": ["system/surface/ui", "system/surface/workspace"],
    "os_host_paths": ["system/surface/entrypoint"],
}

class CreatorOwnerImpactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for cmd in (["init", "-q"], ["config", "user.email", "ci@example.invalid"],
                    ["config", "user.name", "CI"]):
            subprocess.run(["git", "-C", str(self.root), *cmd], check=True, capture_output=True)

    def commit(self, workflow=None, lock=None, path=None):
        if workflow is not None:
            f = self.root / impact.WORKFLOW
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(workflow, encoding="utf-8")
        if lock is not None:
            f = self.root / impact.SURFACE_LOCK
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(lock) + "\n", encoding="utf-8")
        if path is not None:
            f = self.root / path
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text("changed\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.root), "commit", "-qm", "test"], check=True)
        return subprocess.check_output(["git", "-C", str(self.root), "rev-parse", "HEAD"], text=True).strip()

    def test_real_current_workflow_keeps_full_usb_on_push_or_unknown_changes(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("needs: impact", text)
        self.assertIn("if: needs.impact.outputs.required == 'true'", text)
        self.assertIn("CREATOR_OWNER_USB_REQUIRED=", (ROOT / "tools/ci/creator_owner_impact.py").read_text())
        self.assertIn("github.event_name", text)
        self.assertIn("gh release upload creator-owner-prototype", text)
        self.assertEqual(text.count("build-and-publish:"), 1)

    def test_canonical_visual_and_ci_only_changes_skip_real_usb(self):
        base_source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(impact.EXPECTED_IMPACT_JOB, base_source)
        # Simulate the exact previous Creator workflow: remove the added gate
        # and reinstate only the three preexisting presentation triggers.
        before_source = base_source.replace(impact.EXPECTED_IMPACT_JOB, "\n")
        before_source = before_source.replace(
            "\n  build-and-publish:\n    needs: impact\n    if: needs.impact.outputs.required == 'true'\n",
            "\n  build-and-publish:\n",
        )
        old_pr = before_source.index("  pull_request:\n")
        pre, post = before_source[:old_pr], before_source[old_pr:]
        for selector in impact.PR_ADDED:
            post = post.replace(f"      - '{selector}'\n", "")
        for selector in impact.PR_REMOVED:
            post = post.replace("  pull_request:\n    paths:\n", f"  pull_request:\n    paths:\n      - '{selector}'\n", 1)
        before_source = pre + post
        for selector in impact.PUSH_EXCLUDES:
            before_source = before_source.replace(f"      - '{selector}'\n", "")
        base = self.commit(before_source, VISUAL)
        after = self.commit(base_source, {**VISUAL, "source_commit": "b" * 40},
                            "system/adapters/desktop/local-ai-host.mjs")
        self.assertTrue(impact.workflow_trigger_only(base, after, root=self.root))
        self.assertEqual(impact.classify(base, after, root=self.root), (False, "nonproducer-contract-only"))

    def test_boot_and_unknown_owner_changes_require_real_usb(self):
        base = self.commit(WORKFLOW.read_text(encoding="utf-8"), VISUAL)
        for path in ("bootstrap/initramfs/build.py", "bootstrap/surface-runtime/build.py",
                     "system/supervisor", "tools/creator/assemble.py",
                     "docs/contracts/unknown-owner.json"):
            with self.subTest(path=path):
                current = self.commit(path=path)
                self.assertTrue(impact.classify(base, current, root=self.root)[0])

    def test_new_workflow_producer_step_forces_usb(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        base = self.commit(workflow, VISUAL)
        changed = workflow.replace("timeout-minutes: 120", "timeout-minutes: 125")
        self.assertNotEqual(workflow, changed)
        current = self.commit(changed)
        self.assertTrue(impact.classify(base, current, root=self.root)[0])

    def test_malformed_revisions_and_nonvisual_pin_fail_closed(self):
        base = self.commit(WORKFLOW.read_text(encoding="utf-8"), VISUAL)
        current = self.commit(lock={**VISUAL, "source_commit": "b" * 40,
                                    "os_host_paths": ["system/entrypoint"]})
        self.assertTrue(impact.classify(base, current, root=self.root)[0])
        self.assertTrue(impact.classify("not-a-sha", current, root=self.root)[0])

if __name__ == "__main__":
    unittest.main()
