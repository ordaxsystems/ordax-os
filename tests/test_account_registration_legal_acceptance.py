from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
EDGE_GATEWAY = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
PYTHON_GATEWAY = ROOT / "services" / "public-identity" / "gateway.py"


class AccountRegistrationLegalAcceptanceTests(unittest.TestCase):
    def test_edge_gateway_rejects_missing_or_non_affirmative_acceptance_before_signup(self):
        text = EDGE_GATEWAY.read_text(encoding="utf-8")

        read_marker = 'const legalAcceptance = form.get(LEGAL_ACCEPTANCE_FIELD) ?? "";'
        reject_marker = "if (register && legalAcceptance !== LEGAL_ACCEPTANCE_VALUE) {"
        intent_marker = "registrationIntentId = await beginRegistrationLegalIntent(email, legalAcceptance);"
        signup_marker = "? await supabase.auth.signUp({"

        self.assertIn(read_marker, text)
        self.assertIn(reject_marker, text)
        self.assertIn('"registration-legal-acceptance-required"', text)
        self.assertIn(intent_marker, text)
        self.assertIn(signup_marker, text)

        self.assertLess(text.index(read_marker), text.index(reject_marker))
        self.assertLess(text.index(reject_marker), text.index(intent_marker))
        self.assertLess(text.index(intent_marker), text.index(signup_marker))

    def test_edge_legal_intent_never_converts_client_omission_into_acceptance(self):
        text = EDGE_GATEWAY.read_text(encoding="utf-8")

        self.assertIn(
            "async function beginRegistrationLegalIntent(email: string, legalAcceptance: string)",
            text,
        )
        self.assertIn(
            "if (legalAcceptance !== LEGAL_ACCEPTANCE_VALUE) {",
            text,
        )
        self.assertIn(
            "p_accepted: legalAcceptance === LEGAL_ACCEPTANCE_VALUE",
            text,
        )
        self.assertNotIn("p_accepted: true", text)

    def test_python_and_edge_boundaries_require_the_same_affirmative_value(self):
        edge = EDGE_GATEWAY.read_text(encoding="utf-8")
        python = PYTHON_GATEWAY.read_text(encoding="utf-8")

        self.assertIn('const LEGAL_ACCEPTANCE_VALUE = "accepted";', edge)
        self.assertIn('LEGAL_ACCEPTANCE_VALUE = "accepted"', python)
        self.assertIn(
            'form.get(LEGAL_ACCEPTANCE_FIELD, "") != LEGAL_ACCEPTANCE_VALUE',
            python,
        )

    def test_public_registration_stays_fail_closed_until_remaining_release_gates_pass(self):
        text = EDGE_GATEWAY.read_text(encoding="utf-8")

        self.assertIn("const PUBLIC_SITE_ACCOUNT_ENABLED = true;", text)
        self.assertIn("const ACCOUNT_REGISTRATION_ENABLED = true;", text)
        self.assertIn("const ACCOUNT_RECOVERY_REQUEST_ENABLED = false;", text)
        self.assertIn("const ACCOUNT_RECOVERY_COMPLETION_ENABLED = false;", text)


if __name__ == "__main__":
    unittest.main()
