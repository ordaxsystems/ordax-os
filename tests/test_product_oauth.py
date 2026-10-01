#!/usr/bin/env python3
"""Tests for the provider-neutral first-party Product OAuth boundary."""

import importlib.util
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "services" / "product-oauth" / "oauth.py"
CONTRACT = ROOT / "docs" / "contracts" / "product-oauth.json"

spec = importlib.util.spec_from_file_location("ordax_product_oauth", PATH)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

USER_A = "11111111-1111-4111-8111-111111111111"
USER_B = "22222222-2222-4222-8222-222222222222"
SPACE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
SPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
CLIENT_ID = "acheguese-web-01"
REDIRECT = "https://acheguese.example/auth/ordax/callback"
VERIFIER = "A" * 43
CHALLENGE = mod.pkce_s256(VERIFIER)
STATE = "state-0000000001"
CODE = "C" * 48
ACCESS = "access_token_" + ("A" * 32)
REFRESH = "refresh_token_" + ("R" * 32)


class MemoryAuthority:
    configured = True

    def __init__(self):
        self.client = mod.OAuthClient(
            client_id=CLIENT_ID,
            redirect_uris=(REDIRECT,),
            allowed_scopes=(
                "network.space.read",
                "network.directory.read",
                "network.communities.read",
            ),
            public_client=True,
        )
        self.members = {(USER_A, SPACE_A)}
        self.codes = {}
        self.tokens = {}
        self.revoked = set()
        self.refresh_token = None

    def get_client(self, client_id):
        return self.client if client_id == self.client.client_id else None

    def can_act_as_space(self, *, user_id, space_id):
        return (user_id, space_id) in self.members

    def issue_authorization_code(self, **kwargs):
        self.codes[CODE] = dict(kwargs)
        return CODE

    def consume_authorization_code(
        self, *, code, client_id, redirect_uri, code_challenge
    ):
        stored = self.codes.pop(code, None)
        if stored is None:
            raise mod.OAuthAccessDenied("code already used or unknown")
        if stored["client_id"] != client_id:
            raise mod.OAuthAccessDenied("client mismatch")
        if stored["redirect_uri"] != redirect_uri:
            raise mod.OAuthAccessDenied("redirect mismatch")
        if stored["code_challenge"] != code_challenge:
            raise mod.OAuthAccessDenied("PKCE mismatch")
        return mod.ConsumedGrant(
            grant_id="grant_00000001",
            user_id=stored["user_id"],
            client_id=stored["client_id"],
            space_id=stored["space_id"],
            scopes=stored["scopes"],
        )

    def issue_tokens(self, *, grant):
        context = mod.AuthorizationContext(
            grant_id=grant.grant_id,
            user_id=grant.user_id,
            client_id=grant.client_id,
            space_id=grant.space_id,
            scopes=grant.scopes,
        )
        self.tokens[ACCESS] = context
        return mod.TokenPair(
            access_token=ACCESS,
            token_type="Bearer",
            expires_in=900,
            refresh_token=self.refresh_token,
        )

    def resolve_access_token(self, token):
        context = self.tokens.get(token)
        if context is None:
            return None
        return mod.AuthorizationContext(
            **{**context.__dict__, "revoked": token in self.revoked}
        )

    def revoke_access_token(self, token):
        if token not in self.tokens:
            return False
        self.revoked.add(token)
        return True


def request(**overrides):
    values = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT,
        "scopes": ("network.space.read",),
        "space_id": SPACE_A,
        "state": STATE,
        "code_challenge": CHALLENGE,
        "code_challenge_method": "S256",
    }
    values.update(overrides)
    return mod.AuthorizationRequest(**values)


