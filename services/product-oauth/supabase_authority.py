"""Supabase-backed server authority for OrdaX Product OAuth.

This adapter is intentionally separate from the provider-neutral OAuth core.
It is opt-in, server-only, uses a dedicated Supabase secret key in the apikey
header and never sends that key as a bearer token. Raw authorization codes and
access tokens are generated locally and only SHA-256 digests are persisted.

Public activation remains controlled outside this module.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Protocol


def _load_oauth_core():
    module_name = "ordax_product_oauth_core"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing

    path = Path(__file__).with_name("oauth.py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("product OAuth core loader unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    return module


_oauth = _load_oauth_core()
AuthorizationContext = _oauth.AuthorizationContext
ConsumedGrant = _oauth.ConsumedGrant
OAuthAccessDenied = _oauth.OAuthAccessDenied
OAuthClient = _oauth.OAuthClient
OAuthError = _oauth.OAuthError
OAuthUnavailable = _oauth.OAuthUnavailable
TokenPair = _oauth.TokenPair

DEFAULT_CODE_TTL_SECONDS = 300
DEFAULT_ACCESS_TTL_SECONDS = 900


class RpcTransport(Protocol):
    def call(self, name: str, payload: dict[str, object]) -> object: ...


@dataclass(frozen=True)
class SupabaseAuthorityConfig:
    base_url: str
    secret_key: str
    enabled: bool = False
    timeout_seconds: float = 10.0

    @classmethod
    def from_environment(cls) -> "SupabaseAuthorityConfig":
        enabled = os.environ.get("ORDAX_PRODUCT_OAUTH_AUTHORITY_ENABLED", "") == "1"
        return cls(
            base_url=os.environ.get("SUPABASE_URL", ""),
            secret_key=os.environ.get("ORDAX_PRODUCT_OAUTH_SECRET_KEY", ""),
            enabled=enabled,
        )

    @property
    def configured(self) -> bool:
        return (
            self.enabled
            and self.base_url.startswith("https://")
            and self.secret_key.startswith("sb_secret_")
        )


class SupabaseRestRpcTransport:
    def __init__(self, config: SupabaseAuthorityConfig) -> None:
        self.config = config

    def call(self, name: str, payload: dict[str, object]) -> object:
        if not self.config.configured:
            raise OAuthUnavailable("product OAuth Supabase authority is disabled")
        url = self.config.base_url.rstrip("/") + "/rest/v1/rpc/" + name
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "apikey": self.config.secret_key,
                "content-type": "application/json",
                "accept": "application/json",
                "user-agent": "OrdaX-Product-OAuth/1",
            },
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=self.config.timeout_seconds,
            ) as response:
                raw = response.read(256 * 1024 + 1)
        except (urllib.error.URLError, TimeoutError) as exc:
            raise OAuthUnavailable("product OAuth authority request failed") from exc

        if len(raw) > 256 * 1024:
            raise OAuthError("product OAuth authority response is oversized")
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise OAuthError("product OAuth authority returned invalid JSON") from exc


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("ascii")).hexdigest()


def _row(value: object) -> dict[str, object] | None:
    if isinstance(value, list):
        if len(value) == 0:
            return None
        if len(value) != 1 or not isinstance(value[0], dict):
            raise OAuthError("product OAuth authority returned unexpected rows")
        return value[0]
    if isinstance(value, dict):
        return value
    return None


class SupabaseProductOAuthAuthority:
    """Concrete persistent authority implementing ProductOAuthAuthority."""

    def __init__(
        self,
        config: SupabaseAuthorityConfig | None = None,
        *,
        transport: RpcTransport | None = None,
        token_factory: Callable[[int], str] | None = None,
    ) -> None:
        self.config = config or SupabaseAuthorityConfig.from_environment()
        self.transport = transport or SupabaseRestRpcTransport(self.config)
        self.token_factory = token_factory or secrets.token_urlsafe

    @property
    def configured(self) -> bool:
        return self.config.configured

    def _call(self, name: str, payload: dict[str, object]) -> object:
        if not self.configured:
            raise OAuthUnavailable("product OAuth Supabase authority is disabled")
        return self.transport.call(name, payload)

    def get_client(self, client_id: str) -> OAuthClient | None:
        row = _row(
            self._call(
                "ordax_product_oauth_get_client_v1",
                {"p_client_id": client_id},
            )
        )
        if row is None:
            return None
        redirects = row.get("redirect_uris")
        scopes = row.get("allowed_scopes")
        if not isinstance(redirects, list) or not isinstance(scopes, list):
            raise OAuthError("product OAuth client registry is malformed")
        return OAuthClient(
            client_id=str(row.get("client_id", "")),
            redirect_uris=tuple(str(item) for item in redirects),
            allowed_scopes=tuple(str(item) for item in scopes),
            public_client=row.get("public_client") is True,
            state=str(row.get("state", "")),
        )

    def can_act_as_space(self, *, user_id: str, space_id: str) -> bool:
        result = self._call(
            "ordax_product_oauth_can_act_as_space_v1",
            {"p_user_id": user_id, "p_space_id": space_id},
        )
        return result is True

    def issue_authorization_code(
        self,
        *,
        user_id: str,
        client_id: str,
        space_id: str,
        scopes: tuple[str, ...],
        redirect_uri: str,
        code_challenge: str,
    ) -> str:
        code = self.token_factory(36)
        expires = datetime.now(timezone.utc) + timedelta(
            seconds=DEFAULT_CODE_TTL_SECONDS
        )
        result = self._call(
            "ordax_product_oauth_issue_code_v1",
            {
                "p_code_hash": _sha256_hex(code),
                "p_user_id": user_id,
                "p_client_id": client_id,
                "p_space_id": space_id,
                "p_scopes": list(scopes),
                "p_redirect_uri": redirect_uri,
                "p_code_challenge": code_challenge,
                "p_expires_at": expires.isoformat(),
            },
        )
        if result is not True:
            raise OAuthError("product OAuth authority did not persist code")
        return code

    def consume_authorization_code(
        self,
        *,
        code: str,
        client_id: str,
        redirect_uri: str,
        code_challenge: str,
    ) -> ConsumedGrant:
        row = _row(
            self._call(
                "ordax_product_oauth_consume_code_v1",
                {
                    "p_code_hash": _sha256_hex(code),
                    "p_client_id": client_id,
                    "p_redirect_uri": redirect_uri,
                    "p_code_challenge": code_challenge,
                },
            )
        )
        if row is None or row.get("outcome") != "applied":
            raise OAuthAccessDenied("authorization code is unavailable or invalid")
        scopes = row.get("scopes")
        if not isinstance(scopes, list):
            raise OAuthError("product OAuth grant scopes are malformed")
        return ConsumedGrant(
            grant_id=str(row.get("grant_id", "")),
            user_id=str(row.get("user_id", "")),
            client_id=str(row.get("client_id", "")),
            space_id=str(row.get("space_id", "")),
            scopes=tuple(str(item) for item in scopes),
        )

    def issue_tokens(self, *, grant: ConsumedGrant) -> TokenPair:
        access_token = "ordax_access_" + self.token_factory(32)
        expires = datetime.now(timezone.utc) + timedelta(
            seconds=DEFAULT_ACCESS_TTL_SECONDS
        )
        result = self._call(
            "ordax_product_oauth_issue_access_token_v1",
            {
                "p_token_hash": _sha256_hex(access_token),
                "p_grant_id": grant.grant_id,
                "p_expires_at": expires.isoformat(),
            },
        )
        if result is not True:
            raise OAuthError("product OAuth authority did not persist access token")
        return TokenPair(
            access_token=access_token,
            token_type="Bearer",
            expires_in=DEFAULT_ACCESS_TTL_SECONDS,
            refresh_token=None,
        )

    def resolve_access_token(self, token: str) -> AuthorizationContext | None:
        row = _row(
            self._call(
                "ordax_product_oauth_resolve_access_token_v1",
                {"p_token_hash": _sha256_hex(token)},
            )
        )
        if row is None:
            return None
        scopes = row.get("scopes")
        if not isinstance(scopes, list):
            raise OAuthError("product OAuth token scopes are malformed")
        return AuthorizationContext(
            grant_id=str(row.get("grant_id", "")),
            user_id=str(row.get("user_id", "")),
            client_id=str(row.get("client_id", "")),
            space_id=str(row.get("space_id", "")),
            scopes=tuple(str(item) for item in scopes),
            revoked=row.get("revoked") is True,
        )

    def revoke_access_token(self, token: str) -> bool:
        result = self._call(
            "ordax_product_oauth_revoke_access_token_v1",
            {"p_token_hash": _sha256_hex(token)},
        )
        if not isinstance(result, bool):
            raise OAuthError("product OAuth revocation result is malformed")
        return result

    def revoke_grant(self, grant_id: str) -> bool:
        result = self._call(
            "ordax_product_oauth_revoke_grant_v1",
            {"p_grant_id": grant_id},
        )
        if not isinstance(result, bool):
            raise OAuthError("product OAuth grant revocation result is malformed")
        return result
