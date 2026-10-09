"""Read-only proof that published policy hashes bind the actual served HTML."""

import hashlib
import io
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from tests.test_public_site_network_proof import Response, network


class PublicLegalHashProofTests(unittest.TestCase):
    def setUp(self):
        self.documents = {
            "/privacidade/": b"<html>Privacy final</html>\n",
            "/termos/": b"<html>Terms final</html>\n",
        }
        self.policy = {
            "$schema": "prototype-ordax.registration-legal-policy/1",
            "active": True,
            "registrationEnabled": True,
            "privacy": {
                "version": "2026.10.09",
                "effectiveDate": "2026-10-09",
                "url": "https://ordax.com.br/privacidade/",
                "sha256": hashlib.sha256(self.documents["/privacidade/"]).hexdigest(),
            },
            "terms": {
                "version": "2026.10.09",
                "effectiveDate": "2026-10-09",
                "url": "https://ordax.com.br/termos/",
                "sha256": hashlib.sha256(self.documents["/termos/"]).hexdigest(),
            },
        }
        self.requested_paths = []

    def respond(self, host, path, *, accept="text/html"):
        self.assertEqual(host, network.CANONICAL_HOST)
        self.requested_paths.append(path)
        if path == "/auth/registration-policy":
            self.assertEqual(accept, "application/json")
            return Response(payload=self.policy)
        self.assertIn(path, self.documents)
        response = Response()
        response.data = self.documents[path]
        return response

    def run_proof(self):
        with patch.object(network, "fetch", side_effect=self.respond):
            output = io.StringIO()
            with redirect_stdout(output):
                result = network.check_public_legal_consistency()
            return result, output.getvalue()

    def test_valid_server_owned_hashes_match_both_public_documents(self):
        result, output = self.run_proof()
        self.assertEqual(result, 0)
        self.assertIn("ORDAX_PUBLIC_LEGAL_INTEGRITY=PASS", output)
        self.assertIn("ORDAX_PUBLIC_LEGAL_DOCUMENT=privacy SHA256_MATCH", output)
        self.assertIn("ORDAX_PUBLIC_LEGAL_DOCUMENT=terms SHA256_MATCH", output)
        self.assertEqual(self.requested_paths, [
            "/auth/registration-policy", "/privacidade/", "/termos/",
        ])

    def test_changed_published_html_fails_without_activating_anything(self):
        self.documents["/privacidade/"] += b"<!-- style injection -->"
        with self.assertRaisesRegex(SystemExit, "hash-mismatch:privacy"):
            self.run_proof()
        self.assertEqual(self.requested_paths, [
            "/auth/registration-policy", "/privacidade/",
        ])

    def test_second_document_drift_is_detected(self):
        self.documents["/termos/"] += b" altered"
        with self.assertRaisesRegex(SystemExit, "hash-mismatch:terms"):
            self.run_proof()

    def test_cross_origin_policy_urls_fail_before_document_fetch(self):
        self.policy["privacy"]["url"] = "https://untrusted.invalid/legal"
        with self.assertRaisesRegex(SystemExit, "document-fields:privacy"):
            self.run_proof()
        self.assertEqual(self.requested_paths, ["/auth/registration-policy"])

    def test_inactive_policy_cannot_claim_registration_enabled(self):
        self.policy["active"] = False
        with self.assertRaisesRegex(SystemExit, "registration-enabled-without-active-policy"):
            self.run_proof()
        self.policy["registrationEnabled"] = False
        result, output = self.run_proof()
        self.assertEqual(result, 0)
        self.assertIn("ORDAX_PUBLIC_LEGAL_INTEGRITY=INACTIVE", output)

    def test_non_boolean_policy_state_is_rejected(self):
        self.policy["active"] = "true"
        with self.assertRaisesRegex(SystemExit, "registration-policy-state-invalid"):
            self.run_proof()

    def test_compressed_or_invalid_html_fails_closed(self):
        original = self.respond
        def compressed(host, path, *, accept="text/html"):
            result = original(host, path, accept=accept)
            if path == "/privacidade/":
                result.headers["Content-Encoding"] = "br"
            return result
        with patch.object(network, "fetch", side_effect=compressed):
            with self.assertRaisesRegex(SystemExit, "published-legal-document-encoding:privacy"):
                network.check_public_legal_consistency()


if __name__ == "__main__":
    unittest.main()
