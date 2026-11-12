#!/usr/bin/env python3
"""Safe diagnostics: never reveal arbitrary persistent power/Pull data."""
from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "bootstrap/dev-base/ordax-diagnose"


class OwnerDiagnosticReceiptTests(unittest.TestCase):
    def test_shell_syntax(self):
        subprocess.run(["/bin/sh", "-n", str(SCRIPT)], check=True)

    def test_only_safe_fields_are_printed(self):
        source = SCRIPT.read_text(encoding="utf-8")
        marker = "show_update_power_receipts() {"
        self.assertEqual(source.count(marker), 1)
        func = marker + source.split(marker, 1)[1].split("\n}\n", 1)[0] + "\n}\n"
        cases = [
            ("shutdown|private-boot-id|1792515039|failed\n", "handoff-validation\n",
             "power.last_action=shutdown", "power.last_status=failed", "pull.last_phase=handoff-validation"),
            ("not-an-action|SECRET|123|not-status\n", "token SECRET\n",
             "power.last_action=unknown", "power.last_status=unknown", "pull.last_phase=unknown"),
        ]
        cases += [
            ("restart|redacted|1792515039|syncing\n", "completed\n",
             "power.last_action=restart", "power.last_status=syncing", "pull.last_phase=completed"),
            ("shutdown|redacted|1792515039|pending\n", "helpers-pending\n",
             "power.last_action=shutdown", "power.last_status=pending", "pull.last_phase=helpers-pending"),
        ]
        for record, phase, action, status, pull in cases:
            with self.subTest(record=record):
                with tempfile.TemporaryDirectory() as folder:
                    root = Path(folder)
                    power, result = root / "power", root / "pull"
                    power.write_text(record, encoding="utf-8")
                    result.write_text(phase, encoding="utf-8")
                    stage, failure = root / "stage", root / "failure"
                    stage.write_text("supervisor-quiesce\n", encoding="utf-8")
                    failure.write_text("supervisor-quiesce-failed\n", encoding="utf-8")
                    env = {**os.environ, "POWER_LAST_REQUEST": str(power), "PULL_RESULT": str(result),
                           "POWER_LAST_STAGE": str(stage), "POWER_LAST_FAILURE": str(failure)}
                    proc = subprocess.run(["/bin/sh", "-c", func + "\nshow_update_power_receipts\n"],
                                          env=env, text=True, capture_output=True, check=True)
                    self.assertIn(action, proc.stdout)
                    self.assertIn(status, proc.stdout)
                    self.assertIn(pull, proc.stdout)
                    self.assertIn("power.last_stage=supervisor-quiesce", proc.stdout)
                    self.assertIn("power.last_failure=supervisor-quiesce-failed", proc.stdout)
                    self.assertNotIn("SECRET", proc.stdout)
                    self.assertNotIn("private-boot-id", proc.stdout)
                    self.assertNotIn("1792515039", proc.stdout)


    def test_cached_main_is_local_read_only_and_reports_exact_comparison(self):
        source = SCRIPT.read_text(encoding="utf-8")
        marker = "show_cached_main() {"
        self.assertEqual(source.count(marker), 1)
        func = marker + source.split(marker, 1)[1].split("\n}\n", 1)[0] + "\n}\n"
        self.assertNotIn("fetch", func.split("\n    cached_main=", 1)[1])
        self.assertNotIn("ls-remote", func)
        with tempfile.TemporaryDirectory(prefix="ordax-diagnose-cached-") as temp:
            repo = Path(temp) / "repo"
            repo.mkdir()
            def git(*args):
                return subprocess.run(["git", "-C", str(repo), *args],
                                      check=True, text=True, capture_output=True).stdout.strip()
            git("init", "-b", "main")
            git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "--allow-empty", "-m", "first")
            first = git("rev-parse", "HEAD")
            git("-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "--allow-empty", "-m", "second")
            second = git("rev-parse", "HEAD")
            git("update-ref", "refs/remotes/origin/main", second)
            env = {**os.environ, "WORKTREE": str(repo), "sha": first}
            command = func + "\nshow_cached_main\n"
            result = subprocess.run(["/bin/sh", "-c", command], env=env,
                                    check=True, text=True, capture_output=True)
            self.assertIn(f"pull.cached_main_sha={second}", result.stdout)
            self.assertIn("pull.cached_main_relation=differs-from-head", result.stdout)
            env["sha"] = second
            result = subprocess.run(["/bin/sh", "-c", command], env=env,
                                    check=True, text=True, capture_output=True)
            self.assertIn("pull.cached_main_relation=matches-head", result.stdout)
            git("update-ref", "-d", "refs/remotes/origin/main")
            result = subprocess.run(["/bin/sh", "-c", command], env=env,
                                    check=True, text=True, capture_output=True)
            self.assertIn("pull.cached_main_sha=unavailable", result.stdout)
            self.assertIn("pull.cached_main_relation=unavailable", result.stdout)

    def test_receipt_consistency_is_exact_sha_only_and_read_only(self):
        source = SCRIPT.read_text(encoding="utf-8")
        def function(name):
            marker = name + "() {"
            return marker + source.split(marker, 1)[1].split("\n}\n", 1)[0] + "\n}\n"

        helper = function("read_exact_sha_receipt") + function("show_checkout_receipt_consistency")
        self.assertNotIn("fetch ", helper)
        self.assertNotIn(" ls-remote ", helper)
        with tempfile.TemporaryDirectory(prefix="ordax-receipts-") as temp:
            root = Path(temp)
            current, helpers = root / "current", root / "helpers"
            old_sha, new_sha = "a" * 40, "b" * 40
            current.write_text(new_sha + "\n", encoding="ascii")
            helpers.write_text(old_sha + "\n", encoding="ascii")
            env = {**os.environ, "CURRENT_COMMIT_RECEIPT": str(current),
                   "DEV_HELPERS_RECEIPT": str(helpers), "sha": new_sha}
            def run():
                return subprocess.run(["/bin/sh", "-c", helper + "\nshow_checkout_receipt_consistency\n"],
                                      env=env, capture_output=True, text=True, check=True).stdout
            report = run()
            self.assertIn("pull.current_receipt_relation=matches-head", report)
            self.assertIn("pull.helpers_receipt_relation=differs-from-head", report)
            helpers.write_text(new_sha + "\n", encoding="ascii")
            self.assertIn("pull.helpers_receipt_relation=matches-head", run())
            helpers.write_text("SECRET\n", encoding="ascii")
            report = run()
            self.assertIn("pull.helpers_receipt_relation=unavailable", report)
            self.assertNotIn("SECRET", report)
            helpers.unlink()
            helpers.symlink_to(current)
            self.assertIn("pull.helpers_receipt_relation=unavailable", run())
            env["sha"] = "unavailable"
            self.assertIn("pull.current_receipt_relation=unavailable", run())

    def test_handoff_reason_tokens_are_reported_without_sensitive_values(self):
        text = SCRIPT.read_text(encoding="utf-8")
        for reason in ("handoff-metadata-gitdir", "handoff-metadata-head",
                       "handoff-metadata-origin", "handoff-metadata-branch",
                       "handoff-metadata-entrypoint", "handoff-ref-mismatch",
                       "handoff-commit-unavailable"):
            self.assertIn(reason, text)



if __name__ == "__main__":
    unittest.main()
