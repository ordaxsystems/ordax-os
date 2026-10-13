#!/usr/bin/env python3
"""Opaque runtime bindings between verified app identity and Native App Data.

Only a trusted host/inventory owner may select a verified receipt digest. App
requests never carry appId, publisherId, ownerScope or receipt identity.
"""

from __future__ import annotations

import re
import secrets
import threading
from contextlib import contextmanager
from dataclasses import dataclass

from native_app_data import (
    DEFAULT_APP_DATA_MAX_KEYS,
    DEFAULT_APP_DATA_QUOTA_BYTES,
    DEFAULT_APP_DATA_ROOT,
    MAX_APP_DATA_PARTITION_BYTES,
    MAX_APP_DATA_PARTITION_KEYS,
    validate_app_data_maintenance_request,
    assert_app_data_install_receipt_compatible,
)
from native_app_data_endpoint import handle_app_data_request
from native_app_install_identity import (
    DEFAULT_RECEIPT_ROOT,
    read_verified_app_install_identity,
)

APP_DATA_ENDPOINT_PREFIX = "/__ordax/native/app-data/"
DEFAULT_MAX_APP_DATA_BINDINGS = 64
_CAPABILITY_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")

# Quota is an owner-side policy derived only after install provenance has been
# verified. App/package metadata and request bodies cannot widen these limits.
_TRUSTED_FIRST_PARTY_LIMITS = {
    ("ordax-official", "notes", "device"): (
        MAX_APP_DATA_PARTITION_BYTES,
        2048,
    ),
}


