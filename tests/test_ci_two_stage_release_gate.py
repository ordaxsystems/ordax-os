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

    def test_independent_base_contract_remains_mandatory_in_draft(self):
        text = (ROOT / "independent-base-experiment.yml").read_text(encoding="utf-8")
        jobs = "\n" + text.split("\njobs:\n", 1)[1]
        self.assertIn("\n  independent-base-contract:\n", jobs)
        contract = jobs.split("\n  independent-base-contract:\n", 1)[1].split("\n  buildroot-qemu:\n", 1)[0]
        heavy = jobs.split("\n  buildroot-qemu:\n", 1)[1]
        self.assertIn("Verify isolated contract and regressions", contract)
        self.assertIn("tests.test_independent_owner_profile", contract)
        self.assertIn("outputs:\n      profile: ${{ steps.profile.outputs.profile }}", contract)
        self.assertNotIn("pull_request.draft", contract)
        self.assertIn("needs: independent-base-contract", heavy)
        self.assertIn("needs.independent-base-contract.outputs.profile", heavy)
        self.assertEqual(text.count("Verify isolated contract and regressions"), 1)

    def test_native_esp_contract_runs_in_draft_before_heavy_proof(self):
        text = (ROOT / "native-esp-candidate.yml").read_text(encoding="utf-8")
        jobs = "\n" + text.split("\njobs:\n", 1)[1]
        contract = jobs.split("\n  native-esp-contract:\n", 1)[1].split("\n  native-esp:\n", 1)[0]
        heavy = jobs.split("\n  native-esp:\n", 1)[1]
        self.assertNotIn("pull_request.draft", contract)
        self.assertIn("python3 boot/esp/build.py check", contract)
        self.assertIn("tests.test_native_esp_proof_contract", contract)
        self.assertIn("tests.test_native_qemu_boot_proof_contract", contract)
        self.assertIn("tests.test_native_qemu_boot_readiness", contract)
        self.assertIn("permissions:\n      contents: read", contract)
        self.assertNotIn("docker pull", contract)
        self.assertNotIn("apt-get install", contract)
        self.assertIn("needs: native-esp-contract", heavy)
        self.assertIn("Prove Native UEFI and PID1 handoff on disposable QEMU disk", heavy)

    def test_owner_fast_preflight_is_required_in_draft(self):
        workflow = (ROOT / "creator-owner-dev-git.yml").read_text(encoding="utf-8")
        jobs = workflow.split("\njobs:\n", 1)[1]
        self.assertIn("\n  owner-dev-contract:\n", "\n" + jobs)
        contract = jobs.split("  owner-dev-contract:\n", 1)[1].split("\n  build-and-publish:\n", 1)[0]
        heavy = jobs.split("\n  build-and-publish:\n", 1)[1]
        self.assertIn("tools/ci/preflight_owner_dev.py", contract)
        self.assertIn("tests.test_owner_surface_cache_contract", contract)
        self.assertIn("tests.test_ci_two_stage_release_gate", contract)
        self.assertIn("permissions:\n      contents: read", contract)
        self.assertNotIn("pull_request.draft", contract)
        self.assertIn("needs: owner-dev-contract", heavy)
        self.assertEqual(workflow.count("python3 tools/ci/preflight_owner_dev.py"), 1)

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

    def test_surface_cache_environment_matches_qemu_consumers(self):
        # ImageOS/ImageVersion are runner *shell* variables. GitHub's
        # ${{ env.ImageOS }} interpolation silently produces empty strings.
        # This previously produced Linux/X64// and isolated expensive
        # EROFS artifacts from the QEMU consumer's correct cache key.
        shell_export = (
            'export ORDAX_COMPONENT_CACHE_ENVIRONMENT='
            '"${RUNNER_OS:?}/${RUNNER_ARCH:?}/${ImageOS}/${ImageVersion}"'
        )
        for filename in (
            "independent-surface-runtime.yml",
            "creator-owner-dev-git.yml",
            "portable-v2-qemu-boot-proof.yml",
        ):
            with self.subTest(filename=filename):
                text = (ROOT / filename).read_text(encoding="utf-8")
                self.assertIn('test -n "${ImageOS:-}"', text)
                self.assertIn('test -n "${ImageVersion:-}"', text)
                self.assertIn(shell_export, text)
                self.assertNotIn("env.ImageOS", text)
                self.assertNotIn("env.ImageVersion", text)

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

    def test_independent_portable_qemu_preserves_running_proofs(self):
        text = (ROOT / "independent-portable-v2-integration.yml").read_text(encoding="utf-8")
        concurrency = text.split("\nconcurrency:\n", 1)[1].split("\njobs:\n", 1)[0]
        self.assertIn("cancel-in-progress: false", concurrency)
        self.assertNotIn("github.event_name == 'pull_request'", concurrency)
        self.assertIn("independent-real-portable-qemu:", text)
        self.assertIn(
            "github.event_name != 'pull_request' || !github.event.pull_request.draft",
            text,
        )

    def test_owner_buildroot_jobs_share_exact_serialization_key(self):
        # One pending heavy producer at a time for the same PR/ref. A source
        # SHA alone misses Creator/Surface concurrency and can duplicate
        # costly work despite their shared cache and artifact ownership.
        expected = (
            "group: ordax-surface-producer-"
            "${{ github.event.pull_request.number || github.ref }}"
        )
        for filename, job in (
            ("independent-surface-runtime.yml", "buildroot-surface"),
            ("creator-owner-dev-git.yml", "build-and-publish"),
            ("independent-base-experiment.yml", "buildroot-qemu"),
        ):
            with self.subTest(filename=filename):
                workflow = (ROOT / filename).read_text(encoding="utf-8")
                jobs = "\n" + workflow.split("\njobs:\n", 1)[1]
                section = jobs.split("\n  " + job + ":\n", 1)[1]
                section = re.split(
                    r"(?m)^  [A-Za-z][\w-]*:\s*$", section, maxsplit=1
                )[0]
                self.assertIn("    concurrency:\n", section)
                self.assertIn(expected, section)
                self.assertIn("cancel-in-progress: false", section)

    def test_no_heavy_test_waiver_for_release(self):
        for filename, (_, guard) in TARGETS.items():
            with self.subTest(filename=filename):
                text = (ROOT / filename).read_text(encoding="utf-8")
                self.assertIn(guard, text)
                self.assertIn("ready_for_review", text)


if __name__ == "__main__":
    unittest.main()
