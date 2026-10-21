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


    def test_handoff_reason_tokens_are_reported_without_sensitive_values(self):
        text = SCRIPT.read_text(encoding="utf-8")
        for reason in ("handoff-metadata-gitdir", "handoff-metadata-head",
                       "handoff-metadata-origin", "handoff-metadata-branch",
                       "handoff-metadata-entrypoint", "handoff-ref-mismatch",
                       "handoff-commit-unavailable"):
            self.assertIn(reason, text)



if __name__ == "__main__":
    unittest.main()
