"""Regression tests for the public deploy verifier's separately gated account modes."""
import contextlib
import hashlib
import importlib.util
import io
import json
import sys
from pathlib import Path
from unittest import TestCase, mock

SCRIPT = Path(__file__).resolve().parents[1] / "tools/public-site/prove_deployment.py"
sys.path.insert(0, str(SCRIPT.parent))
spec = importlib.util.spec_from_file_location("ordax_public_deployment_proof", SCRIPT)
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class Response:
    def __init__(self, status=200, payload=None, cache=None, body=None):
        self.status = status
        self.headers = dict(proof.SECURITY_HEADERS)
        self.headers["Cache-Control"] = cache or "no-store, max-age=0"
        self.headers["Content-Type"] = "application/json" if payload is not None else "text/html"
        self.payload = payload
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size=-1):
        raw = self.body if self.body is not None else json.dumps(self.payload or {}).encode("utf-8")
        return raw[:size]


def fixtures(*, full=False, auth_only=False, provider="gated",
             policy_active=True, recovery_status=403):
    config = {
        "$schema": "prototype-ordax.public-site-runtime/1",
        "legal": {"account_activation_ready": full,
                  "auth_only_source_enabled": auth_only},
        "identity": {"recovery_url": None, "recovery_complete_url": None},
    }
    session = {
        "$schema": "prototype-ordax.public-identity-session/1",
        "authenticated": False, "provider": provider,
        "status": "anonymous" if provider == "supabase" else "unavailable",
    }
    legal_documents = {
        "privacy": b"<html>Privacy 2026.10.09</html>\n",
        "terms": b"<html>Terms 2026.10.09</html>\n",
    }
    policy = {
        "$schema": "prototype-ordax.registration-legal-policy/1",
        "active": policy_active, "registrationEnabled": policy_active,
    }
    for name, route in (("privacy", "/privacidade/"), ("terms", "/termos/")):
        policy[name] = {
            "version": "2026.10.09",
            "effectiveDate": "2026-10-09",
            "url": "https://ordax.com.br" + route,
            "sha256": hashlib.sha256(legal_documents[name]).hexdigest(),
        }
    sync_enabled = full
    sync = {"error": "authentication-required" if sync_enabled
            else "public-account-access-disabled"}
    recovery = {"error": "bot-verification-required" if recovery_status == 403
                else "public-account-access-disabled"}
    routes = {
        "/": Response(cache="no-cache, must-revalidate"),
        "/config/public-site.json": Response(payload=config),
        "/recuperar/": Response(),
        "/recuperar/nova-senha/": Response(),
        "/auth/session": Response(payload=session),
        "/auth/registration-policy": Response(payload=policy),
        "/privacidade/": Response(body=legal_documents["privacy"]),
        "/termos/": Response(body=legal_documents["terms"]),
        "/sync/snapshot?limit=1": Response(status=401 if full else 503, payload=sync),
        "/auth/recover": Response(status=recovery_status, payload=recovery),
        "/__ordax-deployment-proof-missing": Response(status=404),
    }
    return config, session, routes


class PublicDeploymentProofTests(TestCase):
    def run_proof(self, routes):
        called = []
        def fake_request(_base, path, _method="GET", **kwargs):
            called.append((path, _method))
            return routes[path]
        with mock.patch.object(proof, "request", side_effect=fake_request):
            with contextlib.redirect_stdout(io.StringIO()) as out:
                result = proof.main(["--origin", "https://ordax.com.br"])
        self.assertEqual(result, 0)
        return out.getvalue(), called

    def test_auth_only_keeps_cloud_gated_and_turnstile_enforced(self):
        _, _, routes = fixtures(auth_only=True, provider="supabase")
        output, called = self.run_proof(routes)
        self.assertIn("PUBLIC_SITE_IDENTITY_MODE=auth-only", output)
        self.assertIn("PUBLIC_SITE_CLOUD_SYNC=GATED", output)
        self.assertIn(("/auth/registration-policy", "GET"), called)
        self.assertIn(("/privacidade/", "GET"), called)
        self.assertIn(("/termos/", "GET"), called)
        self.assertIn(("/auth/recover", "POST"), called)

    def test_auth_only_never_accepts_gated_provider(self):
        _, _, routes = fixtures(auth_only=True, provider="gated")
        with self.assertRaisesRegex(SystemExit, "public-session-provider-invalid"):
            self.run_proof(routes)

    def test_auth_only_never_accepts_missing_provider(self):
        _, _, routes = fixtures(auth_only=True, provider="supabase")
        routes["/auth/session"].payload["provider"] = None
        with self.assertRaisesRegex(SystemExit, "public-session-provider-invalid"):
            self.run_proof(routes)

    def test_disabled_mode_remains_supported(self):
        _, _, routes = fixtures()
        output, called = self.run_proof(routes)
        self.assertIn("PUBLIC_SITE_IDENTITY_MODE=gated", output)
        self.assertNotIn(("/auth/registration-policy", "GET"), called)

    def test_full_mode_requires_real_anonymous_provider(self):
        _, _, routes = fixtures(full=True, provider="supabase")
        output, called = self.run_proof(routes)
        self.assertIn("PUBLIC_SITE_IDENTITY_MODE=full", output)
        self.assertIn("PUBLIC_SITE_CLOUD_SYNC=AVAILABLE", output)
        self.assertNotIn(("/auth/recover", "POST"), called)

    def test_auth_only_registration_policy_must_be_active(self):
        _, _, routes = fixtures(auth_only=True, provider="supabase", policy_active=False)
        with self.assertRaisesRegex(SystemExit, "public-legal-integrity:registration-policy-inactive"):
            self.run_proof(routes)

    def test_accepted_privacy_digest_rejects_html_drift(self):
        _, _, routes = fixtures(auth_only=True, provider="supabase")
        routes["/privacidade/"].body += b"<!-- changed layout -->"
        with self.assertRaisesRegex(SystemExit, "public-legal-integrity:published-legal-document-hash-mismatch:privacy"):
            self.run_proof(routes)

    def test_accepted_terms_digest_rejects_html_drift(self):
        _, _, routes = fixtures(auth_only=True, provider="supabase")
        routes["/termos/"].body += b"<!-- changed layout -->"
        with self.assertRaisesRegex(SystemExit, "public-legal-integrity:published-legal-document-hash-mismatch:terms"):
            self.run_proof(routes)

    def test_unexpected_provider_never_bypasses_closed_account_gate(self):
        config, session, _ = fixtures(provider="supabase")
        with self.assertRaisesRegex(SystemExit, "public-account-gate-not-enforced"):
            proof.public_identity_mode(config, session)

    def test_false_authenticated_session_is_required(self):
        config, session, _ = fixtures(auth_only=True, provider="supabase")
        session["authenticated"] = True
        with self.assertRaisesRegex(SystemExit, "unexpected-authenticated-session"):
            proof.public_identity_mode(config, session)

    def test_auth_only_recovery_is_not_published(self):
        _, _, routes = fixtures(auth_only=True, provider="supabase")
        routes["/config/public-site.json"].payload["identity"]["recovery_url"] = "/auth/recover"
        with self.assertRaisesRegex(SystemExit, "recovery-exposed-before-account-activation"):
            self.run_proof(routes)

    def test_unverified_recovery_posts_must_be_denied(self):
        _, _, routes = fixtures(auth_only=True, provider="supabase", recovery_status=200)
        with self.assertRaisesRegex(SystemExit, "public-recovery-boundary-invalid"):
            self.run_proof(routes)
