#!/usr/bin/env python3
"""Regression tests for the internal Native component probation bridge."""

from __future__ import annotations

import importlib
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

probation = importlib.import_module("native_component_probation")
from native_store_metadata_policy import NATIVE_PROBATION_COMPONENT_IDS, NATIVE_HEALTH_MUTATION_COMPONENT_IDS
slots = importlib.import_module("native_component_slots")

COMMIT = "a" * 40


def message(
    *,
    component_id="internet",
    nonce="nonce-1",
    health="healthy",
    version=None,
    source_commit=COMMIT,
    revision=7,
):
    if version is None:
        version = "0.4.1" if component_id == "notes" else "0.4.0"
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
    def test_system_probation_scope_is_canonical_and_read_only_until_authorized(self):
        policy = json.loads(
            (ROOT / "docs/contracts/runtime-component-package.json").read_text(encoding="utf-8")
        )
        self.assertIs(probation.SUPPORTED_COMPONENTS, NATIVE_PROBATION_COMPONENT_IDS)
        self.assertEqual(
            probation.SUPPORTED_COMPONENTS,
            frozenset(policy["runtime_health_bridge_supported_components"]),
        )
        self.assertTrue(probation.SUPPORTED_COMPONENTS.issubset(NATIVE_HEALTH_MUTATION_COMPONENT_IDS))
        self.assertNotIn("calculator", probation.SUPPORTED_COMPONENTS)
        self.assertNotIn("studio", probation.SUPPORTED_COMPONENTS)
        self.assertEqual(probation.PROBE_MODE, policy["runtime_health_bridge_probe_mode"])

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
                expected_component_id="internet",
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

    def test_notes_receipt_records_only_notes_pending_health(self):
        record = slots.ComponentHealthRecord(
            component_id="notes",
            revision=8,
            version="0.4.1",
            source_commit=COMMIT,
            health="healthy",
        )
        with mock.patch.object(
            probation,
            "record_component_pending_health",
            return_value=record,
        ) as recorder:
            outcome = probation.record_system_component_probation(
                payload=message(component_id="notes", nonce="notes-nonce"),
                expected_component_id="notes",
                expected_nonce="notes-nonce",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )
        self.assertEqual(outcome.recorded, record)
        self.assertEqual(recorder.call_args.kwargs["component_id"], "notes")
        self.assertEqual(recorder.call_args.kwargs["version"], "0.4.1")
        self.assertEqual(recorder.call_args.kwargs["expected_revision"], 7)

    def test_nonce_mismatch_fails_before_recorder(self):
        with mock.patch.object(probation, "record_component_pending_health") as recorder:
            with self.assertRaises(probation.ComponentProbationReceiptError):
                probation.record_system_component_probation(
                    payload=message(nonce="wrong"),
                    expected_component_id="internet",
                    expected_nonce="nonce-1",
                    helper_path="/signed/helper",
                    slot_root="/var/lib/ordax/components",
                )
        recorder.assert_not_called()

    def test_cross_component_nonce_reuse_and_component_retarget_fail_closed(self):
        with mock.patch.object(probation, "record_component_pending_health") as recorder:
            with self.assertRaisesRegex(
                probation.ComponentProbationReceiptError,
                "nonce",
            ):
                probation.record_system_component_probation(
                    payload=message(component_id="notes", nonce="internet-nonce"),
                    expected_component_id="notes",
                    expected_nonce="notes-nonce",
                    helper_path="/signed/helper",
                    slot_root="/var/lib/ordax/components",
                )

            with self.assertRaisesRegex(
                probation.ComponentProbationReceiptError,
                "attempt mismatch",
            ):
                probation.record_system_component_probation(
                    payload=message(component_id="internet", nonce="notes-nonce"),
                    expected_component_id="notes",
                    expected_nonce="notes-nonce",
                    helper_path="/signed/helper",
                    slot_root="/var/lib/ordax/components",
                )
        recorder.assert_not_called()

    def test_missing_pending_identity_is_non_actionable(self):
        payload = message(health="failed")
        payload["result"]["version"] = None
        payload["result"]["sourceCommit"] = None
        payload["result"]["revision"] = None
        payload["result"]["error"] = "no pending slot"

        with mock.patch.object(probation, "record_component_pending_health") as recorder:
            outcome = probation.record_system_component_probation(
                payload=payload,
                expected_component_id="internet",
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )

        self.assertFalse(outcome.actionable)
        self.assertIsNone(outcome.recorded)
        self.assertEqual(outcome.reason, "no-actionable-pending-identity")
        recorder.assert_not_called()

    def test_partial_pending_identity_is_rejected(self):
        payload = message(health="failed")
        payload["result"]["sourceCommit"] = None
        with mock.patch.object(probation, "record_component_pending_health") as recorder:
            with self.assertRaisesRegex(
                probation.ComponentProbationReceiptError,
                "incomplete component probation identity",
            ):
                probation.record_system_component_probation(
                    payload=payload,
                    expected_component_id="internet",
                    expected_nonce="nonce-1",
                    helper_path="/signed/helper",
                    slot_root="/var/lib/ordax/components",
                )
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
                expected_component_id="internet",
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
                expected_component_id="internet",
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )
        self.assertTrue(outcome.actionable)
        self.assertIsNone(outcome.recorded)
        self.assertIn("health-recorder-rejected", outcome.reason)

    def test_message_type_probe_mode_and_supported_components_are_fixed(self):
        bad_type = message()
        bad_type["type"] = "component.promote"
        with self.assertRaises(probation.ComponentProbationReceiptError):
            probation.record_system_component_probation(
                payload=bad_type,
                expected_component_id="internet",
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )

        bad_probe = message()
        bad_probe["result"]["probeMode"] = "app-defined"
        with self.assertRaises(probation.ComponentProbationReceiptError):
            probation.record_system_component_probation(
                payload=bad_probe,
                expected_component_id="internet",
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )

        bad_component = message(component_id="assistant")
        with self.assertRaises(probation.ComponentProbationReceiptError):
            probation.record_system_component_probation(
                payload=bad_component,
                expected_component_id=None,
                expected_nonce="nonce-1",
                helper_path="/signed/helper",
                slot_root="/var/lib/ordax/components",
            )


if __name__ == "__main__":
    unittest.main()
