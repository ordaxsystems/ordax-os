"""Creator rolling release: never overwrite a newer USB producer with stale bytes."""
from pathlib import Path
import subprocess
import tempfile
import unittest

from tools.ci.creator_owner_publish_freshness import (
    freshness_decision, check_official_main, MAIN_FETCH_DEPTH,
)

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/creator-owner-dev-git.yml"


class CreatorMainFreshnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        for args in (("init", "-q"), ("config", "user.email", "ci@example.invalid"),
                     ("config", "user.name", "CI")):
            subprocess.run(("git", "-C", str(self.repo), *args),
                           check=True, capture_output=True)

    def commit(self, path: str):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("changed\n" + str(target.stat().st_size if target.exists() else 0),
                          encoding="utf-8")
        subprocess.run(("git", "-C", str(self.repo), "add", "-A"),
                       check=True, capture_output=True)
        subprocess.run(("git", "-C", str(self.repo), "commit", "-qm", "fixture"),
                       check=True, capture_output=True)
        return subprocess.check_output(
            ("git", "-C", str(self.repo), "rev-parse", "HEAD"), text=True
        ).strip()

    def test_exact_main_can_publish(self):
        source = self.commit("bootstrap/dev-base/ordax-pull")
        self.assertEqual(
            freshness_decision(source, source, root=self.repo), (True, "current-main")
        )

    def test_newer_documentation_does_not_lose_valid_usb_candidate(self):
        source = self.commit("bootstrap/dev-base/ordax-pull")
        latest = self.commit("docs/BUILD-AUTONOMY.md")
        self.assertEqual(
            freshness_decision(source, latest, root=self.repo),
            (True, "newer-main-nonproducer-only"),
        )

    def test_newer_pull_change_must_skip_stale_creator(self):
        source = self.commit("bootstrap/dev-base/ordax-pull")
        latest = self.commit("bootstrap/dev-base/ordax-pull")
        publish, reason = freshness_decision(source, latest, root=self.repo)
        self.assertFalse(publish)
        self.assertIn("bootstrap/dev-base/ordax-pull", reason)

    def test_newer_native_or_boot_change_must_skip(self):
        source = self.commit("docs/BUILD-AUTONOMY.md")
        for path in ("bootstrap/dev-base/build.py",
                     "bootstrap/dev-base/ordax_checkout_exchange.c",
                     "bootstrap/initramfs/build.py", "system/supervisor",
                     "docs/contracts/unknown-owner.json"):
            with self.subTest(path=path):
                latest = self.commit(path)
                allowed, _ = freshness_decision(source, latest, root=self.repo)
                self.assertFalse(allowed)

    def test_non_ancestor_fails_closed(self):
        source = self.commit("bootstrap/dev-base/ordax-pull")
        subprocess.run(("git", "-C", str(self.repo), "checkout", "--orphan", "unrelated"),
                       check=True, capture_output=True)
        latest = self.commit("docs/BUILD-AUTONOMY.md")
        with self.assertRaisesRegex(ValueError, "ancestry"):
            freshness_decision(source, latest, root=self.repo)

    def test_invalid_revisions_and_untrusted_remote_fail_closed(self):
        source = self.commit("bootstrap/dev-base/ordax-pull")
        with self.assertRaisesRegex(ValueError, "SHA"):
            freshness_decision("not-a-sha", source, root=self.repo)
        with self.assertRaises(subprocess.CalledProcessError):
            check_official_main(source, root=self.repo)
        self.assertEqual(MAIN_FETCH_DEPTH, 128)

    def test_build_autonomy_contract_documents_safe_main_release_policy(self):
        import json
        contract = json.loads((ROOT / "docs/contracts/build-autonomy.json").read_text(encoding="utf-8"))
        policy = contract["owner_dev_pull_ci"]["creator_main_freshness"]
        self.assertEqual(policy["owner"], "tools/ci/creator_owner_publish_freshness.py")
        for key in ("validate_before_expensive_main_build",
                    "revalidate_immediately_before_release_upload",
                    "newer_main_producer_change_blocks_stale_publication",
                    "newer_main_nonproducer_only_change_may_reuse_proven_usb",
                    "non_ancestor_or_unavailable_main_fails_closed",
                    "do_not_cancel_in_progress_main_build",
                    "do_not_disable_required_usb_qemu_proofs"):
            self.assertTrue(policy[key])
        self.assertFalse(policy["creator_media_release_changes_installed_git_pull"])

    def test_workflow_guards_work_before_heavy_job_and_before_upload(self):
        flow = WORKFLOW.read_text(encoding="utf-8")
        gate = "tools/ci/creator_owner_publish_freshness.py"
        self.assertIn(gate, flow)
        self.assertIn("steps.freshness.outputs.publish_allowed != 'false'", flow)
        self.assertEqual(flow.count("python3 " + gate), 2)
        self.assertIn("Skip superseded main USB production", flow)
        pub = flow.index("      - name: Publish development Creator bundle")
        verify = flow.index("python3 " + gate, pub)
        upload = flow.index("gh release upload creator-owner-prototype", pub)
        self.assertLess(verify, upload)
        self.assertIn("'CREATOR_MAIN_FRESHNESS=SKIP '*", flow[pub:upload])
        # No replacement scheduler, rebuild loop or unsafe cancellation.
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", flow)


if __name__ == "__main__":
    unittest.main()
