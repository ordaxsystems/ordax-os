import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHECKER_PATH = ROOT / "tools" / "runtime-component-channel" / "check_production_readiness.py"

spec = importlib.util.spec_from_file_location("check_production_readiness", CHECKER_PATH)
checker = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(checker)


def write_contracts(root: Path, *, anchor=False, publish=False, activate=False):
    contracts = root / "docs" / "contracts"
    contracts.mkdir(parents=True)

    trust = {
        "$schema": checker.TRUST_POLICY_SCHEMA,
        "status": "canonical-public-trust-pinned" if anchor else "operator-ceremony-pending",
        "trust_domain": checker.TRUST_DOMAIN,
        "key_id": checker.KEY_ID,
        "current_gates": {
            "canonical_component_trust_anchor_pinned": anchor,
            "component_publish_allowed": publish,
            "production_component_slot_activation_allowed": activate,
        },
    }

    package = {
        "$schema": checker.PACKAGE_POLICY_SCHEMA,
        "trust_domain": checker.TRUST_DOMAIN,
        "canonical_component_trust_anchor_pinned": anchor,
        "publish_allowed": publish,
        "slot_activation_available": activate,
        "signature_required_before_activation": True,
        "activation_allowed_from_unsigned_candidate": False,
        "direct_activation_allowed_from_signed_package": False,
        "pending_health_required_before_promotion": True,
        "immutable_slot_staging_available": True,
        "activation_state_machine_available": True,
        "activation_state_revalidates_signed_slots": True,
        "activation_state_requires_component_slot_release_mode": True,
        "verified_runtime_file_read_available": True,
        "runtime_file_read_revalidates_slot_and_hash": True,
        "runtime_health_bridge_available": True,
        "component_promotion_policy_available": True,
        "component_promotion_policy_requires_canonical_trust_for_promote": True,
        "component_promotion_policy_requires_activation_gate_for_promote": True,
        "whole_os_release_trust_may_be_implicitly_reused": False,
        "pending_health_promotion_available": activate,
        "rollback_slot_activation_available": activate,
        "native_slot_serving_available": activate,
    }

    (contracts / "runtime-component-trust-policy.json").write_text(
        json.dumps(trust),
        encoding="utf-8",
    )
    (contracts / "runtime-component-package.json").write_text(
        json.dumps(package),
        encoding="utf-8",
    )


class RuntimeComponentProductionReadinessTests(unittest.TestCase):
    def test_current_fail_closed_state_reports_all_three_blockers(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_contracts(root)
            result = checker.evaluate(root)
            self.assertFalse(result["authorized"])
            self.assertEqual(
                result["blockers"],
                [
                    "canonical-runtime-component-trust-anchor-not-pinned",
                    "component-publication-not-authorized",
                    "production-component-slot-activation-not-authorized",
                ],
            )

    def test_anchor_only_state_reports_publication_and_activation_blockers(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_contracts(root, anchor=True)
            result = checker.evaluate(root)
            self.assertTrue(result["anchor_pinned"])
            self.assertFalse(result["publication_allowed"])
            self.assertEqual(
                result["blockers"],
                [
                    "component-publication-not-authorized",
                    "production-component-slot-activation-not-authorized",
                ],
            )

    def test_publication_state_reports_only_activation_blocker(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_contracts(root, anchor=True, publish=True)
            result = checker.evaluate(root)
            self.assertTrue(result["publication_allowed"])
            self.assertEqual(
                result["blockers"],
                ["production-component-slot-activation-not-authorized"],
            )

    def test_authorized_state_requires_runtime_activation_capabilities(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_contracts(root, anchor=True, publish=True, activate=True)
            result = checker.evaluate(root)
            self.assertTrue(result["authorized"])
            self.assertEqual(result["blockers"], [])

    def test_publication_cannot_precede_anchor(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_contracts(root, publish=True)
            with self.assertRaises(checker.ReadinessError):
                checker.evaluate(root)

    def test_activation_cannot_precede_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_contracts(root, anchor=True, activate=True)
            with self.assertRaises(checker.ReadinessError):
                checker.evaluate(root)

    def test_package_policy_must_match_trust_policy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_contracts(root, anchor=True)
            package_path = root / checker.PACKAGE_POLICY
            package = json.loads(package_path.read_text(encoding="utf-8"))
            package["canonical_component_trust_anchor_pinned"] = False
            package_path.write_text(json.dumps(package), encoding="utf-8")
            with self.assertRaises(checker.ReadinessError):
                checker.evaluate(root)


if __name__ == "__main__":
    unittest.main()