class ProductOAuthTests(unittest.TestCase):
    def setUp(self):
        self.authority = MemoryAuthority()
        self.oauth = mod.ProductOAuthBoundary(self.authority)
        self.session = mod.ProductSession(
            authenticated=True,
            user_id=USER_A,
            csrf_token="csrf-000000000000",
        )

    def authorize(self, req=None):
        return self.oauth.authorize(
            session=self.session,
            presented_csrf="csrf-000000000000",
            sec_fetch_site="same-origin",
            request=req or request(),
        )

    def test_default_boundary_is_fail_closed(self):
        boundary = mod.ProductOAuthBoundary()
        self.assertFalse(boundary.configured)
        self.assertFalse(boundary.status()["public_activation"])
        with self.assertRaises(mod.OAuthUnavailable):
            boundary.authorize(
                session=self.session,
                presented_csrf="csrf-000000000000",
                sec_fetch_site="same-origin",
                request=request(),
            )

    def test_authorization_requires_exact_redirect_pkce_and_same_origin_consent(self):
        with self.assertRaises(mod.OAuthInvalidRequest):
            self.authorize(request(redirect_uri="https://acheguese.example/other"))
        with self.assertRaises(mod.OAuthInvalidRequest):
            self.authorize(request(code_challenge_method="plain"))
        with self.assertRaises(mod.OAuthAccessDenied):
            self.oauth.authorize(
                session=self.session,
                presented_csrf="csrf-000000000000",
                sec_fetch_site="cross-site",
                request=request(),
            )
        with self.assertRaises(mod.OAuthAccessDenied):
            self.oauth.authorize(
                session=self.session,
                presented_csrf="wrong",
                sec_fetch_site="same-origin",
                request=request(),
            )

    def test_user_cannot_authorize_another_users_space(self):
        with self.assertRaises(mod.OAuthAccessDenied):
            self.authorize(request(space_id=SPACE_B))

    def test_client_cannot_escalate_scope(self):
        with self.assertRaises(mod.OAuthAccessDenied):
            self.authorize(request(scopes=("network.messages.write",)))

    def test_pkce_exchange_is_single_use_and_redirect_bound(self):
        auth = self.authorize()
        self.assertEqual(auth.code, CODE)
        pair = self.oauth.exchange_code(
            client_id=CLIENT_ID,
            code=CODE,
            redirect_uri=REDIRECT,
            code_verifier=VERIFIER,
        )
        self.assertEqual(pair.access_token, ACCESS)
        self.assertIsNone(pair.refresh_token)

        with self.assertRaises(mod.OAuthAccessDenied):
            self.oauth.exchange_code(
                client_id=CLIENT_ID,
                code=CODE,
                redirect_uri=REDIRECT,
                code_verifier=VERIFIER,
            )

    def test_pkce_verifier_mismatch_consumes_code_fail_closed(self):
        self.authorize()
        wrong = "B" * 43
        with self.assertRaises(mod.OAuthAccessDenied):
            self.oauth.exchange_code(
                client_id=CLIENT_ID,
                code=CODE,
                redirect_uri=REDIRECT,
                code_verifier=wrong,
            )
        with self.assertRaises(mod.OAuthAccessDenied):
            self.oauth.exchange_code(
                client_id=CLIENT_ID,
                code=CODE,
                redirect_uri=REDIRECT,
                code_verifier=VERIFIER,
            )

    def test_membership_is_revalidated_on_exchange_and_token_use(self):
        self.authorize()
        self.authority.members.clear()
        with self.assertRaises(mod.OAuthAccessDenied):
            self.oauth.exchange_code(
                client_id=CLIENT_ID,
                code=CODE,
                redirect_uri=REDIRECT,
                code_verifier=VERIFIER,
            )

        self.authority.members.add((USER_A, SPACE_A))
        self.authorize()
        pair = self.oauth.exchange_code(
            client_id=CLIENT_ID,
            code=CODE,
            redirect_uri=REDIRECT,
            code_verifier=VERIFIER,
        )
        self.authority.members.clear()
        with self.assertRaises(mod.OAuthAccessDenied):
            self.oauth.resolve(pair.access_token)

    def test_refresh_tokens_remain_disabled_fail_closed(self):
        self.authority.refresh_token = REFRESH
        self.authorize()
        with self.assertRaises(mod.OAuthError):
            self.oauth.exchange_code(
                client_id=CLIENT_ID,
                code=CODE,
                redirect_uri=REDIRECT,
                code_verifier=VERIFIER,
            )

    def test_revocation_invalidates_future_resolution(self):
        self.authorize()
        pair = self.oauth.exchange_code(
            client_id=CLIENT_ID,
            code=CODE,
            redirect_uri=REDIRECT,
            code_verifier=VERIFIER,
        )
        self.assertEqual(self.oauth.resolve(pair.access_token).space_id, SPACE_A)
        self.assertTrue(self.oauth.revoke(pair.access_token))
        with self.assertRaises(mod.OAuthAccessDenied):
            self.oauth.resolve(pair.access_token)

    def test_contract_forbids_development_credentials_and_public_activation(self):
        import json

        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertFalse(contract["activation"]["public_enabled"])
        self.assertFalse(contract["activation"]["listener_deployed"])
        self.assertFalse(contract["security"]["development_mcp_credentials_reused"])
        self.assertFalse(contract["security"]["supabase_service_role_in_core"])
        self.assertTrue(contract["protocol"]["pkce_s256_required"])
        self.assertTrue(contract["identity"]["space_selection_explicit"])


if __name__ == "__main__":
    unittest.main()
