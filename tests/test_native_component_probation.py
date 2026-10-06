#!/usr/bin/env python3
"""Regression tests for the internal Native component probation bridge."""

from __future__ import annotations

import importlib
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

probation = importlib.import_module("native_component_probation")
slots = importlib.import_module("native_component_slots")

COMMIT = "a" * 40


def message(*, component_id="internet", nonce="nonce-1", health="healthy", version="0.4.0", source_commit=COMMIT, revision=7):
    return {
        "type": "component.probation.result",
        "nonce": nonce,
        "result": {
            "schema": "ordax.component-probation-result/1",
            "componentId": component_id,
            "version": version,
            "sourceCommit": source_commit,
            "revision": revision,
            "health": health,
            "probeMode": "import-contract",
        },
    }


class NativeComponentProbationTests(unittest.TestCase):
    def test_exact_nonce_and_receipt_record_health_once(self):
        record = slots.ComponentHealthRecord(
            component_id="internet",
            revision=8,
            version="0.4.0",
            source_commit=COMMIT,
            health="healthy",
        )
        with mock.patch.object(
            probation,
            "record_component_pending_health",
            return_value=record,
        ) as recorder:
            outcome = probation.record_system_component_probation(
                payload=message(),
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )

        self.assertTrue(outcome.actionable)
        self.assertEqual(outcome.recorded, record)
        self.assertEqual(outcome.reason, "recorded")
        recorder.assert_called_once_with(
            helper_path="/signed/helper",
            component_id="internet",
            version="0.4.0",
            source_commit=COMMIT,
            expected_revision=7,
            health="healthy",
            slot_root="/var/lib/ordax/components",
        )

    def test_nonce_mismatch_fails_before_recorder(self):
        with mock.patch.object(probation, "record_component_pending_health") as recorder:
            with self.assertRaises(probation.ComponentProbationReceiptError):
                probation.record_system_component_probation(
                    payload=message(nonce="wrong"),
                    expected_nonce="nonce-1",
                    helper_path="/signed/helper",
                    slot_root="/var/lib/ordax/components",
                )
        recorder.assert_not_called()

    def test_missing_pending_identity_is_non_actionable(self):
        payload = message()
        payload["result"]["version"] = None
        payload["result"]["sourceCommit"] = None
        payload["result"]["revision"] = None
        payload["result"]["health"] = "failed"
        payload["result"]["error"] = "no pending slot"

        with mock.patch.object(probation, "record_component_pending_health") as recorder:
            outcome = probation.record_system_component_probation(
                payload=payload,
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )

        self.assertFalse(outcome.actionable)
        self.assertIsNone(outcome.recorded)
        self.assertEqual(outcome.reason, "no-actionable-pending-identity")
        recorder.assert_not_called()

    def test_failed_probation_is_recorded_for_complete_identity(self):
        record = slots.ComponentHealthRecord(
            component_id="internet",
            revision=8,
            version="0.4.0",
            source_commit=COMMIT,
            health="failed",
        )
        with mock.patch.object(
            probation,
            "record_component_pending_health",
            return_value=record,
        ) as recorder:
            outcome = probation.record_system_component_probation(
                payload=message(health="failed"),
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )
        self.assertEqual(outcome.recorded.health, "failed")
        self.assertEqual(recorder.call_args.kwargs["health"], "failed")

    def test_recorder_rejection_is_contained_and_never_promotes(self):
        with mock.patch.object(
            probation,
            "record_component_pending_health",
            side_effect=slots.ComponentSlotVerificationError("stale revision"),
        ):
            outcome = probation.record_system_component_probation(
                payload=message(),
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )
        self.assertTrue(outcome.actionable)
        self.assertIsNone(outcome.recorded)
        self.assertIn("health-recorder-rejected", outcome.reason)

    def test_probe_mode_is_fixed_and_supported_components_are_explicit(self):
        bad_probe = message()
        bad_probe["result"]["probeMode"] = "app-defined"
        with self.assertRaises(probation.ComponentProbationReceiptError):
            probation.record_system_component_probation(
                payload=bad_probe,
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )

        notes_record = slots.ComponentHealthRecord(
            component_id="notes",
            revision=8,
            version="0.4.1",
            source_commit=COMMIT,
            health="healthy",
        )
        with mock.patch.object(
            probation,
            "record_component_pending_health",
            return_value=notes_record,
        ) as recorder:
            outcome = probation.record_system_component_probation(
                payload=message(component_id="notes", version="0.4.1"),
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )
        self.assertEqual(outcome.recorded, notes_record)
        self.assertEqual(recorder.call_args.kwargs["component_id"], "notes")

        bad_component = message(component_id="assistant")
        with self.assertRaises(probation.ComponentProbationReceiptError):
            probation.record_system_component_probation(
                payload=bad_component,
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )


if __name__ == "__main__":
    unittest.main()
