#!/usr/bin/env python3
"""Integrated disposable Product OAuth proof over real PostgreSQL authority RPCs."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from urllib.parse import parse_qs, urlencode, urlsplit

from services.product_core.session import ProductSession

ROOT = Path(__file__).resolve().parents[1]
GATEWAY_PATH = ROOT / "services" / "product-oauth" / "gateway.py"
AUTHORITY_PATH = ROOT / "services" / "product-oauth" / "supabase_authority.py"


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gateway = load(GATEWAY_PATH, "ordax_product_oauth_http_e2e_gateway")
authority_mod = load(AUTHORITY_PATH, "ordax_product_oauth_http_e2e_authority")

USER = "11111111-1111-4111-8111-111111111111"
SPACE_A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
SPACE_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
SPACE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
CLIENT = "proof-http-e2e-01"
REDIRECT = "https://acheguese.test/auth/ordax/callback"
CSRF = "csrf-product-oauth-http-e2e"
STATE = "state-product-oauth-http-e2e"
VERIFIER = "v" * 43


def sql_text(value: object) -> str:
    if not isinstance(value, str):
        raise TypeError("SQL text value must be a string")
    return "'" + value.replace("'", "''") + "'"


def sql_array(values: object) -> str:
    if not isinstance(values, list) or any(not isinstance(item, str) for item in values):
        raise TypeError("SQL text[] value must be a string list")
    return "array[" + ",".join(sql_text(item) for item in values) + "]::text[]"


class PsqlRpcTransport:
    """Test-only RPC transport backed by the same PostgreSQL functions as PostgREST."""

    def _query(self, expression: str) -> object:
        sql = "set role service_role; select " + expression + ";"
        completed = subprocess.run(
            [
                "psql",
                "-X",
                "-q",
                "-A",
                "-t",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                sql,
            ],
            check=True,
            capture_output=True,
            text=True,
            env=os.environ.copy(),
        )
        raw = completed.stdout.strip()
        if not raw:
            return None
        return json.loads(raw)

    def execute_admin(self, sql: str) -> None:
        subprocess.run(
            ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
            check=True,
            capture_output=True,
            text=True,
            env=os.environ.copy(),
        )

    def call(self, name: str, payload: dict[str, object]) -> object:
        if name == "ordax_product_oauth_get_client_v1":
            expr = (
                "coalesce((select jsonb_agg(to_jsonb(x)) "
                "from public.ordax_product_oauth_get_client_v1("
                + sql_text(payload["p_client_id"])
                + ") x), '[]'::jsonb)::text"
            )
            return self._query(expr)

        if name == "ordax_product_oauth_can_act_as_space_v1":
            expr = (
                "to_jsonb(public.ordax_product_oauth_can_act_as_space_v1("
                + sql_text(payload["p_user_id"])
                + "::uuid,"
                + sql_text(payload["p_space_id"])
                + "::uuid))::text"
            )
            return self._query(expr)

        if name == "ordax_product_oauth_issue_code_v1":
            expr = (
                "to_jsonb(public.ordax_product_oauth_issue_code_v1("
                + sql_text(payload["p_code_hash"])
                + ","
                + sql_text(payload["p_user_id"])
                + "::uuid,"
                + sql_text(payload["p_client_id"])
                + ","
                + sql_text(payload["p_space_id"])
                + "::uuid,"
                + sql_array(payload["p_scopes"])
                + ","
                + sql_text(payload["p_redirect_uri"])
                + ","
                + sql_text(payload["p_code_challenge"])
                + ","
                + sql_text(payload["p_expires_at"])
                + "::timestamptz))::text"
            )
            return self._query(expr)

        if name == "ordax_product_oauth_consume_code_v1":
            expr = (
                "coalesce((select jsonb_agg(to_jsonb(x)) "
                "from public.ordax_product_oauth_consume_code_v1("
                + sql_text(payload["p_code_hash"])
                + ","
                + sql_text(payload["p_client_id"])
                + ","
                + sql_text(payload["p_redirect_uri"])
                + ","
                + sql_text(payload["p_code_challenge"])
                + ") x), '[]'::jsonb)::text"
            )
            return self._query(expr)

        if name == "ordax_product_oauth_issue_access_token_v1":
            expr = (
                "to_jsonb(public.ordax_product_oauth_issue_access_token_v1("
                + sql_text(payload["p_token_hash"])
                + ","
                + sql_text(payload["p_grant_id"])
                + "::uuid,"
                + sql_text(payload["p_expires_at"])
                + "::timestamptz))::text"
            )
            return self._query(expr)

        if name == "ordax_product_oauth_resolve_access_token_v1":
            expr = (
                "coalesce((select jsonb_agg(to_jsonb(x)) "
                "from public.ordax_product_oauth_resolve_access_token_v1("
                + sql_text(payload["p_token_hash"])
                + ") x), '[]'::jsonb)::text"
            )
            return self._query(expr)

        if name == "ordax_product_oauth_revoke_access_token_v1":
            expr = (
                "to_jsonb(public.ordax_product_oauth_revoke_access_token_v1("
                + sql_text(payload["p_token_hash"])
                + "))::text"
            )
            return self._query(expr)

        if name == "ordax_product_oauth_revoke_grant_v1":
            expr = (
                "to_jsonb(public.ordax_product_oauth_revoke_grant_v1("
                + sql_text(payload["p_grant_id"])
                + "::uuid))::text"
            )
            return self._query(expr)

        raise AssertionError(f"unexpected RPC: {name}")


class StaticSessions:
    configured = True

    def resolve(self, cookie_header):
        if cookie_header != "ordax_session=proof":
            return ProductSession(authenticated=False, user_id=None, csrf_token=None)
        return ProductSession(authenticated=True, user_id=USER, csrf_token=CSRF)


class DeterministicTokens:
    def __init__(self):
        self.counter = 0

    def __call__(self, size: int) -> str:
        self.counter += 1
        char = chr(ord("A") + (self.counter % 20))
        length = 48 if size >= 36 else 43
        return char * length


def headers(content_type="application/json"):
    return {
        "Content-Type": content_type,
        "Cookie": "ordax_session=proof",
        "X-OrdaX-CSRF": CSRF,
        "Sec-Fetch-Site": "same-origin",
    }


def authorize_body(space_id=SPACE_A1, scope="network.space.read"):
    challenge = gateway._oauth.pkce_s256(VERIFIER)
    return json.dumps(
        {
            "response_type": "code",
            "client_id": CLIENT,
            "redirect_uri": REDIRECT,
            "scope": scope,
            "space_id": space_id,
            "state": STATE,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
        separators=(",", ":"),
    ).encode("utf-8")


def json_payload(response):
    return json.loads(response.body.decode("utf-8"))


class ProductOAuthPersistentHttpE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get("ORDAX_PRODUCT_OAUTH_PG_E2E") != "1":
            raise unittest.SkipTest("disposable PostgreSQL E2E is CI-only")
        cls.transport = PsqlRpcTransport()
        config = authority_mod.SupabaseAuthorityConfig(
            base_url="https://proof.invalid",
            secret_key="sb_secret_product_oauth_e2e_proof",
            enabled=True,
        )
        cls.authority = authority_mod.SupabaseProductOAuthAuthority(
            config,
            transport=cls.transport,
            token_factory=DeterministicTokens(),
        )
        cls.boundary = gateway.ProductOAuthBoundary(cls.authority)
        cls.http = gateway.ProductOAuthHttpGateway(
            sessions=StaticSessions(),
            boundary=cls.boundary,
        )

    def authorize(self, *, space_id=SPACE_A1, scope="network.space.read"):
        response = self.http.handle(
            "POST",
            "/oauth/authorize",
            headers(),
            authorize_body(space_id=space_id, scope=scope),
        )
        self.assertEqual(response.status, 303)
        query = parse_qs(urlsplit(dict(response.headers)["Location"]).query)
        self.assertEqual(query["state"], [STATE])
        return query["code"][0]

    def exchange(self, code, verifier=VERIFIER):
        body = urlencode(
            {
                "grant_type": "authorization_code",
                "client_id": CLIENT,
                "code": code,
                "redirect_uri": REDIRECT,
                "code_verifier": verifier,
            }
        ).encode("ascii")
        return self.http.handle(
            "POST",
            "/oauth/token",
            headers(gateway.FORM_CONTENT_TYPE),
            body,
        )

    def test_full_http_authorize_exchange_resolve_and_revoke(self):
        code = self.authorize(space_id=SPACE_A2, scope="network.space.read network.directory.read")
        token_response = self.exchange(code)
        self.assertEqual(token_response.status, 200)
        token_body = json_payload(token_response)
        self.assertEqual(token_body["token_type"], "Bearer")
        self.assertEqual(token_body["expires_in"], 900)
        self.assertNotIn("refresh_token", token_body)

        token = token_body["access_token"]
        context = self.boundary.resolve(token)
        self.assertEqual(context.user_id, USER)
        self.assertEqual(context.client_id, CLIENT)
        self.assertEqual(context.space_id, SPACE_A2)
        self.assertEqual(
            context.scopes,
            ("network.space.read", "network.directory.read"),
        )

        revoke = self.http.handle(
            "POST",
            "/oauth/revoke",
            headers(gateway.FORM_CONTENT_TYPE),
            urlencode({"token": token}).encode("ascii"),
        )
        self.assertEqual(revoke.status, 200)
        self.assertEqual(revoke.body, b"")
        with self.assertRaises(gateway._oauth.OAuthAccessDenied):
            self.boundary.resolve(token)

    def test_cross_account_space_and_scope_escalation_are_denied(self):
        cross = self.http.handle(
            "POST",
            "/oauth/authorize",
            headers(),
            authorize_body(space_id=SPACE_B),
        )
        self.assertEqual(cross.status, 403)

        escalation = self.http.handle(
            "POST",
            "/oauth/authorize",
            headers(),
            authorize_body(scope="network.messages.write"),
        )
        self.assertEqual(escalation.status, 403)

    def test_pkce_mismatch_burns_code_and_replay_stays_denied(self):
        code = self.authorize()
        wrong = self.exchange(code, verifier="x" * 43)
        self.assertEqual(wrong.status, 400)
        self.assertEqual(json_payload(wrong)["error"], "invalid-grant")

        replay = self.exchange(code, verifier=VERIFIER)
        self.assertEqual(replay.status, 400)
        self.assertEqual(json_payload(replay)["error"], "invalid-grant")

    def test_stale_space_authority_invalidates_existing_token(self):
        code = self.authorize(space_id=SPACE_A1)
        token_response = self.exchange(code)
        self.assertEqual(token_response.status, 200)
        token = json_payload(token_response)["access_token"]
        self.assertEqual(self.boundary.resolve(token).space_id, SPACE_A1)

        self.transport.execute_admin(
            "update public.ordax_spaces "
            "set state='archived' "
            "where space_id='" + SPACE_A1 + "'::uuid"
        )
        with self.assertRaises(gateway._oauth.OAuthAccessDenied):
            self.boundary.resolve(token)


if __name__ == "__main__":
    unittest.main()
