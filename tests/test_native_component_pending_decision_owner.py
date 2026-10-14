from __future__ import annotations

import json
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

import native_component_pending_decision_owner as owner
import native_store_metadata_policy as native_policy


class NativeComponentPendingDecisionOwnerTests(unittest.TestCase):
    def plan(self, **overrides):
        value = {
            "schema": owner.PLAN_SCHEMA,
            "componentId": "notes",
            "version": "0.4.1",
            "sourceCommit": "a" * 40,
            "revision": 8,
            "health": "healthy",
            "action": "hold",
            "reason": "canonical-component-trust-not-pinned",
            "authority": "none",
        }
        value.update(overrides)
        return value

    def execute(self, plan):
        return owner.execute_component_pending_decision_plan(
            plan,
            helper_path="/signed/bin/helper",
            trust_path="/signed/trust.json",
            slot_root="/var/lib/ordax/components",
        )

    def test_generated_pending_decision_gates_match_canonical_fail_closed_policy(self):
        policy = json.loads(
            (ROOT / "docs/contracts/runtime-component-package.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            native_policy.NATIVE_PENDING_DECISION_EXECUTION_ENABLED,
            policy["component_promotion_policy_executes_actions"],
        )
        self.assertEqual(
            native_policy.NATIVE_SLOT_ACTIVATION_AVAILABLE,
            policy["slot_activation_available"],
        )
        self.assertEqual(
            native_policy.NATIVE_PENDING_HEALTH_PROMOTION_AVAILABLE,
            policy["pending_health_promotion_available"],
        )
        self.assertFalse(native_policy.NATIVE_PENDING_DECISION_EXECUTION_ENABLED)
        self.assertFalse(native_policy.NATIVE_SLOT_ACTIVATION_AVAILABLE)
        self.assertFalse(native_policy.NATIVE_PENDING_HEALTH_PROMOTION_AVAILABLE)
        self.assertEqual(native_policy.NATIVE_PROBATION_COMPONENT_IDS, frozenset({"notes"}))
        self.assertNotIn("files", native_policy.NATIVE_PROBATION_COMPONENT_IDS)

    def test_hold_is_always_non_mutating(self):
        with mock.patch.object(owner, "promote_component_pending") as promote, mock.patch.object(
            owner, "reject_component_pending"
        ) as reject:
            result = self.execute(self.plan())
        self.assertEqual(result.state, "held")
        self.assertFalse(result.mutated)
        self.assertEqual(result.revision, 8)
        promote.assert_not_called()
        reject.assert_not_called()

    def test_reject_is_blocked_while_policy_remains_planning_only(self):
        plan = self.plan(
            health="failed",
            action="reject",
            reason="pending-health-failed",
        )
        with mock.patch.object(owner, "promote_component_pending") as promote, mock.patch.object(
            owner, "reject_component_pending"
        ) as reject:
            result = self.execute(plan)
        self.assertEqual(result.state, "blocked")
        self.assertEqual(result.reason, "pending-decision-execution-disabled")
        self.assertFalse(result.mutated)
        promote.assert_not_called()
        reject.assert_not_called()

    def test_promote_is_blocked_while_policy_remains_planning_only(self):
        plan = self.plan(action="promote", reason="eligible-for-promotion")
        with mock.patch.object(owner, "promote_component_pending") as promote:
            result = self.execute(plan)
        self.assertEqual(result.state, "blocked")
        self.assertEqual(result.reason, "pending-decision-execution-disabled")
        self.assertFalse(result.mutated)
        promote.assert_not_called()

    def test_future_promotion_still_requires_both_activation_gates(self):
        plan = self.plan(action="promote", reason="eligible-for-promotion")
        with mock.patch.object(owner, "NATIVE_PENDING_DECISION_EXECUTION_ENABLED", True), mock.patch.object(
            owner, "NATIVE_SLOT_ACTIVATION_AVAILABLE", True
        ), mock.patch.object(
            owner, "NATIVE_PENDING_HEALTH_PROMOTION_AVAILABLE", False
        ), mock.patch.object(owner, "promote_component_pending") as promote:
            result = self.execute(plan)
        self.assertEqual(result.state, "blocked")
        self.assertEqual(result.reason, "component-promotion-gates-closed")
        promote.assert_not_called()

    def test_future_reject_preserves_exact_identity_and_revision(self):
        plan = self.plan(
            health="failed",
            action="reject",
            reason="pending-health-failed",
        )
        applied = types.SimpleNamespace(action="reject", revision=9)
        with mock.patch.object(owner, "NATIVE_PENDING_DECISION_EXECUTION_ENABLED", True), mock.patch.object(
            owner, "reject_component_pending", return_value=applied
        ) as reject:
            result = self.execute(plan)
        self.assertEqual(result.state, "applied")
        self.assertTrue(result.mutated)
        self.assertEqual(result.revision, 9)
        reject.assert_called_once_with(
            helper_path="/signed/bin/helper",
            component_id="notes",
            version="0.4.1",
            source_commit="a" * 40,
            expected_revision=8,
            slot_root="/var/lib/ordax/components",
            timeout_seconds=3.0,
        )

    def test_future_promote_preserves_trust_identity_and_revision(self):
        plan = self.plan(action="promote", reason="eligible-for-promotion")
        applied = types.SimpleNamespace(action="promote", revision=9)
        with mock.patch.object(owner, "NATIVE_PENDING_DECISION_EXECUTION_ENABLED", True), mock.patch.object(
            owner, "NATIVE_SLOT_ACTIVATION_AVAILABLE", True
        ), mock.patch.object(
            owner, "NATIVE_PENDING_HEALTH_PROMOTION_AVAILABLE", True
        ), mock.patch.object(
            owner, "promote_component_pending", return_value=applied
        ) as promote:
            result = self.execute(plan)
        self.assertEqual(result.state, "applied")
        self.assertTrue(result.mutated)
        self.assertEqual(result.revision, 9)
        promote.assert_called_once_with(
            helper_path="/signed/bin/helper",
            trust_path="/signed/trust.json",
            component_id="notes",
            version="0.4.1",
            source_commit="a" * 40,
            expected_revision=8,
            slot_root="/var/lib/ordax/components",
            timeout_seconds=3.0,
        )

    def test_malformed_or_unsupported_plan_never_reaches_mutation_adapter(self):
        cases = [
            self.plan(componentId="files"),
            self.plan(authority="platform"),
            self.plan(action="reject", health="healthy", reason="pending-health-failed"),
            self.plan(extra=True),
        ]
        with mock.patch.object(owner, "promote_component_pending") as promote, mock.patch.object(
            owner, "reject_component_pending"
        ) as reject:
            for value in cases:
                with self.subTest(value=value):
                    with self.assertRaises(owner.ComponentPendingDecisionOwnerError):
                        self.execute(value)
        promote.assert_not_called()
        reject.assert_not_called()

    def test_owner_is_not_mounted_by_native_host_or_browser_health_bridge(self):
        native_host = (RUNTIME / "native_host_server.py").read_text(encoding="utf-8")
        browser_host = (RUNTIME / "ordax_browser_host.py").read_text(encoding="utf-8")
        symbol = "native_component_pending_decision_owner"
        self.assertNotIn(symbol, native_host)
        self.assertNotIn(symbol, browser_host)


if __name__ == "__main__":
    unittest.main()
