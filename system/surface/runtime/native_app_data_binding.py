#!/usr/bin/env python3
"""Opaque runtime bindings between verified app identity and Native App Data.

Only a trusted host/inventory owner may select a verified receipt digest. App
requests never carry appId, publisherId, ownerScope or receipt identity.
"""

from __future__ import annotations

import re
import secrets
import threading
from dataclasses import dataclass

from native_app_data import (
    DEFAULT_APP_DATA_MAX_KEYS,
    DEFAULT_APP_DATA_QUOTA_BYTES,
    DEFAULT_APP_DATA_ROOT,
)
from native_app_data_endpoint import handle_app_data_request
from native_app_install_identity import (
    DEFAULT_RECEIPT_ROOT,
    read_verified_app_install_identity,
)

APP_DATA_ENDPOINT_PREFIX = "/__ordax/native/app-data/"
DEFAULT_MAX_APP_DATA_BINDINGS = 64
_CAPABILITY_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")


class NativeAppDataBindingError(RuntimeError):
    pass


class NativeAppDataBindingNotFoundError(NativeAppDataBindingError):
    pass


class NativeAppDataBindingCapacityError(NativeAppDataBindingError):
    pass


@dataclass(frozen=True)
class NativeAppDataBinding:
    capability: str
    receipt_sha256: str
    publisher_id: str
    app_id: str
    owner_scope: str

    @property
    def endpoint(self) -> str:
        return f"{APP_DATA_ENDPOINT_PREFIX}{self.capability}"

    def app_data_identity(self) -> dict:
        return {
            "publisherId": self.publisher_id,
            "appId": self.app_id,
            "ownerScope": self.owner_scope,
        }

    def identity_key(self) -> tuple[str, str, str]:
        return (self.publisher_id, self.app_id, self.owner_scope)


class NativeAppDataBindingRegistry:
    """Per-host ephemeral capability registry.

    There is deliberately no API that mints from a raw identity. A capability
    can only be produced by consuming a content-addressed verified receipt.
    """

    def __init__(
        self,
        *,
        receipt_root: str = DEFAULT_RECEIPT_ROOT,
        expected_uid: int,
        max_bindings: int = DEFAULT_MAX_APP_DATA_BINDINGS,
    ) -> None:
        if (
            not isinstance(expected_uid, int)
            or isinstance(expected_uid, bool)
            or expected_uid < 0
        ):
            raise TypeError("App Data binding expected_uid is invalid")
        if (
            not isinstance(max_bindings, int)
            or isinstance(max_bindings, bool)
            or max_bindings < 1
            or max_bindings > 1024
        ):
            raise TypeError("App Data binding max_bindings is invalid")
        if not isinstance(receipt_root, str) or not receipt_root:
            raise TypeError("App Data binding receipt_root is invalid")

        self._receipt_root = receipt_root
        self._expected_uid = expected_uid
        self._max_bindings = max_bindings
        self._lock = threading.Lock()
        self._by_endpoint: dict[str, NativeAppDataBinding] = {}
        self._endpoint_by_identity: dict[tuple[str, str, str], str] = {}

    def _new_capability(self) -> str:
        for _ in range(32):
            capability = secrets.token_urlsafe(32)
            if _CAPABILITY_RE.fullmatch(capability) is None:
                continue
            endpoint = f"{APP_DATA_ENDPOINT_PREFIX}{capability}"
            if endpoint not in self._by_endpoint:
                return capability
        raise NativeAppDataBindingError("could not allocate App Data capability")

    def mint_from_receipt(self, receipt_sha256: str) -> NativeAppDataBinding:
        verified = read_verified_app_install_identity(
            receipt_sha256,
            root=self._receipt_root,
            expected_uid=self._expected_uid,
        )
        identity = verified.app_data_identity()
        identity_key = (
            identity["publisherId"],
            identity["appId"],
            identity["ownerScope"],
        )

        with self._lock:
            previous_endpoint = self._endpoint_by_identity.get(identity_key)
            if previous_endpoint is not None:
                previous = self._by_endpoint.get(previous_endpoint)
                if previous is not None and previous.receipt_sha256 == verified.receipt_sha256:
                    return previous

            replacing = previous_endpoint is not None
            if not replacing and len(self._by_endpoint) >= self._max_bindings:
                raise NativeAppDataBindingCapacityError(
                    "Native App Data binding capacity exhausted"
                )

            capability = self._new_capability()
            binding = NativeAppDataBinding(
                capability=capability,
                receipt_sha256=verified.receipt_sha256,
                publisher_id=identity["publisherId"],
                app_id=identity["appId"],
                owner_scope=identity["ownerScope"],
            )

            # A newer verified receipt for the same durable identity rotates the
            # capability. Old app code cannot retain authority after the host
            # accepts the replacement receipt.
            if previous_endpoint is not None:
                self._by_endpoint.pop(previous_endpoint, None)
            self._by_endpoint[binding.endpoint] = binding
            self._endpoint_by_identity[identity_key] = binding.endpoint
            return binding

    def resolve(self, endpoint: str) -> NativeAppDataBinding | None:
        if not isinstance(endpoint, str) or not endpoint.startswith(APP_DATA_ENDPOINT_PREFIX):
            return None
        capability = endpoint[len(APP_DATA_ENDPOINT_PREFIX):]
        if _CAPABILITY_RE.fullmatch(capability) is None:
            return None
        with self._lock:
            return self._by_endpoint.get(endpoint)

    def active_binding_count(self) -> int:
        with self._lock:
            return len(self._by_endpoint)


def handle_bound_app_data_request(
    registry: NativeAppDataBindingRegistry,
    endpoint: str,
    body: bytes,
    *,
    root: str = DEFAULT_APP_DATA_ROOT,
    quota_bytes: int = DEFAULT_APP_DATA_QUOTA_BYTES,
    max_keys: int = DEFAULT_APP_DATA_MAX_KEYS,
) -> dict:
    if not isinstance(registry, NativeAppDataBindingRegistry):
        raise TypeError("Native App Data binding registry is required")
    binding = registry.resolve(endpoint)
    if binding is None:
        raise NativeAppDataBindingNotFoundError("Native App Data capability is unknown")
    return handle_app_data_request(
        body,
        identity=binding.app_data_identity(),
        root=root,
        quota_bytes=quota_bytes,
        max_keys=max_keys,
    )
