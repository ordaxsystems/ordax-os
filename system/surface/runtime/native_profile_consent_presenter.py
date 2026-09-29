#!/usr/bin/env python3
"""Native-only coordination boundary for presenting Profile permission consent.

The coordinator owns short-lived presentation requests and delegates receipt
minting to ProfileHumanConsentAuthority only after a trusted Native presenter
returns an explicit approve/reject decision. No HTTP transport is defined here.
"""

from __future__ import annotations

import secrets
import time

from native_profile_human_consent import ProfileHumanConsentAuthority

REQUEST_SCHEMA = "ordax.profile-human-consent-request/1"
DECISION_SCHEMA = "ordax.profile-human-consent-decision/1"
DEFAULT_REQUEST_TTL_MS = 2 * 60 * 1000
MAX_PENDING_REQUESTS = 16


class ProfileHumanConsentCoordinator:
    def __init__(
        self,
        authority: ProfileHumanConsentAuthority,
        *,
        ttl_ms: int = DEFAULT_REQUEST_TTL_MS,
    ):
        if not isinstance(authority, ProfileHumanConsentAuthority):
            raise TypeError("Profile consent coordinator requires Native consent authority")
        if isinstance(ttl_ms, bool) or not isinstance(ttl_ms, int) or ttl_ms <= 0:
            raise ValueError("Profile consent request ttl is invalid")
        self._authority = authority
        self._ttl_ms = ttl_ms
        self._pending: dict[str, dict] = {}

    def prepare(
        self,
        *,
        permission_diff: dict,
        permission_diff_sha256: str,
        expected_revision: int,
        space_id: str,
        space_kind: str,
        profile: dict,
        now_ms: int | None = None,
    ) -> dict:
        if len(self._pending) >= MAX_PENDING_REQUESTS:
            raise RuntimeError("Profile consent presenter pending limit reached")
        if not isinstance(permission_diff, dict) or permission_diff.get("schema") != "ordax.profile-permission-diff/1":
            raise ValueError("Profile consent permission diff is invalid")
        if (
            not isinstance(permission_diff_sha256, str)
            or len(permission_diff_sha256) != 64
            or any(ch not in "0123456789abcdef" for ch in permission_diff_sha256)
        ):
            raise ValueError("Profile consent permission diff hash is invalid")
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0:
            raise ValueError("Profile consent revision is invalid")
        if not isinstance(space_id, str) or not space_id or len(space_id) > 160:
            raise ValueError("Profile consent Space id is invalid")
        if space_kind not in {"personal", "work", "professional"}:
            raise ValueError("Profile consent Space kind is invalid")
        if not isinstance(profile, dict) or set(profile) != {"slug", "version"}:
            raise ValueError("Profile consent Profile identity is invalid")
        issued_at = int(time.time() * 1000) if now_ms is None else now_ms
        if isinstance(issued_at, bool) or not isinstance(issued_at, int) or issued_at < 0:
            raise ValueError("Profile consent request timestamp is invalid")
        request_id = secrets.token_hex(16)
        request = {
            "schema": REQUEST_SCHEMA,
            "requestId": request_id,
            "permissionDiff": permission_diff,
            "permissionDiffSha256": permission_diff_sha256,
            "expectedRevision": expected_revision,
            "spaceId": space_id,
            "spaceKind": space_kind,
            "profile": dict(profile),
            "issuedAt": issued_at,
            "expiresAt": issued_at + self._ttl_ms,
        }
        self._pending[request_id] = request
        return dict(request)

    def decide(
        self,
        decision: object,
        *,
        now_ms: int | None = None,
    ) -> dict | None:
        if not isinstance(decision, dict) or set(decision) != {"schema", "requestId", "approved"}:
            raise ValueError("Profile consent decision is invalid")
        if decision.get("schema") != DECISION_SCHEMA or not isinstance(decision.get("approved"), bool):
            raise ValueError("Profile consent decision is invalid")
        request_id = decision.get("requestId")
        if not isinstance(request_id, str):
            raise ValueError("Profile consent decision request id is invalid")
        request = self._pending.pop(request_id, None)
        if request is None:
            raise PermissionError("Profile consent request is unknown or already decided")
        current = int(time.time() * 1000) if now_ms is None else now_ms
        if current > request["expiresAt"]:
            raise PermissionError("Profile consent request expired")
        if decision["approved"] is False:
            return None
        return self._authority.issue(
            permission_diff_sha256=request["permissionDiffSha256"],
            expected_revision=request["expectedRevision"],
            space_id=request["spaceId"],
            profile=request["profile"],
            now_ms=current,
        )

    def cancel_expired(self, *, now_ms: int | None = None) -> int:
        current = int(time.time() * 1000) if now_ms is None else now_ms
        expired = [
            request_id
            for request_id, request in self._pending.items()
            if current > request["expiresAt"]
        ]
        for request_id in expired:
            self._pending.pop(request_id, None)
        return len(expired)
