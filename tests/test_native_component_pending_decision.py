from __future__ import annotations

import subprocess
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

import native_component_pending_decision as pending


class NativeComponentPendingDecisionTests(unittest.TestCase):
    def test_promotion_uses_exact_revision_trust_and_identity(self):
        commit = "a" * 40
        output = (
            "RUNTIME_COMPONENT_STATE_PROMOTED=YES\n"
            "COMPONENT_ID=notes\n"
            "REVISION=9\n"
            "CURRENT_VERSION=0.4.1\n"
            f"CURRENT_SOURCE_COMMIT={commit}\n"
            "RUNTIME_ACTIVATED=NO\n"
        ).encode("utf-8")
        completed = subprocess.CompletedProcess([], 0, stdout=output, stderr=b"")
        with mock.patch.object(pending.subprocess, "run", return_value=completed) as run:
            record = pending.promote_component_pending(
                helper_path="/signed/bin/helper",
                trust_path="/signed/trust.json",
                component_id="notes",
                version="0.4.1",
                source_commit=commit,
                expected_revision=8,
                slot_root="/var/lib/ordax/components",
            )

        self.assertEqual(record.action, "promote")
        self.assertEqual(record.revision, 9)
        argv = run.call_args.args[0]
        self.assertEqual(argv[1], "promote-state")
        self.assertEqual(argv[argv.index("--expected-revision") + 1], "8")
        self.assertEqual(argv[argv.index("--trust") + 1], "/signed/trust.json")
        self.assertEqual(argv[argv.index("--root") + 1], "/var/lib/ordax/components")
        self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)

    def test_rejection_uses_exact_revision_without_trust_argument(self):
        commit = "a" * 40
        output = (
            "RUNTIME_COMPONENT_PENDING_REJECTED=YES\n"
            "COMPONENT_ID=notes\n"
            "REVISION=9\n"
            "REJECTED_VERSION=0.4.1\n"
            f"REJECTED_SOURCE_COMMIT={commit}\n"
            "RUNTIME_ACTIVATED=NO\n"
        ).encode("utf-8")
        completed = subprocess.CompletedProcess([], 0, stdout=output, stderr=b"")
        with mock.patch.object(pending.subprocess, "run", return_value=completed) as run:
            record = pending.reject_component_pending(
                helper_path="/signed/bin/helper",
                component_id="notes",
                version="0.4.1",
                source_commit=commit,
                expected_revision=8,
                slot_root="/var/lib/ordax/components",
            )

        self.assertEqual(record.action, "reject")
        argv = run.call_args.args[0]
        self.assertEqual(argv[1], "reject-pending")
        self.assertNotIn("--trust", argv)

    def test_receipt_identity_and_revision_drift_fail_closed(self):
        commit = "a" * 40
        cases = [
            (
                (
                    "RUNTIME_COMPONENT_STATE_PROMOTED=YES\n"
                    "COMPONENT_ID=notes\n"
                    "REVISION=10\n"
                    "CURRENT_VERSION=0.4.1\n"
                    f"CURRENT_SOURCE_COMMIT={commit}\n"
                    "RUNTIME_ACTIVATED=NO\n"
                ).encode(),
                "revision did not advance exactly once",
            ),
            (
                (
                    "RUNTIME_COMPONENT_STATE_PROMOTED=YES\n"
                    "COMPONENT_ID=internet\n"
                    "REVISION=9\n"
                    "CURRENT_VERSION=0.4.1\n"
                    f"CURRENT_SOURCE_COMMIT={commit}\n"
                    "RUNTIME_ACTIVATED=NO\n"
                ).encode(),
                "component mismatch",
            ),
            (
                (
                    "RUNTIME_COMPONENT_STATE_PROMOTED=YES\n"
                    "COMPONENT_ID=notes\n"
                    "REVISION=9\n"
                    "CURRENT_VERSION=0.4.2\n"
                    f"CURRENT_SOURCE_COMMIT={commit}\n"
                    "RUNTIME_ACTIVATED=NO\n"
                ).encode(),
                "identity mismatch",
            ),
        ]
        for output, message in cases:
            with self.subTest(message=message):
                completed = subprocess.CompletedProcess([], 0, stdout=output, stderr=b"")
                with mock.patch.object(pending.subprocess, "run", return_value=completed):
                    with self.assertRaisesRegex(
                        pending.ComponentPendingDecisionError,
                        message,
                    ):
                        pending.promote_component_pending(
                            helper_path="/signed/bin/helper",
                            trust_path="/signed/trust.json",
                            component_id="notes",
                            version="0.4.1",
                            source_commit=commit,
                            expected_revision=8,
                            slot_root="/var/lib/ordax/components",
                        )

    def test_invalid_input_never_reaches_helper(self):
        with mock.patch.object(pending.subprocess, "run") as run:
            with self.assertRaises(pending.ComponentPendingDecisionError):
                pending.promote_component_pending(
                    helper_path="/signed/bin/helper",
                    trust_path="/signed/trust.json",
                    component_id="studio",
                    version="0.5.0",
                    source_commit="a" * 40,
                    expected_revision=8,
                    slot_root="/var/lib/ordax/components",
                )
            with self.assertRaises(pending.ComponentPendingDecisionError):
                pending.reject_component_pending(
                    helper_path="/signed/bin/helper",
                    component_id="notes",
                    version="bad",
                    source_commit="a" * 40,
                    expected_revision=8,
                    slot_root="/var/lib/ordax/components",
                )
        run.assert_not_called()

    def test_helper_failure_does_not_leak_stderr(self):
        completed = subprocess.CompletedProcess(
            [],
            1,
            stdout=b"",
            stderr=b"private helper failure detail",
        )
        with mock.patch.object(pending.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(
                pending.ComponentPendingDecisionError,
                "helper rejected request",
            ) as context:
                pending.reject_component_pending(
                    helper_path="/signed/bin/helper",
                    component_id="notes",
                    version="0.4.1",
                    source_commit="a" * 40,
                    expected_revision=8,
                    slot_root="/var/lib/ordax/components",
                )
        self.assertNotIn("private helper failure detail", str(context.exception))


if __name__ == "__main__":
    unittest.main()
