from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "public-auth-provider-live-proof.yml"


class PublicAuthProviderLiveProofWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text(encoding="utf-8")

    def test_management_token_is_secret_only_and_never_an_input(self):
        self.assertIn("secrets.SUPABASE_ACCESS_TOKEN", self.text)
        self.assertNotIn("inputs.supabase_access_token", self.text.lower())
        self.assertIn("PUBLIC_AUTH_PROVIDER_PROOF_CREDENTIAL_PRINTED=NO", self.text)

    def test_proof_is_live_sanitized_and_bound_to_canonical_project(self):
        self.assertIn("probe_auth_provider.py --live", self.text)
        self.assertIn("resolve_auth_provider_target.py", self.text)
        self.assertNotIn("SUPABASE_PROJECT_REF: eobcxuyvhkvdmkbaihwh", self.text)
        self.assertNotIn("SUPABASE_PROJECT_REF: jhfphsjptrpmtnzkpwud", self.text)
        self.assertIn('--origin "${ORDAX_REQUESTED_ORIGIN}"', self.text)
        self.assertIn('>> "${GITHUB_ENV}"', self.text)
        self.assertIn('data["project_ref"] == "redacted"', self.text)
        self.assertIn('data["project_binding"] == expected_binding', self.text)
        self.assertIn('data["source_commit"] == os.environ["GITHUB_SHA"]', self.text)
        self.assertIn('test "${GITHUB_REF}" = "refs/heads/main"', self.text)
        self.assertIn('test "${GITHUB_REPOSITORY}" = "ordaxsystems/ordax-os"', self.text)
        self.assertIn('data["ready"] is True', self.text)
        self.assertIn("auth-provider-proof-", self.text)
        self.assertIn("retention-days: 14", self.text)

    def test_checkout_does_not_persist_credentials(self):
        self.assertIn("persist-credentials: false", self.text)


if __name__ == "__main__":
    unittest.main()
