import unittest

from scripts.probe_public_oauth_consent import analyze, canonical_origin

ORIGIN = "https://ordax.com.br"


class LiveConsentProbeTests(unittest.TestCase):
    def setUp(self):
        self.headers = {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "referrer-policy": "no-referrer",
            "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        }
        self.html = (
            "<!doctype html><script>"
            "createClient('https://x','public-key');"
            "client.auth.oauth.getAuthorizationDetails('id');"
            "client.auth.oauth.approveAuthorization('id');"
            "client.auth.oauth.denyAuthorization('id');"
            "</script>"
        )

    def run_probe(self, *, code=200, headers=None, html=None, missing=400, invalid=400):
        return analyze(
            ORIGIN, (code, self.headers if headers is None else headers,
                     self.html if html is None else html),
            (missing, {}, ""), (invalid, {}, ""),
        )

    def test_canonical_origin_comes_from_first_party_source(self):
        self.assertEqual(canonical_origin(), ORIGIN)

    def test_known_public_response_only_proves_page_presentation(self):
        answer = self.run_probe()
        self.assertEqual(answer["consent_presentation"], "LIVE_ROUTE_VALIDATED")
        self.assertFalse(answer["auth_session_created"])
        self.assertFalse(answer["oauth_client_registered"])
        self.assertFalse(answer["oauth_consent_completed"])

    def test_login_page_or_spa_fallback_cannot_impersonate_consent(self):
        for body in ("<html>Login OrdaX</html>", "approveAuthorization()", "",
                     "<html>OrdaX OS</html>"):
            self.assertEqual(
                self.run_probe(html=body)["consent_presentation"], "UNAVAILABLE"
            )

    def test_denied_route_redirect_or_missing_environment_fails(self):
        for code in (302, 401, 403, 404, 503, None):
            self.assertEqual(
                self.run_probe(code=code)["consent_presentation"], "UNAVAILABLE"
            )

    def test_invalid_id_and_missing_id_must_both_fail_closed(self):
        for field in ("missing", "invalid"):
            self.assertEqual(
                self.run_probe(**{field: 200})["consent_presentation"],
                "UNAVAILABLE",
            )

    def test_response_security_headers_are_mandatory(self):
        for header in ("content-type", "cache-control", "referrer-policy",
                       "content-security-policy"):
            h = self.headers.copy()
            del h[header]
            self.assertEqual(
                self.run_probe(headers=h)["consent_presentation"], "UNAVAILABLE"
            )


if __name__ == "__main__":
    unittest.main()
