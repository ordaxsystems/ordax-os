import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "infra/supabase/functions/ordax-account-gateway/index.ts"
PYTHON_GATEWAY = ROOT / "services/public-identity/gateway.py"


def edge_registration_enabled(source: str) -> bool:
    match = re.search(r"const\s+ACCOUNT_REGISTRATION_ENABLED\s*=\s*(true|false)\s*;", source)
    if not match:
        raise AssertionError("ACCOUNT_REGISTRATION_ENABLED constant is missing")
    return match.group(1) == "true"


def edge_has_request_bound_legal_acceptance(source: str) -> bool:
    # A legal intent is not sufficient if the Edge gateway manufactures p_accepted=true.
    # Registration must first compare the value parsed from this specific request.
    patterns = (
        r"legalAcceptance\s*!==\s*LEGAL_ACCEPTANCE_VALUE",
        r"LEGAL_ACCEPTANCE_VALUE\s*!==\s*legalAcceptance",
    )
    return any(re.search(pattern, source) for pattern in patterns)


class AccountRegistrationActivationGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.edge = EDGE.read_text(encoding="utf-8")
        cls.python = PYTHON_GATEWAY.read_text(encoding="utf-8")

    def test_registration_remains_fail_closed_while_edge_request_validation_is_pending(self):
        has_validation = edge_has_request_bound_legal_acceptance(self.edge)
        if not has_validation:
            self.assertFalse(
                edge_registration_enabled(self.edge),
                "public registration cannot be enabled until the Edge gateway validates legal_acceptance from the request",
            )

    def test_database_intent_true_literal_is_not_mistaken_for_user_acceptance(self):
        self.assertIn("p_accepted: true", self.edge)
        self.assertFalse(
            edge_has_request_bound_legal_acceptance(self.edge),
            "remove this expectation after the Edge request-bound validation is implemented",
        )

    def test_reference_gateway_already_enforces_request_bound_acceptance(self):
        self.assertIn('form.get(LEGAL_ACCEPTANCE_FIELD, "") != LEGAL_ACCEPTANCE_VALUE', self.python)
        self.assertIn('"legal-acceptance-required"', self.python)


if __name__ == "__main__":
    unittest.main()