def _storage_limits_for_verified_identity(identity: dict) -> tuple[int, int]:
    key = (
        identity["publisherId"],
        identity["appId"],
        identity["ownerScope"],
    )
    return _TRUSTED_FIRST_PARTY_LIMITS.get(
        key,
        (DEFAULT_APP_DATA_QUOTA_BYTES, DEFAULT_APP_DATA_MAX_KEYS),
    )


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
    quota_bytes: int
    max_keys: int
    source_version: str

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
        app_data_root: str = DEFAULT_APP_DATA_ROOT,
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
        if not isinstance(app_data_root, str) or not app_data_root.startswith("/"):
            raise TypeError("App Data binding app_data_root is invalid")

        self._receipt_root = receipt_root
        self._app_data_root = app_data_root
        self._expected_uid = expected_uid
        self._max_bindings = max_bindings
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._by_endpoint: dict[str, NativeAppDataBinding] = {}
        self._endpoint_by_identity: dict[tuple[str, str, str], str] = {}
        self._inflight: dict[tuple[str, str, str], int] = {}
        self._suspended: set[tuple[str, str, str]] = set()

    def _new_capability_locked(self, reserved_endpoints: set[str]) -> str:
        for _ in range(32):
            capability = secrets.token_urlsafe(32)
            if _CAPABILITY_RE.fullmatch(capability) is None:
                continue
            endpoint = f"{APP_DATA_ENDPOINT_PREFIX}{capability}"
            if endpoint not in self._by_endpoint and endpoint not in reserved_endpoints:
                return capability
        raise NativeAppDataBindingError("could not allocate App Data capability")

    def mint_many_from_receipts(
        self,
        receipt_sha256s: list[str] | tuple[str, ...],
    ) -> tuple[NativeAppDataBinding, ...]:
        if not isinstance(receipt_sha256s, (list, tuple)) or not receipt_sha256s:
            raise TypeError("Native App Data receipt batch must be a non-empty list or tuple")
        if len(receipt_sha256s) > 1024:
            raise NativeAppDataBindingCapacityError("Native App Data receipt batch is too large")

        verified_receipts = [
            read_verified_app_install_identity(
                receipt_sha256,
                root=self._receipt_root,
                expected_uid=self._expected_uid,
            )
            for receipt_sha256 in receipt_sha256s
        ]

        # Boot/restart admission must not treat an unretired checkpoint
        # as an authorization to run a different version of the app.
        # Validate *all* requested identities before mutating this registry.
        for verified in verified_receipts:
            assert_app_data_install_receipt_compatible(
                verified.app_data_identity(), verified.source_version,
                root=self._app_data_root,
            )

        durable_keys = []
        seen_keys = set()
        for verified in verified_receipts:
            identity = verified.app_data_identity()
            key = (
                identity["publisherId"],
                identity["appId"],
                identity["ownerScope"],
            )
            if key in seen_keys:
                raise NativeAppDataBindingError(
                    "Native App Data receipt batch contains duplicate durable identity"
                )
            seen_keys.add(key)
            durable_keys.append(key)

        with self._lock:
            if any(key in self._suspended for key in durable_keys):
                raise NativeAppDataBindingError("Native App Data binding is suspended for maintenance")
            # A replacement receipt may not grant the next version access
            # while an older version still has admitted App Data requests.
            # Fail the entire batch before planning any new capability.
            for key, verified in zip(durable_keys, verified_receipts, strict=True):
                endpoint = self._endpoint_by_identity.get(key)
                prior = self._by_endpoint.get(endpoint) if endpoint is not None else None
                if (prior is not None and prior.receipt_sha256 != verified.receipt_sha256
                        and self._inflight.get(key, 0)):
                    raise NativeAppDataBindingError(
                        "Native App Data receipt rotation requires drained requests"
                    )
            existing_by_key: dict[tuple[str, str, str], NativeAppDataBinding | None] = {}
            new_identity_count = 0
            for key in durable_keys:
                previous_endpoint = self._endpoint_by_identity.get(key)
                if previous_endpoint is None:
                    existing_by_key[key] = None
                    new_identity_count += 1
                    continue
                previous = self._by_endpoint.get(previous_endpoint)
                if previous is None:
                    raise NativeAppDataBindingError(
                        "Native App Data registry identity index is inconsistent"
                    )
                existing_by_key[key] = previous

            if len(self._by_endpoint) + new_identity_count > self._max_bindings:
                raise NativeAppDataBindingCapacityError(
                    "Native App Data binding capacity exhausted"
                )

            # Plan the entire batch, including capability allocation, before
            # mutating either registry map. Capacity or entropy failure therefore
            # cannot leave a partially authorized set of apps.
            reserved_endpoints: set[str] = set()
            planned: list[tuple[tuple[str, str, str], NativeAppDataBinding, str | None]] = []
            results: list[NativeAppDataBinding] = []
            for key, verified in zip(durable_keys, verified_receipts, strict=True):
                previous = existing_by_key[key]
                if previous is not None and previous.receipt_sha256 == verified.receipt_sha256:
                    planned.append((key, previous, None))
                    results.append(previous)
                    continue

                identity = verified.app_data_identity()
                capability = self._new_capability_locked(reserved_endpoints)
                quota_bytes, max_keys = _storage_limits_for_verified_identity(identity)
                binding = NativeAppDataBinding(
                    capability=capability,
                    receipt_sha256=verified.receipt_sha256,
                    publisher_id=identity["publisherId"],
                    app_id=identity["appId"],
                    owner_scope=identity["ownerScope"],
                    quota_bytes=quota_bytes,
                    max_keys=max_keys,
                    source_version=verified.source_version,
                )
                reserved_endpoints.add(binding.endpoint)
                planned.append((key, binding, previous.endpoint if previous is not None else None))
                results.append(binding)

            for key, binding, replaced_endpoint in planned:
                if replaced_endpoint is None and self._by_endpoint.get(binding.endpoint) is binding:
                    continue
                if replaced_endpoint is not None:
                    self._by_endpoint.pop(replaced_endpoint, None)
                self._by_endpoint[binding.endpoint] = binding
                self._endpoint_by_identity[key] = binding.endpoint

            return tuple(results)

    def mint_from_receipt(self, receipt_sha256: str) -> NativeAppDataBinding:
        return self.mint_many_from_receipts([receipt_sha256])[0]

    def resolve(self, endpoint: str) -> NativeAppDataBinding | None:
        if not isinstance(endpoint, str) or not endpoint.startswith(APP_DATA_ENDPOINT_PREFIX):
            return None
        capability = endpoint[len(APP_DATA_ENDPOINT_PREFIX):]
        if _CAPABILITY_RE.fullmatch(capability) is None:
            return None
        with self._lock:
            return self._by_endpoint.get(endpoint)

    @contextmanager
    def _admit_request(self, endpoint: str):
        # A request must lease the exact current capability before it can
        # cross into App Data. Resolve-then-dispatch is not sufficient: an
        # updater could revoke while a request waits in the HTTP worker.
        with self._condition:
            binding = self._by_endpoint.get(endpoint)
            if binding is None:
                raise NativeAppDataBindingNotFoundError("Native App Data capability is unknown")
            key = binding.identity_key()
            self._inflight[key] = self._inflight.get(key, 0) + 1
        try:
            yield binding
        finally:
            with self._condition:
                remaining = self._inflight[key] - 1
                if remaining:
                    self._inflight[key] = remaining
                else:
                    self._inflight.pop(key)
                self._condition.notify_all()

    @contextmanager
    def suspend_verified_receipt_for_maintenance(
        self, receipt_sha256: str, *, expected_source_release: dict | None = None,
        expected_revision: object = None,
    ):
        """Trusted host-only admission barrier; no app-facing revocation route.

        Reopens the same install receipt used to mint a capability, revokes
        that capability, then drains already-admitted requests. No new mint
        for the affected identity is allowed while this scope is active.
        It must be acquired BEFORE the canonical partition flock, otherwise
        requests blocked on flock could deadlock the drain.
        """
        verified = read_verified_app_install_identity(
            receipt_sha256,
            root=self._receipt_root,
            expected_uid=self._expected_uid,
        )
        identity = verified.app_data_identity()
        # The installer receipt is the current host's authenticated identity
        # source. Before revocation, ensure that a proposed owner checkpoint
        # at least correlates to this very installation, not another release
        # version or application. A match is NECESSARY, NEVER SUFFICIENT:
        # the receipt does not bind sourceCommit or grant signed activation.
        if expected_source_release is not None:
            if (
                not isinstance(expected_source_release, dict)
                or set(expected_source_release) != {"componentId", "version", "sourceCommit"}
                or expected_source_release["componentId"] != verified.app_id
                or expected_source_release["version"] != verified.source_version
            ):
                raise NativeAppDataBindingError(
                    "Native App Data maintenance source release does not match verified install receipt"
                )
            # Reuse canonical owner validation BEFORE revoking healthy grants.
            validate_app_data_maintenance_request(
                identity, expected_source_release, expected_revision,
            )
        key = (identity["publisherId"], identity["appId"], identity["ownerScope"])
        with self._condition:
            if key in self._suspended:
                raise NativeAppDataBindingError("Native App Data maintenance already active")
            endpoint = self._endpoint_by_identity.get(key)
            binding = self._by_endpoint.get(endpoint) if endpoint is not None else None
            if binding is None or binding.receipt_sha256 != receipt_sha256:
                raise NativeAppDataBindingNotFoundError(
                    "Native App Data receipt does not match an active binding"
                )
            self._suspended.add(key)
            self._by_endpoint.pop(endpoint)
            self._endpoint_by_identity.pop(key)
            # Drain every admitted request for this durable identity,
            # including old caps admitted before a verified receipt rotated.
            while self._inflight.get(key, 0):
                self._condition.wait()
        try:
            yield binding
        finally:
            with self._condition:
                self._suspended.discard(key)
                self._condition.notify_all()
        # Deliberately do not reissue the stale capability: only a new
        # verified-install owner handoff may mint a usable binding.

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
    with registry._admit_request(endpoint) as binding:
        effective_quota_bytes = (
            binding.quota_bytes
            if quota_bytes == DEFAULT_APP_DATA_QUOTA_BYTES
            else quota_bytes
        )
        effective_max_keys = (
            binding.max_keys
            if max_keys == DEFAULT_APP_DATA_MAX_KEYS
            else max_keys
        )
        return handle_app_data_request(
            body,
            identity=binding.app_data_identity(),
            root=root,
            quota_bytes=effective_quota_bytes,
            max_keys=effective_max_keys,
            installed_version=binding.source_version,
        )
