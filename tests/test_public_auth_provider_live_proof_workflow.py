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
        self.assertIn('data["ready"] is all(data["checks"].values())', self.text)
        self.assertIn("auth-provider-proof-", self.text)
        self.assertIn("retention-days: 14", self.text)

    def test_destination_probe_is_read_only_and_cannot_impersonate_active_owner(self):
        self.assertIn("options:", self.text)
        self.assertIn("- destination", self.text)
        self.assertIn("- active", self.text)
        self.assertIn("default: active", self.text)
        self.assertIn('ORDAX_PROBE_SCOPE: ${{ inputs.scope }}', self.text)
        self.assertIn('--scope "${ORDAX_PROBE_SCOPE}"', self.text)
        self.assertIn('name: auth-provider-proof-${{ inputs.scope }}-${{ github.sha }}', self.text)
        self.assertNotIn("supabase db reset", self.text)
        self.assertNotIn("supabase projects update", self.text)

    def test_blocked_provider_proof_is_uploaded_before_fail_closed_gate(self):
        self.assertIn("id: provider_probe", self.text)
        self.assertIn("continue-on-error: true", self.text)
        self.assertIn("Upload sanitized provider proof only", self.text)
        self.assertIn("Fail closed when hosted provider is not ready", self.text)
        self.assertLess(self.text.index("Upload sanitized provider proof only"), self.text.index("Fail closed when hosted provider is not ready"))
        self.assertIn('test "${PROBE_OUTCOME}" = "success"', self.text)
        self.assertIn("assert type(data[\"ready\"]) is bool", self.text)
        self.assertIn("PUBLIC_AUTH_PROVIDER_PROOF=BLOCKED", self.text)

    def test_checkout_does_not_persist_credentials(self):
        self.assertIn("persist-credentials: false", self.text)


if __name__ == "__main__":
    unittest.main()
