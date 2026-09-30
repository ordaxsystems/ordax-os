"""Strict Native proxy boundary for the account-scoped cloud Memory entitlement.

This module is deliberately narrower than the account gateway. It exposes one
fixed read operation, accepts no route/key/subject input from Surface code and
sanitizes the upstream decision before the Native loopback host can return it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

ENTITLEMENTS_SCHEMA = "ordax.entitlements/1"
MEMORY_CLOUD_ENTITLEMENT = "memory.cloud.enabled"
MAX_ENTITLEMENT_BODY_BYTES = 16 * 1024
MAX_SUBJECT_ID_CHARS = 160
_ALLOWED_DECISIONS = frozenset(("allowed", "denied", "limited"))
_EXPECTED_KEYS = frozenset((
    "schema",
    "subjectType",
    "subjectId",
    "key",
    "decision",
    "value",
    "authority",
    "expiresAt",
))


class NativeMemoryEntitlementProxyError(RuntimeError):
    """Raised when the upstream entitlement response escapes the Native boundary."""


@dataclass(frozen=True)
class NativeMemoryEntitlementReply:
    status: int
    payload: dict | None


def _bounded_subject_id(value: object) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement subject")
    normalized = value.strip()
    if not normalized or normalized != value or len(normalized) > MAX_SUBJECT_ID_CHARS:
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement subject")
    return normalized


def _validate_expiry(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip() or value != value.strip() or len(value) > 96:
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement expiry")
    return value


def _sanitize_payload(value: object) -> dict:
    if not isinstance(value, dict) or frozenset(value) != _EXPECTED_KEYS:
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement response shape")
    if value.get("schema") != ENTITLEMENTS_SCHEMA:
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement schema")
    if value.get("subjectType") != "account":
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement subject type")
    subject_id = _bounded_subject_id(value.get("subjectId"))
    if value.get("key") != MEMORY_CLOUD_ENTITLEMENT:
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement key")
    if value.get("authority") != "server":
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement authority")
    decision = value.get("decision")
    if decision not in _ALLOWED_DECISIONS:
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement decision")
    if value.get("value") is not None:
        raise NativeMemoryEntitlementProxyError("Memory cloud entitlement value must be null")
    expires_at = _validate_expiry(value.get("expiresAt"))
    return {
        "schema": ENTITLEMENTS_SCHEMA,
        "subjectType": "account",
        "subjectId": subject_id,
        "key": MEMORY_CLOUD_ENTITLEMENT,
        "decision": decision,
        "value": None,
        "authority": "server",
        "expiresAt": expires_at,
    }


def read_native_memory_cloud_entitlement(account_gateway: object) -> NativeMemoryEntitlementReply:
    """Read and sanitize the single server-authoritative Memory entitlement.

    The caller supplies only the already-configured Native account gateway. No
    subject, key, route or authority value crosses this function boundary.
    """

    reader = getattr(account_gateway, "memory_cloud_entitlement", None)
    if not callable(reader):
        raise NativeMemoryEntitlementProxyError("Native account gateway is unavailable")

    upstream = reader()
    status = getattr(upstream, "status", None)
    body = getattr(upstream, "body", None)
    if isinstance(status, bool) or not isinstance(status, int):
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement upstream status")

    if status != 200:
        if 400 <= status <= 599:
            return NativeMemoryEntitlementReply(status=status, payload=None)
        raise NativeMemoryEntitlementProxyError("unexpected Memory entitlement upstream status")

    if not isinstance(body, bytes) or not body or len(body) > MAX_ENTITLEMENT_BODY_BYTES:
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement upstream body")
    try:
        decoded = json.loads(body.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise NativeMemoryEntitlementProxyError("invalid Memory entitlement upstream JSON") from exc

    return NativeMemoryEntitlementReply(status=200, payload=_sanitize_payload(decoded))
