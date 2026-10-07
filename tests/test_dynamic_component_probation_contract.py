from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"
DELEGATE = ROOT / "system" / "adapters" / "native" / "app-lifecycle-delegate.mjs"
POLICY = ROOT / "system" / "services" / "components" / "promotion-policy.mjs"


class DynamicComponentProbationContractTests(unittest.TestCase):
    def test_native_lifecycle_requests_probation_without_exposing_promotion(self):
        delegate = DELEGATE.read_text(encoding="utf-8")
        self.assertIn('type: "component.probation.request"', delegate)
        self.assertIn('new Set(["internet", "notes"])', delegate)
        self.assertIn('["install", "update"].includes(plan.request.operation)', delegate)
        self.assertNotIn("component.promote", delegate)
        self.assertNotIn("promotePending", delegate)

    def test_browser_host_owns_nonce_and_retrigger_boundary(self):
        host = HOST.read_text(encoding="utf-8")
        self.assertIn('SUPPORTED_PROBATION_COMPONENTS = ("internet", "notes")', host)
        self.assertIn("def start_component_probation", host)
        self.assertIn("secrets.token_urlsafe(32)", host)
        self.assertIn('elif command == "component.probation.request":', host)
        self.assertIn("self.handle_component_probation_request(payload)", host)
        self.assertIn("if component_id in self.component_probation_nonces:", host)
        self.assertIn("self.component_probation_nonces.pop(component_id, None)", host)
        self.assertIn("self.component_probation_rerun_requested: set[str] = set()", host)
        self.assertIn("self.component_probation_rerun_requested.add(component_id)", host)
        self.assertIn("rerun_requested = component_id in self.component_probation_rerun_requested", host)
        self.assertIn("self.component_probation_rerun_requested.discard(component_id)", host)
        self.assertIn("if rerun_requested:", host)

    def test_dynamic_probation_does_not_bypass_production_promotion_policy(self):
        delegate = DELEGATE.read_text(encoding="utf-8")
        host = HOST.read_text(encoding="utf-8")
        policy = POLICY.read_text(encoding="utf-8")
        self.assertNotIn("activationAllowed = true", delegate)
        self.assertNotIn("canonicalTrustPinned = true", delegate)
        self.assertNotIn("activationAllowed = true", host)
        self.assertNotIn("canonicalTrustPinned = true", host)
        self.assertIn('"canonical-component-trust-not-pinned"', policy)
        self.assertIn('"component-slot-activation-disabled"', policy)


if __name__ == "__main__":
    unittest.main()
