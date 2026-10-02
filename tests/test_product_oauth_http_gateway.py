#!/usr/bin/env python3
"""Tests for the fail-closed Product OAuth HTTP boundary."""

import importlib.util
import json
import sys
from pathlib import Path
import unittest
from urllib.parse import parse_qs, urlencode, urlsplit

from services.product_core.session import ProductSession

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "services" / "product-oauth" / "gateway.py"

spec = importlib.util.spec_from_file_location("ordax_product_oauth_http_gateway", PATH)
gateway = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = gateway
spec.loader.exec_module(gateway)

USER = "11111111-1111-4111-8111-111111111111"
SPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
GRANT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
CLIENT = "acheguese-web-01"
REDIRECT = "https://acheguese.test/auth/ordax/callback?source=ordax"
CSRF = "csrf-proof-value"
STATE = "state-abcdefghijklmnop"
VERIFIER = "v" * 43
CHALLENGE = gateway._oauth.pkce_s256(VERIFIER)
CODE = "C" * 48
ACCESS_TOKEN = "ordax_access_" + ("T" * 43)


def load_authority_module():
    path = ROOT / "services" / "product-oauth" / "supabase_authority.py"
    name = "ordax_product_oauth_http_gateway_authority_regression"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def payload(response):
    return json.loads(response.body.decode("utf-8"))


class StaticSessions:
    configured = True

    def __init__(self):
        self.calls = []

    def resolve(self, cookie_header):
        self.calls.append(cookie_header)
        return ProductSession(
            authenticated=True,
            user_id=USER,
            csrf_token=CSRF,
        )


class RecordingAuthority:
    configured = True

    def __init__(self):
        self.calls = []

    def get_client(self, client_id):
        self.calls.append(("get_client", client_id))
        if client_id != CLIENT:
            return None
        return gateway._oauth.OAuthClient(
            client_id=CLIENT,
            redirect_uris=(REDIRECT,),
            allowed_scopes=(
                "network.space.read",
                "network.directory.read",
                "network.communities.read",
            ),
            public_client=True,
            state="active",
        )

    def can_act_as_space(self, *, user_id, space_id):
        self.calls.append(("can_act_as_space", user_id, space_id))
        return user_id == USER and space_id == SPACE

    def issue_authorization_code(self, **kwargs):
        self.calls.append(("issue_authorization_code", kwargs))
        return CODE

    def consume_authorization_code(self, **kwargs):
        self.calls.append(("consume_authorization_code", kwargs))
        return gateway._oauth.ConsumedGrant(
            grant_id=GRANT,
            user_id=USER,
            client_id=CLIENT,
            space_id=SPACE,
            scopes=("network.space.read",),
        )

    def issue_tokens(self, *, grant):
        self.calls.append(("issue_tokens", grant))
        return gateway._oauth.TokenPair(
            access_token=ACCESS_TOKEN,
            token_type="Bearer",
            expires_in=900,
            refresh_token=None,
        )

    def resolve_access_token(self, token):
        self.calls.append(("resolve_access_token", token))
        return gateway._oauth.AuthorizationContext(
            grant_id=GRANT,
            user_id=USER,
            client_id=CLIENT,
            space_id=SPACE,
            scopes=("network.space.read",),
            revoked=False,
        )

    def revoke_access_token(self, token):
        self.calls.append(("revoke_access_token", token))
        return False


def headers(content_type="application/json", **overrides):
    result = {
        "Content-Type": content_type,
        "Cookie": "ordax_session=opaque",
        "X-OrdaX-CSRF": CSRF,
        "Sec-Fetch-Site": "same-origin",
    }
    result.update(overrides)
    return result


def authorize_body(**overrides):
    value = {
        "response_type": "code",
        "client_id": CLIENT,
        "redirect_uri": REDIRECT,
        "scope": "network.space.read",
        "space_id": SPACE,
        "state": STATE,
        "code_challenge": CHALLENGE,
        "code_challenge_method": "S256",
    }
    value.update(overrides)
    return json.dumps(value, separators=(",", ":")).encode("utf-8")


