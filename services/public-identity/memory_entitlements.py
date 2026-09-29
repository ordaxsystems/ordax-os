"""Server-authoritative Memory entitlement decisions for OrdaX account clients.

This module deliberately has no HTTP surface of its own. The public/native
account gateway can compose it only after authenticating the existing HttpOnly
account session. The account subject is derived from the access token; callers
cannot provide an arbitrary subject id to self-issue cloud Memory authority.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

MEMORY_CLOUD_ENTITLEMENT = "memory.cloud.enabled"
ENTITLEMENTS_PORT_SCHEMA = "ordax.entitlements/1"


@runtime_checkable
class IdentitySubjectProvider(Protocol):
    def get_user(self, access_token: str) -> tuple[str, str]: ...


@runtime_checkable
class MemoryEntitlementProvider(Protocol):
    def has_account_cloud_entitlement(self, access_token: str) -> bool: ...


def _bounded(value: str, label: str, maximum: int = 160) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise TypeError(f"{label} must be text")
    normalized = value.strip()
    if not normalized or len(normalized) > maximum:
        raise ValueError(f"{label} is outside its allowed bounds")
    return normalized


class AccountMemoryEntitlementAuthority:
    """Resolve the cloud-Memory entitlement from the authenticated server session."""

    def __init__(
        self,
        identity_provider: IdentitySubjectProvider,
        memory_provider: MemoryEntitlementProvider,
    ) -> None:
        if not isinstance(identity_provider, IdentitySubjectProvider):
            raise TypeError("Memory entitlement authority requires an identity provider")
        if not isinstance(memory_provider, MemoryEntitlementProvider):
            raise TypeError("Memory entitlement authority requires a Memory entitlement provider")
        self._identity = identity_provider
        self._memory = memory_provider

    def resolve(self, access_token: str, key: str = MEMORY_CLOUD_ENTITLEMENT) -> dict:
        token = _bounded(access_token, "access token", 16384)
        entitlement_key = _bounded(key, "entitlement key", 96)
        if entitlement_key != MEMORY_CLOUD_ENTITLEMENT:
            raise ValueError("unsupported-memory-entitlement")

        subject_id, _email = self._identity.get_user(token)
        subject = _bounded(subject_id, "account subject id", 160)
        allowed = self._memory.has_account_cloud_entitlement(token) is True

        return {
            "schema": ENTITLEMENTS_PORT_SCHEMA,
            "subjectType": "account",
            "subjectId": subject,
            "key": MEMORY_CLOUD_ENTITLEMENT,
            "decision": "allowed" if allowed else "denied",
            "value": None,
            "authority": "server",
            "expiresAt": None,
        }
