"""Provider-neutral OrdaX first-party product OAuth boundary.

This module intentionally owns no listener, database credential, signing key or
Supabase client. It validates protocol inputs and delegates persistence,
single-use code consumption, token issuance and revocation to a server-side
authority adapter.

The default boundary is fail-closed.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import re
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import urlsplit

from services.product_core.session import ProductSession

OAUTH_SCHEMA = "prototype-ordax.product-oauth/1"
STATUS_SCHEMA = "prototype-ordax.product-oauth-status/1"

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$")
STATE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._~-]{15,255}$")
PKCE_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
PKCE_VERIFIER_RE = re.compile(r"^[A-Za-z0-9._~-]{43,128}$")
CODE_RE = re.compile(r"^[A-Za-z0-9_-]{32,256}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9._~-]{32,512}$")
OPAQUE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$")
SCOPE_RE = re.compile(r"^[a-z][a-z0-9.-]{2,95}$")

KNOWN_SCOPES = frozenset(
    {
        "network.space.read",
        "network.directory.read",
        "network.communities.read",
        "network.messages.read",
        "network.messages.write",
        "network.groups.join",
        "product.acheguese.publish",
    }
)


class OAuthError(RuntimeError):
    code = "oauth-error"


class OAuthUnavailable(OAuthError):
    code = "oauth-unavailable"


class OAuthInvalidRequest(OAuthError):
    code = "invalid-request"


class OAuthAccessDenied(OAuthError):
    code = "access-denied"


@dataclass(frozen=True)
class OAuthClient:
    client_id: str
    redirect_uris: tuple[str, ...]
    allowed_scopes: tuple[str, ...]
    public_client: bool
    state: str = "active"


@dataclass(frozen=True)
class AuthorizationRequest:
    client_id: str
    redirect_uri: str
    scopes: tuple[str, ...]
    space_id: str
    state: str
    code_challenge: str
    code_challenge_method: str = "S256"


@dataclass(frozen=True)
class AuthorizationResponse:
    redirect_uri: str
    code: str
    state: str


@dataclass(frozen=True)
class ConsumedGrant:
    grant_id: str
    user_id: str
    client_id: str
    space_id: str
    scopes: tuple[str, ...]


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    token_type: str
    expires_in: int
    refresh_token: str | None = None


@dataclass(frozen=True)
class AuthorizationContext:
    grant_id: str
    user_id: str
    client_id: str
    space_id: str
    scopes: tuple[str, ...]
    revoked: bool = False


class ProductOAuthAuthority(Protocol):
    @property
    def configured(self) -> bool: ...

    def get_client(self, client_id: str) -> OAuthClient | None: ...

    def can_act_as_space(self, *, user_id: str, space_id: str) -> bool: ...

    def issue_authorization_code(
        self,
        *,
        user_id: str,
        client_id: str,
        space_id: str,
        scopes: tuple[str, ...],
        redirect_uri: str,
        code_challenge: str,
    ) -> str: ...

    def consume_authorization_code(
        self,
        *,
        code: str,
        client_id: str,
        redirect_uri: str,
        code_challenge: str,
    ) -> ConsumedGrant: ...

    def issue_tokens(self, *, grant: ConsumedGrant) -> TokenPair: ...

    def resolve_access_token(self, token: str) -> AuthorizationContext | None: ...

    def revoke_access_token(self, token: str) -> bool: ...


class DisabledOAuthAuthority:
    @property
    def configured(self) -> bool:
        return False

    def _unavailable(self, *args, **kwargs):
        del args, kwargs
        raise OAuthUnavailable("product OAuth authority is not configured")

    get_client = _unavailable
    can_act_as_space = _unavailable
    issue_authorization_code = _unavailable
    consume_authorization_code = _unavailable
    issue_tokens = _unavailable
    resolve_access_token = _unavailable
    revoke_access_token = _unavailable


def _valid_uuid(value: str | None, field: str) -> str:
    if not isinstance(value, str) or UUID_RE.fullmatch(value) is None:
        raise OAuthInvalidRequest(field)
    return value.lower()


def _valid_redirect_uri(value: str) -> str:
    if not isinstance(value, str) or len(value) > 512:
        raise OAuthInvalidRequest("redirect_uri")
    parts = urlsplit(value)
    if (
        parts.scheme != "https"
        or not parts.netloc
        or parts.username is not None
        or parts.password is not None
        or parts.fragment
    ):
        raise OAuthInvalidRequest("redirect_uri")
    return value


def _normalize_scopes(scopes: tuple[str, ...] | list[str]) -> tuple[str, ...]:
    if not isinstance(scopes, (tuple, list)) or not 1 <= len(scopes) <= 16:
        raise OAuthInvalidRequest("scope")
    normalized = tuple(scopes)
    if (
        len(set(normalized)) != len(normalized)
        or any(not isinstance(scope, str) for scope in normalized)
        or any(SCOPE_RE.fullmatch(scope) is None for scope in normalized)
        or any(scope not in KNOWN_SCOPES for scope in normalized)
    ):
        raise OAuthInvalidRequest("scope")
    return normalized


def pkce_s256(verifier: str) -> str:
    if not isinstance(verifier, str) or PKCE_VERIFIER_RE.fullmatch(verifier) is None:
        raise OAuthInvalidRequest("code_verifier")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


class ProductOAuthBoundary:
    def __init__(self, authority: ProductOAuthAuthority | None = None) -> None:
        self.authority = authority or DisabledOAuthAuthority()

    @property
    def configured(self) -> bool:
        return self.authority.configured

    def status(self) -> dict[str, object]:
        return {
            "$schema": STATUS_SCHEMA,
            "authority_configured": self.authority.configured,
            "public_activation": False,
        }

    def authorize(
        self,
        *,
        session: ProductSession,
        presented_csrf: str | None,
        sec_fetch_site: str | None,
        request: AuthorizationRequest,
    ) -> AuthorizationResponse:
        if not self.authority.configured:
            raise OAuthUnavailable("product OAuth authority is not configured")
        if sec_fetch_site != "same-origin":
            raise OAuthAccessDenied("same-origin authorization is required")
        if (
            not session.authenticated
            or session.user_id is None
            or not isinstance(session.csrf_token, str)
            or not isinstance(presented_csrf, str)
            or not hmac.compare_digest(session.csrf_token, presented_csrf)
        ):
            raise OAuthAccessDenied("authenticated same-origin consent is required")

        user_id = _valid_uuid(session.user_id, "user_id")
        client = self._active_client(request.client_id)
        redirect_uri = _valid_redirect_uri(request.redirect_uri)
        if redirect_uri not in client.redirect_uris:
            raise OAuthInvalidRequest("redirect_uri")

        if request.code_challenge_method != "S256":
            raise OAuthInvalidRequest("code_challenge_method")
        if PKCE_CHALLENGE_RE.fullmatch(request.code_challenge) is None:
            raise OAuthInvalidRequest("code_challenge")
        if STATE_RE.fullmatch(request.state) is None:
            raise OAuthInvalidRequest("state")

        scopes = _normalize_scopes(request.scopes)
        if not set(scopes).issubset(client.allowed_scopes):
            raise OAuthAccessDenied("scope escalation rejected")

        space_id = _valid_uuid(request.space_id, "space_id")
        if self.authority.can_act_as_space(user_id=user_id, space_id=space_id) is not True:
            raise OAuthAccessDenied("Space authorization rejected")

        code = self.authority.issue_authorization_code(
            user_id=user_id,
            client_id=client.client_id,
            space_id=space_id,
            scopes=scopes,
            redirect_uri=redirect_uri,
            code_challenge=request.code_challenge,
        )
        if not isinstance(code, str) or CODE_RE.fullmatch(code) is None:
            raise OAuthError("authority returned an invalid authorization code")

        return AuthorizationResponse(
            redirect_uri=redirect_uri,
            code=code,
            state=request.state,
        )

    def exchange_code(
        self,
        *,
        client_id: str,
        code: str,
        redirect_uri: str,
        code_verifier: str,
    ) -> TokenPair:
        if not self.authority.configured:
            raise OAuthUnavailable("product OAuth authority is not configured")

        client = self._active_client(client_id)
        redirect_uri = _valid_redirect_uri(redirect_uri)
        if redirect_uri not in client.redirect_uris:
            raise OAuthInvalidRequest("redirect_uri")
        if not isinstance(code, str) or CODE_RE.fullmatch(code) is None:
            raise OAuthInvalidRequest("code")

        challenge = pkce_s256(code_verifier)
        grant = self.authority.consume_authorization_code(
            code=code,
            client_id=client.client_id,
            redirect_uri=redirect_uri,
            code_challenge=challenge,
        )

        if not isinstance(grant.grant_id, str) or OPAQUE_ID_RE.fullmatch(grant.grant_id) is None:
            raise OAuthError("authority returned an invalid grant id")
        user_id = _valid_uuid(grant.user_id, "grant.user_id")
        space_id = _valid_uuid(grant.space_id, "grant.space_id")
        if grant.client_id != client.client_id:
            raise OAuthAccessDenied("authorization code client mismatch")
        scopes = _normalize_scopes(grant.scopes)
        if not set(scopes).issubset(client.allowed_scopes):
            raise OAuthAccessDenied("stored grant exceeds client scope")
        if self.authority.can_act_as_space(user_id=user_id, space_id=space_id) is not True:
            raise OAuthAccessDenied("Space authorization is no longer active")

        pair = self.authority.issue_tokens(grant=grant)
        if (
            pair.token_type != "Bearer"
            or not isinstance(pair.expires_in, int)
            or not 60 <= pair.expires_in <= 3600
            or not isinstance(pair.access_token, str)
            or TOKEN_RE.fullmatch(pair.access_token) is None
            or pair.refresh_token is not None
        ):
            raise OAuthError("authority returned an invalid token pair")
        return pair

    def resolve(self, access_token: str) -> AuthorizationContext:
        if not self.authority.configured:
            raise OAuthUnavailable("product OAuth authority is not configured")
        if not isinstance(access_token, str) or TOKEN_RE.fullmatch(access_token) is None:
            raise OAuthAccessDenied("invalid access token")

        context = self.authority.resolve_access_token(access_token)
        if context is None or context.revoked:
            raise OAuthAccessDenied("access token is revoked or unknown")

        if not isinstance(context.grant_id, str) or OPAQUE_ID_RE.fullmatch(context.grant_id) is None:
            raise OAuthAccessDenied("token grant is invalid")
        client = self._active_client(context.client_id)
        user_id = _valid_uuid(context.user_id, "token.user_id")
        space_id = _valid_uuid(context.space_id, "token.space_id")
        scopes = _normalize_scopes(context.scopes)
        if not set(scopes).issubset(client.allowed_scopes):
            raise OAuthAccessDenied("token scope exceeds client scope")
        if self.authority.can_act_as_space(user_id=user_id, space_id=space_id) is not True:
            raise OAuthAccessDenied("Space authorization is no longer active")
        return context

    def revoke(self, access_token: str) -> bool:
        if not self.authority.configured:
            raise OAuthUnavailable("product OAuth authority is not configured")
        if not isinstance(access_token, str) or TOKEN_RE.fullmatch(access_token) is None:
            raise OAuthInvalidRequest("token")
        revoked = self.authority.revoke_access_token(access_token)
        if not isinstance(revoked, bool):
            raise OAuthError("authority returned an invalid revocation result")
        return revoked

    def _active_client(self, client_id: str) -> OAuthClient:
        if not isinstance(client_id, str) or CLIENT_ID_RE.fullmatch(client_id) is None:
            raise OAuthInvalidRequest("client_id")
        client = self.authority.get_client(client_id)
        if client is None or client.state != "active":
            raise OAuthAccessDenied("unknown or inactive client")
        if client.client_id != client_id:
            raise OAuthError("authority returned mismatched client")
        if not client.public_client:
            raise OAuthAccessDenied("first-party browser flow requires a public client")
        if not client.redirect_uris or len(client.redirect_uris) > 16:
            raise OAuthError("client redirect registry is invalid")
        for uri in client.redirect_uris:
            _valid_redirect_uri(uri)
        allowed = _normalize_scopes(client.allowed_scopes)
        if allowed != client.allowed_scopes:
            raise OAuthError("client scope registry is not canonical")
        return client