class ProductOAuthHttpGatewayTests(unittest.TestCase):
    def setUp(self):
        self.sessions = StaticSessions()
        self.authority = RecordingAuthority()
        self.boundary = gateway.ProductOAuthBoundary(self.authority)
        self.http = gateway.ProductOAuthHttpGateway(
            sessions=self.sessions,
            boundary=self.boundary,
        )

    def test_http_and_persistent_authority_share_one_oauth_core_identity(self):
        authority = load_authority_module()
        self.assertIs(authority.OAuthAccessDenied, gateway.OAuthAccessDenied)
        self.assertIs(authority.OAuthUnavailable, gateway.OAuthUnavailable)
        self.assertIs(authority.OAuthError, gateway.OAuthError)

    def test_default_application_is_fail_closed_and_status_has_no_secret(self):
        http = gateway.ProductOAuthHttpGateway()
        status = http.handle("GET", "/oauth/status")
        self.assertEqual(status.status, 200)
        body = payload(status)
        self.assertFalse(body["identity_configured"])
        self.assertFalse(body["authority_configured"])
        self.assertFalse(body["public_activation"])
        serialized = json.dumps(body).lower()
        self.assertNotIn("secret", serialized)
        self.assertNotIn("token", serialized)

        denied = http.handle(
            "POST",
            "/oauth/authorize",
            headers(),
            authorize_body(),
        )
        self.assertEqual(denied.status, 503)

    def test_authorize_redirects_only_after_same_origin_session_and_csrf(self):
        response = self.http.handle(
            "POST",
            "/oauth/authorize",
            headers(),
            authorize_body(),
        )
        self.assertEqual(response.status, 303)
        location = dict(response.headers)["Location"]
        split = urlsplit(location)
        self.assertEqual(
            split.scheme + "://" + split.netloc + split.path,
            "https://acheguese.test/auth/ordax/callback",
        )
        query = parse_qs(split.query)
        self.assertEqual(query["source"], ["ordax"])
        self.assertEqual(query["code"], [CODE])
        self.assertEqual(query["state"], [STATE])
        self.assertEqual(response.body, b"")
        self.assertEqual(self.sessions.calls, ["ordax_session=opaque"])
        issue = [call for call in self.authority.calls if call[0] == "issue_authorization_code"]
        self.assertEqual(len(issue), 1)
        self.assertEqual(issue[0][1]["space_id"], SPACE)
        self.assertEqual(issue[0][1]["scopes"], ("network.space.read",))

    def test_cross_site_and_bad_csrf_never_issue_code(self):
        cross_site = headers(**{"Sec-Fetch-Site": "cross-site"})
        response = self.http.handle(
            "POST",
            "/oauth/authorize",
            cross_site,
            authorize_body(),
        )
        self.assertEqual(response.status, 403)

        bad_csrf = headers(**{"X-OrdaX-CSRF": "wrong"})
        response = self.http.handle(
            "POST",
            "/oauth/authorize",
            bad_csrf,
            authorize_body(),
        )
        self.assertEqual(response.status, 403)

        self.assertFalse(
            any(call[0] == "issue_authorization_code" for call in self.authority.calls)
        )

    def test_registered_redirect_with_reserved_oauth_query_is_rejected_before_issue(self):
        bad_redirect = (
            "https://acheguese.test/auth/ordax/callback?state=preexisting"
        )

        class BadRedirectAuthority(RecordingAuthority):
            def get_client(self, client_id):
                return gateway._oauth.OAuthClient(
                    client_id=CLIENT,
                    redirect_uris=(bad_redirect,),
                    allowed_scopes=("network.space.read",),
                    public_client=True,
                    state="active",
                )

        authority = BadRedirectAuthority()
        http = gateway.ProductOAuthHttpGateway(
            sessions=self.sessions,
            boundary=gateway.ProductOAuthBoundary(authority),
        )
        response = http.handle(
            "POST",
            "/oauth/authorize",
            headers(),
            authorize_body(redirect_uri=bad_redirect),
        )
        self.assertEqual(response.status, 400)
        self.assertFalse(
            any(call[0] == "issue_authorization_code" for call in authority.calls)
        )

    def test_token_exchange_is_form_encoded_pkce_and_never_returns_refresh_token(self):
        form = urlencode(
            {
                "grant_type": "authorization_code",
                "client_id": CLIENT,
                "code": CODE,
                "redirect_uri": REDIRECT,
                "code_verifier": VERIFIER,
            }
        ).encode("ascii")
        response = self.http.handle(
            "POST",
            "/oauth/token",
            headers(gateway.FORM_CONTENT_TYPE),
            form,
        )
        self.assertEqual(response.status, 200)
        body = payload(response)
        self.assertEqual(body["access_token"], ACCESS_TOKEN)
        self.assertEqual(body["token_type"], "Bearer")
        self.assertEqual(body["expires_in"], 900)
        self.assertNotIn("refresh_token", body)

        consume = [
            call for call in self.authority.calls
            if call[0] == "consume_authorization_code"
        ]
        self.assertEqual(len(consume), 1)
        self.assertEqual(consume[0][1]["code_challenge"], CHALLENGE)

    def test_token_endpoint_rejects_duplicate_or_extra_fields(self):
        duplicate = (
            "grant_type=authorization_code&client_id="
            + CLIENT
            + "&client_id="
            + CLIENT
            + "&code="
            + CODE
            + "&redirect_uri="
            + REDIRECT
            + "&code_verifier="
            + VERIFIER
        ).encode("ascii")
        response = self.http.handle(
            "POST",
            "/oauth/token",
            headers(gateway.FORM_CONTENT_TYPE),
            duplicate,
        )
        self.assertEqual(response.status, 400)
        self.assertEqual(payload(response)["error"], "invalid-grant")

        extra = urlencode(
            {
                "grant_type": "authorization_code",
                "client_id": CLIENT,
                "code": CODE,
                "redirect_uri": REDIRECT,
                "code_verifier": VERIFIER,
                "refresh_token": "forbidden",
            }
        ).encode("ascii")
        response = self.http.handle(
            "POST",
            "/oauth/token",
            headers(gateway.FORM_CONTENT_TYPE),
            extra,
        )
        self.assertEqual(response.status, 400)

    def test_revocation_does_not_disclose_whether_token_existed(self):
        form = urlencode({"token": ACCESS_TOKEN}).encode("ascii")
        response = self.http.handle(
            "POST",
            "/oauth/revoke",
            headers(gateway.FORM_CONTENT_TYPE),
            form,
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(response.body, b"")
        self.assertEqual(dict(response.headers)["Content-Length"], "0")
        self.assertIn(
            ("revoke_access_token", ACCESS_TOKEN),
            self.authority.calls,
        )

    def test_oversized_or_wrong_media_type_requests_fail_before_authority(self):
        response = self.http.handle(
            "POST",
            "/oauth/authorize",
            headers(),
            b"{" + (b"x" * gateway.MAX_BODY_BYTES) + b"}",
        )
        self.assertEqual(response.status, 400)

        response = self.http.handle(
            "POST",
            "/oauth/token",
            headers("application/json"),
            b"{}",
        )
        self.assertEqual(response.status, 415)


if __name__ == "__main__":
    unittest.main()
