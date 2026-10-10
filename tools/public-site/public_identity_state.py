"""Canonical public identity state machine shared by deployment and network proofs.

The static runtime contract advertises either a fully enabled Account, a
limited auth-only rollout, or a disabled identity surface. Server session
status must agree with that contract; HTTP 200 by itself is not readiness.
This module performs no requests and never enables an account capability.
"""
from __future__ import annotations


class PublicIdentityStateError(ValueError):
    """A deployment contract and its observed account gateway disagree."""


def resolve_public_identity_mode(
    config: dict, session: dict, *, session_http_status: int = 200
) -> str:
    """Return full, auth-only, gated or disabled-unconfigured; fail closed otherwise."""
    if not isinstance(config, dict) or not isinstance(config.get("legal"), dict):
        raise PublicIdentityStateError("invalid-legal-configuration")
    legal = config["legal"]
    if type(legal.get("account_activation_ready")) is not bool:
        raise PublicIdentityStateError("config-legal-activation-invalid")
    if type(legal.get("auth_only_source_enabled", False)) is not bool:
        raise PublicIdentityStateError("config-auth-only-invalid")

    full = legal["account_activation_ready"]
    auth_only = legal.get("auth_only_source_enabled", False)
    if not isinstance(session, dict):
        raise PublicIdentityStateError("invalid-session-payload")

    if session_http_status == 503:
        if full or auth_only:
            raise PublicIdentityStateError("active-account-session-unavailable")
        if (session.get("$schema") != "prototype-ordax.public-site-proxy-error/1"
                or session.get("error") != "account-gateway-unconfigured"):
            raise PublicIdentityStateError("unexpected-account-gateway-failure")
        return "disabled-unconfigured"

    if session_http_status != 200:
        raise PublicIdentityStateError("session-http-status-invalid")
    if session.get("$schema") != "prototype-ordax.public-identity-session/1":
        raise PublicIdentityStateError("session-schema")
    if session.get("authenticated") is not False:
        raise PublicIdentityStateError("unexpected-authenticated-session")
    provider = session.get("provider")
    if full or auth_only:
        if provider != "supabase":
            raise PublicIdentityStateError("public-session-provider-invalid")
        if session.get("status") != "anonymous":
            raise PublicIdentityStateError("public-session-status-invalid")
        return "full" if full else "auth-only"

    if provider != "gated" or session.get("status") != "unavailable":
        raise PublicIdentityStateError("public-account-gate-not-enforced")
    return "gated"
