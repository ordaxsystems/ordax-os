"""CI release-candidate gating: cheap PR checks, full proof at ready-for-review.

These tests deliberately constrain only known six-hour/expensive workflows.
If a new heavy workflow appears, include it explicitly rather than weakening
the Owner release gate. Draft means 'development'; ready means candidate.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1] / ".github" / "workflows"
TARGETS = {
    "creator-owner-dev-git.yml": ("build-and-publish:", "if: github.event_name != 'pull_request' || !github.event.pull_request.draft"),
    "independent-surface-runtime.yml": ("buildroot-surface:", "if: needs.impact.outputs.required == 'true' && (github.event_name != 'pull_request' || !github.event.pull_request.draft)"),
    "portable-v2-qemu-boot-proof.yml": ("qemu-portable-v2:", "if: needs.impact.outputs.required == 'true' && (github.event_name != 'pull_request' || !github.event.pull_request.draft)"),
    "independent-base-experiment.yml": ("buildroot-qemu:", "if: github.event_name == 'workflow_dispatch' || (github.event_name == 'pull_request' && !github.event.pull_request.draft)"),
    "independent-portable-v2-integration.yml": ("independent-real-portable-qemu:", "if: github.event_name != 'pull_request' || !github.event.pull_request.draft"),
    "native-esp-candidate.yml": ("native-esp:", "if: github.event_name != 'pull_request' || !github.event.pull_request.draft"),
}


class ReleaseCandidateGateTests(unittest.TestCase):
    def test_every_heavy_workflow_runs_on_ready_and_manual_dispatch(self):
        for filename, (job, guard) in TARGETS.items():
            with self.subTest(filename=filename):
                text = (ROOT / filename).read_text(encoding="utf-8")
                events = text.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
                self.assertIn("pull_request:", events)
                self.assertIn("ready_for_review", events)
                self.assertIn("workflow_dispatch:", events)
                # Match actual two-space job headers; four-space properties must
                # not be mistaken for the next job (e.g. '    if:').
                jobs_text = "\n" + text.split("\njobs:\n", 1)[1]
                marker = "\n  " + job + "\n"
                self.assertIn(marker, jobs_text, filename)
                section = jobs_text.split(marker, 1)[1]
                first = "\n" + re.split(r"(?m)^  [A-Za-z][\w-]*:\s*$", section, maxsplit=1)[0]
                self.assertIn("\n    " + guard + "\n", first)
                self.assertNotIn("cancel-in-progress: true", text)

    def test_surface_contract_and_impact_run_while_draft(self):
        text = (ROOT / "independent-surface-runtime.yml").read_text(encoding="utf-8")
        for job in ("contract:", "impact:"):
            job_text = text.split("\n  " + job, 1)[1]
            job_text = re.split(r"(?m)^  [A-Za-z][\w-]*:\s*$", job_text, maxsplit=1)[0]
            self.assertNotIn("pull_request.draft", job_text)

    def test_portable_impact_is_always_checked_before_qemu(self):
        text = (ROOT / "portable-v2-qemu-boot-proof.yml").read_text(encoding="utf-8")
        self.assertIn("needs: impact", text)
        self.assertIn("needs.impact.outputs.required == 'true'", text)

    def test_release_surface_qemu_follows_exact_surface_producer(self):
        text = (ROOT / "independent-surface-runtime.yml").read_text(encoding="utf-8")
        dependent = text.split("\n  portable-qemu:\n", 1)[1]
        for marker in (
            "needs: buildroot-surface",
            "if: needs.buildroot-surface.result == 'success'",
            "uses: ./.github/workflows/portable-v2-qemu-boot-proof.yml",
            "base_source: independent",
            "surface_source: independent",
            "force_run: true",
        ):
            self.assertIn(marker, dependent)

    def test_no_heavy_test_waiver_for_release(self):
        for filename, (_, guard) in TARGETS.items():
            with self.subTest(filename=filename):
                text = (ROOT / filename).read_text(encoding="utf-8")
                self.assertIn(guard, text)
                self.assertIn("ready_for_review", text)


if __name__ == "__main__":
    unittest.main()
