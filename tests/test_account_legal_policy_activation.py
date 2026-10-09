import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261007041500_account_legal_policy_activation_v1.sql"
)
TOOL = ROOT / "tools" / "public-site" / "activate_account_legal_policy.py"
WORKFLOW = ROOT / ".github" / "workflows" / "public-legal-policy-activation.yml"


def load_tool():
    spec = importlib.util.spec_from_file_location("ordax_legal_policy_activation", TOOL)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


activation = load_tool()


class AccountLegalPolicyActivationTests(unittest.TestCase):
    def test_rpc_is_service_role_only_atomic_and_idempotent(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        lower = sql.lower()
        self.assertIn("ordax_activate_account_legal_policy_v1", lower)
        self.assertIn("security definer", lower)
        self.assertIn("set search_path = ''", lower)
        self.assertIn(
            "lock table private.ordax_account_legal_policies\n    in share row exclusive mode",
            lower,
        )
        self.assertIn("ordax-account-privacy-version-content-mismatch", lower)
        self.assertIn("ordax-account-terms-version-content-mismatch", lower)
        self.assertIn("return v_current.policy_id", lower)
        self.assertIn("state = 'retired'", lower)
        self.assertIn("'active'", lower)
        self.assertIn(
            "revoke all on function public.ordax_activate_account_legal_policy_v1",
            lower,
        )
        self.assertIn("from public, anon, authenticated, service_role", lower)
        self.assertIn(
            "grant execute on function public.ordax_activate_account_legal_policy_v1",
            lower,
        )
        self.assertIn("to service_role", lower)

    def test_current_repository_cannot_build_activation_candidate(self):
        with self.assertRaises(ValueError):
            activation.build_candidate("https://ordax-os-public.vercel.app")

    def test_candidate_binds_exact_final_page_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            legal = root / "legal.json"
            site = root / "public"
            (site / "privacidade").mkdir(parents=True)
            (site / "termos").mkdir(parents=True)
            (site / "privacidade" / "index.html").write_bytes(b"privacy-final-v1\n")
            (site / "termos" / "index.html").write_bytes(b"terms-final-v1\n")
            legal.write_text(
                json.dumps(
                    {
                        "$schema": "prototype-ordax.public-legal-readiness/1",
                        "status": "ready",
                        "account_activation_ready": True,
                        "operator": {
                            "legal_form": "natural_person",
                            "legal_name": "Operador Exemplo",
                            "privacy_contact_email": "privacy@example.invalid",
                            "identity_reviewed": True,
                            "privacy_contact_verified": True,
                        },
                        "documents": {
                            "privacy": {
                                "route": "/privacidade/",
                                "final": True,
                                "version": "privacy-2026-10-07",
                                "effective_date": "2026-10-07",
                            },
                            "terms": {
                                "route": "/termos/",
                                "final": True,
                                "version": "terms-2026-10-07",
                                "effective_date": "2026-10-07",
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )
            original_legal = activation.LEGAL
            original_site = activation.SITE
            try:
                activation.LEGAL = legal
                activation.SITE = site
                candidate = activation.build_candidate(
                    "https://ordax-os-public.vercel.app/"
                )
            finally:
                activation.LEGAL = original_legal
                activation.SITE = original_site

        self.assertEqual(
            candidate["origin"],
            "https://ordax-os-public.vercel.app",
        )
        self.assertEqual(
            candidate["privacy"]["url"],
            "https://ordax-os-public.vercel.app/privacidade/",
        )
        self.assertEqual(
            candidate["terms"]["url"],
            "https://ordax-os-public.vercel.app/termos/",
        )
        self.assertRegex(candidate["privacy"]["sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(candidate["terms"]["sha256"], r"^[0-9a-f]{64}$")
        self.assertNotEqual(candidate["privacy"]["sha256"], candidate["terms"]["sha256"])

    def test_operator_identity_is_required_even_when_documents_are_ready(self):
        with tempfile.TemporaryDirectory() as tmp:
            legal = Path(tmp) / "legal.json"
            ready = {
                "$schema": "prototype-ordax.public-legal-readiness/1",
                "status": "ready",
                "account_activation_ready": True,
                "operator": {
                    "legal_form": "natural_person",
                    "legal_name": None,
                    "privacy_contact_email": None,
                    "identity_reviewed": False,
                    "privacy_contact_verified": False,
                },
                "documents": {},
            }
            legal.write_text(json.dumps(ready), encoding="utf-8")
            from unittest.mock import patch
            with patch.object(activation, "LEGAL", legal):
                with self.assertRaisesRegex(ValueError, "legal-operator-identity-review"):
                    activation.build_candidate("https://ordax.com.br")
                ready["operator"].update({
                    "identity_reviewed": True,
                    "privacy_contact_verified": True,
                })
                legal.write_text(json.dumps(ready), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "legal-operator-name"):
                    activation.build_candidate("https://ordax.com.br")
                ready["operator"]["legal_name"] = "Operador Exemplo"
                legal.write_text(json.dumps(ready), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "legal-operator-contact"):
                    activation.build_candidate("https://ordax.com.br")

    def test_origin_must_be_clean_https_origin(self):
        self.assertEqual(
            activation.clean_origin("https://example.invalid/"),
            "https://example.invalid",
        )
        for value in (
            "http://example.invalid",
            "https://user:pass@example.invalid",
            "https://example.invalid/path",
            "https://example.invalid/?q=1",
            "https://example.invalid/#x",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                activation.clean_origin(value)

    def test_apply_requires_exact_source_commit_before_provider_call(self):
        old_sha = os.environ.pop("GITHUB_SHA", None)
        old_override = os.environ.pop("ORDAX_SOURCE_COMMIT", None)
        try:
            with self.assertRaises(ValueError):
                activation.source_commit()
            os.environ["ORDAX_SOURCE_COMMIT"] = "a" * 40
            self.assertEqual(activation.source_commit(), "a" * 40)
        finally:
            if old_sha is not None:
                os.environ["GITHUB_SHA"] = old_sha
            if old_override is not None:
                os.environ["ORDAX_SOURCE_COMMIT"] = old_override
            else:
                os.environ.pop("ORDAX_SOURCE_COMMIT", None)

    def test_legal_activation_uses_account_destination_ssot(self):
        destination = json.loads((
            ROOT / "infra/supabase/product/account_destination_migration_plan.json"
        ).read_text(encoding="utf-8"))
        expected = f"https://{destination['destination_project_ref']}.supabase.co"
        self.assertEqual(activation.canonical_provider_url(), expected)

        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertNotIn("eobcxuyvhkvdmkbaihwh.supabase.co", workflow)
        self.assertIn('module["canonical_provider_url"]()', workflow)
        self.assertIn('>> "$GITHUB_ENV"', workflow)

    def test_legal_activation_rejects_legacy_provider_before_api_call(self):
        from unittest.mock import patch
        with patch.dict(os.environ, {
            "ORDAX_SUPABASE_URL": "https://eobcxuyvhkvdmkbaihwh.supabase.co",
            "ORDAX_SUPABASE_SECRET_KEY": "unusable-test-only-key",
        }):
            with patch.object(
                activation.urllib.request, "urlopen",
                side_effect=AssertionError("activation must not send any request"),
            ):
                with self.assertRaisesRegex(SystemExit, "provider-project-mismatch"):
                    activation.apply_candidate({})

    def test_legal_activation_opaque_secret_uses_only_apikey_without_bearer(self):
        from unittest.mock import patch

        # Regression: Supabase sb_secret keys are not JWTs. Sending the same
        # opaque key as Bearer used to break service_role RPC activation.
        service_key = "sb_secret_" + "z" * 48
        policy_id = "4e5e29b6-d271-4d6a-b7be-34c38a8d5ba1"
        candidate = {
            "privacy": {
                "version": "privacy-v1",
                "effective_date": "2026-10-09",
                "sha256": "a" * 64,
                "url": "https://ordax.com.br/privacidade/",
            },
            "terms": {
                "version": "terms-v1",
                "effective_date": "2026-10-09",
                "sha256": "b" * 64,
                "url": "https://ordax.com.br/termos/",
            },
        }
        seen = []

        class ApiResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self, _limit):
                return json.dumps(policy_id).encode("utf-8")

        class Opener:
            def open(self, request, timeout):
                seen.append((request, timeout))
                return ApiResponse()

        with (
            patch.dict(os.environ, {
                "ORDAX_SUPABASE_URL": activation.canonical_provider_url(),
                "ORDAX_SUPABASE_SECRET_KEY": service_key,
            }),
            patch.object(activation, "verify_published_legal_documents"),
            patch.object(activation.urllib.request, "build_opener", return_value=Opener()),
        ):
            self.assertEqual(activation.apply_candidate(candidate), policy_id)

        self.assertEqual(len(seen), 1)
        request, timeout = seen[0]
        self.assertEqual(timeout, 20)
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Apikey"), service_key)
        self.assertFalse(request.has_header("Authorization"))
        self.assertNotIn("Bearer", str(request.header_items()))
        self.assertEqual(request.full_url,
            activation.canonical_provider_url() + "/rest/v1/rpc/ordax_activate_account_legal_policy_v1")

    def test_legal_activation_rejects_legacy_jwt_operator_secret(self):
        from unittest.mock import patch
        with (
            patch.dict(os.environ, {
                "ORDAX_SUPABASE_URL": activation.canonical_provider_url(),
                "ORDAX_SUPABASE_SECRET_KEY": "eyJhbGciOiJIUzI1NiJ9.old.jwt",
            }),
            patch.object(
                activation, "verify_published_legal_documents",
                side_effect=AssertionError("must reject before legal/public requests"),
            ),
        ):
            with self.assertRaisesRegex(SystemExit, "provider-operator-secret-key-format-invalid"):
                activation.apply_candidate({})

    def test_published_final_documents_must_match_approved_source_bytes(self):
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            site = root / "public"
            policy = root / "legal.json"
            public_auth = root / "public-auth.json"
            contents = {"privacy": b"<h1>Privacy final</h1>\n", "terms": b"<h1>Terms final</h1>\n"}
            for name, route in (("privacy", "privacidade"), ("terms", "termos")):
                (site / route).mkdir(parents=True)
                (site / route / "index.html").write_bytes(contents[name])
            policy.write_text(json.dumps({
                "status": "ready",
                "account_activation_ready": True,
                "documents": {
                    "privacy": {"route": "/privacidade/", "version": "p1",
                                "effective_date": "2026-10-09", "final": True},
                    "terms": {"route": "/termos/", "version": "t1",
                              "effective_date": "2026-10-09", "final": True},
                },
            }), encoding="utf-8")
            public_auth.write_text(json.dumps({
                "redirect_policy": {"origin": "https://ordax.com.br"}
            }), encoding="utf-8")
            import hashlib
            candidate = {
                "origin": "https://ordax.com.br",
                "privacy": {
                    "version": "p1", "effective_date": "2026-10-09",
                    "url": "https://ordax.com.br/privacidade/",
                    "sha256": hashlib.sha256(contents["privacy"]).hexdigest(),
                },
                "terms": {
                    "version": "t1", "effective_date": "2026-10-09",
                    "url": "https://ordax.com.br/termos/",
                    "sha256": hashlib.sha256(contents["terms"]).hexdigest(),
                },
            }

            class Published:
                status = 200
                headers = {"Content-Type": "text/html; charset=utf-8"}
                def __init__(self, data):
                    self.data = data
                def __enter__(self):
                    return self
                def __exit__(self, *_):
                    return False
                def read(self, limit):
                    return self.data[:limit]

            delivered = dict(contents)
            accessed = []
            class Opener:
                def open(self, request, timeout):
                    self_test.assertEqual(timeout, 15)
                    self_test.assertTrue(request.full_url.startswith("https://ordax.com.br/"))
                    self_test.assertFalse(any(name.lower() == "authorization" for name in request.headers))
                    accessed.append(request.full_url)
                    suffix = "privacy" if request.full_url.endswith("/privacidade/") else "terms"
                    return Published(delivered[suffix])

            self_test = self
            with (
                patch.object(activation, "SITE", site),
                patch.object(activation, "LEGAL", policy),
                patch.object(activation, "PUBLIC_AUTH_CONTRACT", public_auth),
                patch.object(activation.urllib.request, "build_opener", return_value=Opener()),
            ):
                activation.verify_published_legal_documents(candidate)
                self.assertEqual(accessed, [
                    "https://ordax.com.br/privacidade/",
                    "https://ordax.com.br/termos/",
                ])

                delivered["terms"] = b"Old, stale or replaced terms."
                with self.assertRaisesRegex(SystemExit, "published-content-mismatch"):
                    activation.verify_published_legal_documents(candidate)
                delivered["terms"] = contents["terms"]

                bad_origin = dict(candidate, origin="https://old.invalid")
                with self.assertRaisesRegex(SystemExit, "origin-mismatch"):
                    activation.verify_published_legal_documents(bad_origin)

                bad_policy = json.loads(policy.read_text(encoding="utf-8"))
                bad_policy["status"] = "not-ready"
                policy.write_text(json.dumps(bad_policy), encoding="utf-8")
                with self.assertRaisesRegex(SystemExit, "policy-not-ready"):
                    activation.verify_published_legal_documents(candidate)

    def test_legal_document_http_redirects_are_rejected(self):
        handler = activation._NoRedirectHandler()
        self.assertIsNone(handler.redirect_request(None, None, 302, "Moved", {},
                                                   "https://attacker.invalid"))

    def test_activation_workflow_never_interpolates_dispatch_inputs_into_shell_source(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        steps = workflow.split("    steps:", 1)[1]
        self.assertIn('ORDAX_REQUESTED_ORIGIN: ${{ inputs.origin }}', workflow)
        self.assertIn('ORDAX_ACTIVATION_CONFIRMATION: ${{ inputs.confirmation }}', workflow)
        self.assertNotIn("${{ inputs.", steps)
        self.assertIn('test "${ORDAX_ACTIVATION_CONFIRMATION}" = "activate-reviewed-legal-policy"', steps)
        self.assertEqual(steps.count('--origin "${ORDAX_REQUESTED_ORIGIN}"'), 2)
        self.assertIn('"${ORDAX_REQUESTED_ORIGIN}" "${GITHUB_SHA}"', steps)

    def test_activation_secret_is_scoped_only_to_check_and_apply_steps(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        job_env = workflow.split("    env:", 1)[1].split("    steps:", 1)[0]
        self.assertNotIn("ORDAX_SUPABASE_SECRET_KEY", job_env)
        self.assertEqual(
            workflow.count('ORDAX_SUPABASE_SECRET_KEY: ${{ secrets.ORDAX_SUPABASE_SECRET_KEY }}'),
            2,
        )
        steps = workflow.split("    steps:", 1)[1]
        for name in (
            "Require server-only provider credential without printing it",
            "Apply exact candidate through service-role-only RPC",
        ):
            segment = steps.split("      - name: " + name, 1)[1].split("      - name:", 1)[0]
            self.assertIn("ORDAX_SUPABASE_SECRET_KEY: ${{ secrets.ORDAX_SUPABASE_SECRET_KEY }}", segment)
        for name in (
            "Build reviewed activation candidate",
            "Validate sanitized activation receipt",
        ):
            segment = steps.split("      - name: " + name, 1)[1].split("      - name:", 1)[0]
            self.assertNotIn("ORDAX_SUPABASE_SECRET_KEY: ${{", segment)

    def test_workflow_is_manual_confirmed_secret_backed_and_receipt_only(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", text)
        self.assertNotIn("pull_request:", text)
        self.assertNotIn("push:", text)
        self.assertIn("activate-reviewed-legal-policy", text)
        self.assertIn("refs/heads/main", text)
        self.assertIn("ordaxsystems/ordax-os", text)
        self.assertIn("## Production publication attestation", (
            ROOT / "docs/PUBLIC-LEGAL-READINESS.md"
        ).read_text(encoding="utf-8"))
        self.assertIn("secrets.ORDAX_SUPABASE_SECRET_KEY", text)
        self.assertIn("ACCOUNT_LEGAL_POLICY_OPERATOR_CREDENTIAL_PRINTED=NO", text)
        self.assertIn("activate_account_legal_policy.py candidate", text)
        self.assertIn("activate_account_legal_policy.py apply", text)
        self.assertIn("ACCOUNT_LEGAL_POLICY_ACTIVATION_RECEIPT=PASS_SANITIZED", text)
        self.assertIn("retention-days: 30", text)
        self.assertNotIn('echo "$ORDAX_SUPABASE_SECRET_KEY"', text)


if __name__ == "__main__":
    unittest.main()
