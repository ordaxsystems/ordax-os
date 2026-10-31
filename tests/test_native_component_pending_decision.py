from __future__ import annotations

import subprocess
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

import native_component_pending_decision as pending
import native_component_pending_decision_owner as owner
import native_store_metadata_policy as native_policy
from native_store_metadata_policy import NATIVE_HEALTH_MUTATION_COMPONENT_IDS


class NativeComponentPendingDecisionTests(unittest.TestCase):
    def test_pending_decision_uses_canonical_health_scope(self):
        policy = json.loads(
            (ROOT / "docs/contracts/runtime-component-package.json").read_text(encoding="utf-8")
        )
        self.assertIs(pending.SUPPORTED_COMPONENTS, NATIVE_HEALTH_MUTATION_COMPONENT_IDS)
        self.assertEqual(
            pending.SUPPORTED_COMPONENTS,
            frozenset(policy["native_loopback_broker_health_mutation_components"]),
        )
        self.assertNotIn("network", pending.SUPPORTED_COMPONENTS)
        self.assertNotIn("studio", pending.SUPPORTED_COMPONENTS)

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
        lifecycle_owner = owner.ComponentPendingDecisionOwner(
            helper_path="/signed/bin/helper",
            trust_path="/signed/trust.json",
            slot_root="/var/lib/ordax/components",
        )
        return lifecycle_owner.execute(plan)

    def test_generated_owner_gates_match_canonical_fail_closed_policy(self):
        policy = json.loads(
            (ROOT / "docs/contracts/runtime-component-package.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            native_policy.NATIVE_PENDING_DECISION_EXECUTION_ENABLED,
            policy["component_promotion_policy_executes_actions"],
        )
        self.assertEqual(
            native_policy.NATIVE_CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED,
            policy["canonical_component_trust_anchor_pinned"],
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
        self.assertFalse(native_policy.NATIVE_CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED)
        self.assertFalse(native_policy.NATIVE_SLOT_ACTIVATION_AVAILABLE)
        self.assertFalse(native_policy.NATIVE_PENDING_HEALTH_PROMOTION_AVAILABLE)
        self.assertEqual(native_policy.NATIVE_PROBATION_COMPONENT_IDS, frozenset({"files", "notes"}))
        self.assertEqual(native_policy.NATIVE_PENDING_DECISION_COMPONENT_IDS, frozenset({"notes"}))

    def test_execution_request_cannot_retarget_runtime_bindings(self):
        lifecycle_owner = owner.ComponentPendingDecisionOwner(
            helper_path="/signed/bin/helper",
            trust_path="/signed/trust.json",
            slot_root="/var/lib/ordax/components",
        )
        with self.assertRaises(TypeError):
            lifecycle_owner.execute(
                self.plan(),
                helper_path="/tmp/attacker-helper",
            )

    def test_owner_hold_is_always_non_mutating(self):
        with mock.patch.object(owner, "promote_component_pending") as promote, mock.patch.object(
            owner, "reject_component_pending"
        ) as reject:
            result = self.execute(self.plan())
        self.assertEqual(result.state, "held")
        self.assertFalse(result.mutated)
        self.assertEqual(result.revision, 8)
        promote.assert_not_called()
        reject.assert_not_called()

    def test_owner_reject_is_blocked_while_policy_is_planning_only(self):
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

    def test_owner_promote_is_blocked_while_policy_is_planning_only(self):
        plan = self.plan(action="promote", reason="eligible-for-promotion")
        with mock.patch.object(owner, "promote_component_pending") as promote:
            result = self.execute(plan)
        self.assertEqual(result.state, "blocked")
        self.assertEqual(result.reason, "pending-decision-execution-disabled")
        self.assertFalse(result.mutated)
        promote.assert_not_called()

    def test_future_promotion_requires_canonical_trust_even_with_activation_gates(self):
        plan = self.plan(action="promote", reason="eligible-for-promotion")
        with mock.patch.object(owner, "NATIVE_PENDING_DECISION_EXECUTION_ENABLED", True), mock.patch.object(
            owner, "NATIVE_CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED", False
        ), mock.patch.object(
            owner, "NATIVE_SLOT_ACTIVATION_AVAILABLE", True
        ), mock.patch.object(
            owner, "NATIVE_PENDING_HEALTH_PROMOTION_AVAILABLE", True
        ), mock.patch.object(owner, "promote_component_pending") as promote:
            result = self.execute(plan)
        self.assertEqual(result.state, "blocked")
        self.assertEqual(result.reason, "canonical-component-trust-not-pinned")
        promote.assert_not_called()

    def test_future_promotion_still_requires_both_activation_gates(self):
        plan = self.plan(action="promote", reason="eligible-for-promotion")
        with mock.patch.object(owner, "NATIVE_PENDING_DECISION_EXECUTION_ENABLED", True), mock.patch.object(
            owner, "NATIVE_CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED", True
        ), mock.patch.object(
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
            owner, "NATIVE_CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED", True
        ), mock.patch.object(
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

    def test_malformed_or_unsupported_owner_plan_never_reaches_adapter(self):
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
