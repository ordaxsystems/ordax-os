#!/usr/bin/env python3
"""Read-only Creator payload candidate: OS assembles, immutable Creator verifies."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/creator-payload-candidate.yml"
SOURCE = ROOT / "docs/contracts/native-release-assembly.json"
MANIFEST = ROOT / "docs/contracts/minimal-bootstrap.json"

class CreatorPayloadExternalSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.source = json.loads(SOURCE.read_text(encoding="utf-8"))["creator_source"]
        cls.manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))

    def test_exact_standalone_source_single_pin_no_legacy_go(self):
        w = self.workflow
        self.assertEqual(self.source["repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(self.source["publisher_authority"], "ordaxsystems/ordax-os")
        self.assertIs(self.source["physical_apply_authorized"], False)
        self.assertEqual(w.count("uses: ./.github/actions/resolve-creator-source"), 1)
        self.assertIn("docs/contracts/native-release-assembly.json", w)
        self.assertIn("git -C \"$creator\" rev-parse 'HEAD^{tree}'", w)
        self.assertIn("go test -count=1 ./cmd/ordax-creator ./core", w)
        self.assertIn('cd "$creator"', w)
        self.assertIn("./cmd/ordax-creator", w)
        self.assertNotIn("cd tools/creator", w)
        self.assertNotIn("go run ./cmd/ordax-creator", w)
        self.assertNotIn("'tools/creator/core/**'", w)
        self.assertNotIn("'tools/creator/cmd/**'", w)

    def test_draft_pr_only_runs_light_contract_and_ready_restarts_heavy(self):
        text = self.workflow
        self.assertIn(
            "types: [opened, synchronize, reopened, ready_for_review]", text
        )
        jobs = text.split("\njobs:\n", 1)[1]
        self.assertIn("\n  creator-payload-contract:\n", "\n" + jobs)
        contract, heavy = jobs.split("\n  creator-payload:\n", 1)
        for test in (
            "tests.test_creator_payload_external_source",
            "tests.test_kernel_consumer_ssot",
            "tests.test_creator_payload_assembler",
        ):
            self.assertIn(test, contract)
        self.assertIn("fetch-depth: 2", contract)
        self.assertIn('["git", "fetch", "--no-tags", "--depth=1", "origin", revision]', contract)
        self.assertIn('["git", "cat-file", "-e", revision + "^{commit}"]', contract)
        self.assertIn("required: ${{ steps.impact.outputs.required }}", contract)
        self.assertIn("persist-credentials: false", contract)
        for build in ("bootstrap/kernel/build.py build", "boot/esp/build.py build",
                      "bootstrap/initramfs/build.py build", "go build"):
            self.assertNotIn(build, contract)
        self.assertIn("needs: creator-payload-contract", heavy)
        self.assertIn(
            "if: needs.creator-payload-contract.outputs.required == 'true' && (github.event_name != 'pull_request' || !github.event.pull_request.draft)",
            heavy,
        )
        self.assertIn("Build kernel candidate on verified cache miss", heavy)
        self.assertIn("queue: max", heavy)

    def test_only_executed_contract_tests_skip_heavy_build(self):
        w = self.workflow
        prefix = "          python3 - <<'PY'\n"
        self.assertEqual(w.count(prefix), 1)
        script = textwrap.dedent(w.split(prefix, 1)[1].split("\n          PY", 1)[0])
        with tempfile.TemporaryDirectory(prefix="ordax-creator-payload-impact-") as temp:
            root = Path(temp)

            def git(*args):
                return subprocess.check_output(
                    ["git", "-C", str(root), *args], stderr=subprocess.PIPE, text=True
                ).strip()

            for argv in (
                ("init", "-q"),
                ("config", "user.email", "ci@example.invalid"),
                ("config", "user.name", "CI"),
            ):
                git(*argv)
            tracked = (
                "tests/test_creator_payload_external_source.py",
                "tests/test_kernel_consumer_ssot.py",
                "tests/test_creator_payload_assembler.py",
                "bootstrap/kernel/source.json",
                "docs/contracts/minimal-bootstrap.json",
            )
            for name in tracked:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("before\n", encoding="utf-8")
            git("add", "-A")
            git("commit", "-qm", "base")
            base = git("rev-parse", "HEAD")

            def change(name):
                (root / name).write_text("changed\n", encoding="utf-8")
                git("add", "-A")
                git("commit", "-qm", "change")
                return git("rev-parse", "HEAD")

            def classified(base_sha, head_sha, event="pull_request", checkout_root=None):
                output = root / "scope.out"
                output.write_text("", encoding="utf-8")
                env = {
                    **os.environ,
                    "ORDAX_EVENT_NAME": event,
                    "ORDAX_BASE_SHA": base_sha,
                    "ORDAX_HEAD_SHA": head_sha,
                    "GITHUB_OUTPUT": str(output),
                }
                finished = subprocess.run(
                    [sys.executable, "-c", script], cwd=checkout_root or root, env=env,
                    capture_output=True, text=True, timeout=20, check=True,
                )
                value = output.read_text(encoding="utf-8").strip()
                self.assertIn("CREATOR_PAYLOAD_HEAVY_REQUIRED=", finished.stdout)
                return value

            tests_only = change("tests/test_creator_payload_external_source.py")
            # Shallow GitHub checkout has HEAD but may lack the exact PR base.
            # Fetching that SHA must preserve the light result without cloning
            # full repository history or trusting an unverified range.
            with tempfile.TemporaryDirectory(prefix="ordax-creator-shallow-") as checkout:
                remote = Path(checkout) / "remote.git"
                shallow = Path(checkout) / "checkout"
                subprocess.run(
                    ["git", "init", "--bare", "-q", str(remote)],
                    check=True, capture_output=True,
                )
                git("remote", "add", "origin", str(remote))
                git("push", "-q", "origin", f"{tests_only}:refs/heads/main")
                subprocess.run(
                    ["git", "clone", "-q", "--depth=1", "--branch", "main",
                     remote.as_uri(), str(shallow)],
                    check=True, capture_output=True,
                )
                self.assertNotEqual(
                    subprocess.run(
                        ["git", "-C", str(shallow), "cat-file", "-e", base + "^{commit}"],
                        capture_output=True,
                    ).returncode, 0,
                )
                self.assertEqual(
                    classified(base, tests_only, checkout_root=shallow), "required=false"
                )
                self.assertEqual(
                    subprocess.run(
                        ["git", "-C", str(shallow), "cat-file", "-e", base + "^{commit}"],
                        capture_output=True,
                    ).returncode, 0,
                )
            self.assertEqual(classified(base, tests_only), "required=false")
            self.assertEqual(classified(base, tests_only, "push"), "required=false")
            self.assertEqual(classified(base, tests_only, "workflow_dispatch"), "required=true")
            self.assertEqual(classified(tests_only, tests_only), "required=true")
            self.assertEqual(classified("0" * 40, tests_only), "required=true")
            self.assertEqual(classified("f" * 40, tests_only), "required=true")

            mixed = change("bootstrap/kernel/source.json")
            self.assertEqual(classified(base, mixed), "required=true")
            self.assertEqual(classified(tests_only, mixed), "required=true")
            manifest = change("docs/contracts/minimal-bootstrap.json")
            self.assertEqual(classified(mixed, manifest), "required=true")

    def test_payload_kernel_uses_shared_verified_producer_queue(self):
        workflow = self.workflow
        owner = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text(encoding="utf-8")
        group = "group: ordax-surface-producer-${{ github.event.pull_request.number || github.ref }}"
        kernel_cache_key = (
            "ordax-portable-component-v1-${{ runner.os }}-${{ runner.arch }}-"
            "kernel-${{ steps.component-fingerprints.outputs.kernel }}"
        )
        # Two independent candidate jobs may be needed, but only one can
        # compile the same immutable kernel on a miss at a time.
        for source in (workflow, owner):
            self.assertIn(group, source)
            self.assertIn(kernel_cache_key, source)
            self.assertIn("      cancel-in-progress: false\n      queue: max", source)
            self.assertIn("Build kernel candidate on verified cache miss", source)
            self.assertIn("Verify kernel component and exact integration binding", source)
        self.assertNotIn("cancel-in-progress: true", workflow)
        self.assertIn("group: creator-payload-candidate-${{ github.ref }}", workflow)
        self.assertEqual(workflow.count("Build kernel candidate on verified cache miss"), 1)

    def test_payload_trigger_has_no_alpine_stable_dependency(self):
        workflow = self.workflow
        self.assertNotIn("bootstrap/base/alpine_core.py", workflow)
        self.assertNotIn("bootstrap/stable-base/build.py", workflow)
        self.assertIn("bootstrap/kernel/**", workflow)
        self.assertIn("bootstrap/initramfs/**", workflow)
        self.assertIn("tools/creator/assemble.py", workflow)

    def test_os_manifest_assembler_and_source_identity_remain_authoritative(self):
        w = self.workflow
        self.assertEqual(self.manifest["$schema"], "prototype-ordax.minimal-bootstrap/4")
        self.assertIs(self.manifest["physical_write_allowed"], False)
        self.assertIn('ORDAX_SOURCE_COMMIT: ${{ github.event.pull_request.head.sha || github.sha }}', w)
        self.assertIn("python tools/creator/assemble.py build", w)
        self.assertIn("python tools/creator/assemble.py verify", w)
        self.assertIn('manifest="$GITHUB_WORKSPACE/docs/contracts/minimal-bootstrap.json"', w)
        self.assertIn('payload="$GITHUB_WORKSPACE/out/creator-payload"', w)
        self.assertIn('creator="$RUNNER_TEMP/creator-payload-cli/ordax-creator"', w)
        self.assertIn("CREATOR_PAYLOAD_OS_SOURCE_COMMIT", w)
        self.assertIn("CREATOR_IMPLEMENTATION_SOURCE_COMMIT", w)
        self.assertIn("PAYLOAD_VERIFIED=YES", w)
        self.assertIn("DISPOSABLE_TREE_STAGED=YES", w)

    def test_fail_closed_candidate_without_publisher_or_physical_authority(self):
        w = self.workflow
        self.assertIn("permissions:\n  contents: read", w)
        self.assertNotIn("gh release", w)
        self.assertNotIn("contents: write", w)
        self.assertIn("PHYSICAL_WRITE_STATUS=blocked", w)
        self.assertIn("CREATOR_PAYLOAD_CLI_PHYSICAL_WRITE=NOT_AUTHORIZED", w)
        self.assertIn("uses: actions/upload-artifact@", w)
        self.assertIn("out/creator-payload/", w)

if __name__ == "__main__":
    unittest.main()
