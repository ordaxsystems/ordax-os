#!/usr/bin/env python3
"""Native-only one-shot authority for Profile permission consent.

This module deliberately exposes no HTTP entrypoint. A trusted Native UI may
mint a receipt after an explicit human confirmation gesture. The Surface can
only submit a previously minted receipt for one-time consumption.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time

CONSENT_SCHEMA = "ordax.profile-human-consent/1"
MAX_PENDING_CONSENTS = 32
DEFAULT_TTL_MS = 2 * 60 * 1000


class ProfileHumanConsentAuthority:
    def __init__(self, *, secret: bytes | None = None, ttl_ms: int = DEFAULT_TTL_MS):
        if not isinstance(ttl_ms, int) or isinstance(ttl_ms, bool) or ttl_ms <= 0:
            raise ValueError("Profile consent ttl is invalid")
        self._secret = secret if secret is not None else secrets.token_bytes(32)
        if not isinstance(self._secret, bytes) or len(self._secret) < 32:
            raise ValueError("Profile consent secret is invalid")
        self._ttl_ms = ttl_ms
        self._pending: dict[str, dict] = {}

    @staticmethod
    def _canonical_bytes(value: object) -> bytes:
        return json.dumps(
            value,
            separators=(",", ":"),
            sort_keys=True,
            ensure_ascii=False,
            allow_nan=False,
        ).encode("utf-8")

    def _mac(self, unsigned: dict) -> str:
        return hmac.new(
            self._secret,
            self._canonical_bytes(unsigned),
            hashlib.sha256,
        ).hexdigest()

    def issue(
        self,
        *,
        permission_diff_sha256: str,
        expected_revision: int,
        space_id: str,
        profile: dict,
        now_ms: int | None = None,
    ) -> dict:
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
        if not isinstance(profile, dict) or set(profile) != {"slug", "version"}:
            raise ValueError("Profile consent identity is invalid")
        if len(self._pending) >= MAX_PENDING_CONSENTS:
            raise RuntimeError("Profile consent authority pending limit reached")
        issued_at = int(time.time() * 1000) if now_ms is None else now_ms
        if isinstance(issued_at, bool) or not isinstance(issued_at, int) or issued_at < 0:
            raise ValueError("Profile consent timestamp is invalid")
        nonce = secrets.token_hex(16)
        unsigned = {
            "schema": CONSENT_SCHEMA,
            "permissionDiffSha256": permission_diff_sha256,
            "expectedRevision": expected_revision,
            "spaceId": space_id,
            "profile": dict(profile),
            "issuedAt": issued_at,
            "expiresAt": issued_at + self._ttl_ms,
            "nonce": nonce,
        }
        receipt = {**unsigned, "mac": self._mac(unsigned)}
        self._pending[nonce] = receipt
        return dict(receipt)

    def consume(
        self,
        receipt: object,
        *,
        permission_diff_sha256: str,
        expected_revision: int,
        space_id: str,
        profile: dict,
        now_ms: int | None = None,
    ) -> None:
        if not isinstance(receipt, dict) or set(receipt) != {
            "schema", "permissionDiffSha256", "expectedRevision", "spaceId",
            "profile", "issuedAt", "expiresAt", "nonce", "mac",
        }:
            raise PermissionError("Profile human consent receipt is invalid")
        nonce = receipt.get("nonce")
        stored = self._pending.get(nonce)
        if stored is None:
            raise PermissionError("Profile human consent receipt is unknown or already consumed")
        unsigned = {key: receipt[key] for key in receipt if key != "mac"}
        if not hmac.compare_digest(receipt.get("mac", ""), self._mac(unsigned)):
            raise PermissionError("Profile human consent receipt integrity check failed")
        current = int(time.time() * 1000) if now_ms is None else now_ms
        if current > receipt["expiresAt"]:
            self._pending.pop(nonce, None)
            raise PermissionError("Profile human consent receipt expired")
        if (
            receipt["permissionDiffSha256"] != permission_diff_sha256
            or receipt["expectedRevision"] != expected_revision
            or receipt["spaceId"] != space_id
            or receipt["profile"] != profile
        ):
            raise PermissionError("Profile human consent receipt does not match activation intent")
        self._pending.pop(nonce, None)
