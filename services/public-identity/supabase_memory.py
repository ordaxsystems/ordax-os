"""Supabase REST adapter for server-authoritative OrdaX cloud Memory.

The adapter accepts only a user access token plus the public Supabase key.
It never grants entitlements, never uses service-role authority and never
writes the canonical Memory table directly. All mutations go through the
atomic server-authoritative RPC.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from typing import Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MEMORY_ENTITLEMENT = "memory.cloud.enabled"


class SupabaseMemoryError(RuntimeError):
    def __init__(self, code: str, *, status: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


class Transport(Protocol):
    def request(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None,
    ) -> tuple[int, bytes]: ...


class UrllibTransport:
    def request(self, method, url, headers, body):
        request = Request(url, data=body, headers=dict(headers), method=method)
        try:
            with urlopen(request, timeout=20) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
                status = int(response.status)
        except HTTPError as exc:
            payload = exc.read(MAX_RESPONSE_BYTES + 1)
            status = int(exc.code)
        except (URLError, OSError) as exc:
            raise SupabaseMemoryError("provider-unreachable") from exc
        if len(payload) > MAX_RESPONSE_BYTES:
            raise SupabaseMemoryError("provider-response-too-large", status=status)
        return status, payload


def _base_url(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("Supabase URL must be a string")
    split = urlsplit(value.strip())
    if (
        split.scheme != "https"
        or not split.netloc
        or split.username is not None
        or split.password is not None
        or split.query
        or split.fragment
        or split.path not in ("", "/")
    ):
        raise ValueError("Supabase URL must be an HTTPS origin")
    return f"https://{split.netloc}"


def _publishable_key(value: str) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith("sb_publishable_")
        or any(ch.isspace() for ch in value)
        or len(value) < len("sb_publishable_") + 8
        or len(value) > 512
    ):
        raise ValueError("Supabase Memory adapter requires a publishable key")
    return value


def _access_token(value: str) -> str:
    if not isinstance(value, str) or not value or any(ch.isspace() for ch in value):
        raise ValueError("Access token is invalid")
    return value


def _json(raw: bytes, status: int):
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise SupabaseMemoryError("provider-invalid-response", status=status) from exc


def _provider_timestamp(value: object, label: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise SupabaseMemoryError(f"provider-invalid-{label}")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise SupabaseMemoryError(f"provider-invalid-{label}") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SupabaseMemoryError(f"provider-invalid-{label}")
    return parsed.astimezone(timezone.utc)


def _utc_now(value: datetime | None) -> datetime:
    current = datetime.now(timezone.utc) if value is None else value
    if not isinstance(current, datetime) or current.tzinfo is None or current.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    return current.astimezone(timezone.utc)


@dataclass(frozen=True)
class MemoryApplyResult:
    memory_id: str
    server_revision: int
    tombstone: bool
    applied: bool
    conflict: bool
    change_cursor: int | None


class SupabaseMemoryProvider:
    def __init__(
        self,
        project_url: str,
        publishable_key: str,
        *,
        transport: Transport | None = None,
    ) -> None:
        self.project_url = _base_url(project_url)
        self.publishable_key = _publishable_key(publishable_key)
        self.transport = transport or UrllibTransport()

    def _headers(self, access_token: str, *, json_body: bool = False) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "apikey": self.publishable_key,
            "Authorization": f"Bearer {_access_token(access_token)}",
        }
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    def _request_json(
        self,
        method: str,
        path: str,
        access_token: str,
        payload: dict | None = None,
    ):
        body = None
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        status, raw = self.transport.request(
            method,
            self.project_url + path,
            self._headers(access_token, json_body=body is not None),
            body,
        )
        value = _json(raw, status)
        if status < 200 or status >= 300:
            raise SupabaseMemoryError("provider-memory-failed", status=status)
        return value

    def has_account_cloud_entitlement(
        self,
        access_token: str,
        *,
        now: datetime | None = None,
    ) -> bool:
        """Read-only preflight; the mutation RPC remains the authorization authority."""
        query = urlencode(
            {
                "select": "entitlement_value,valid_from,valid_until",
                "entitlement_key": f"eq.{MEMORY_ENTITLEMENT}",
                "user_id": "not.is.null",
                "limit": "16",
            }
        )
        value = self._request_json(
            "GET",
            f"/rest/v1/ordax_entitlement_grants?{query}",
            access_token,
        )
        if not isinstance(value, list):
            raise SupabaseMemoryError("provider-invalid-entitlement-response")
        current = _utc_now(now)
        for row in value:
            if not isinstance(row, dict):
                raise SupabaseMemoryError("provider-invalid-entitlement-response")
            entitlement = row.get("entitlement_value")
            valid_from = _provider_timestamp(row.get("valid_from"), "entitlement-valid-from")
            raw_until = row.get("valid_until")
            valid_until = (
                None
                if raw_until is None
                else _provider_timestamp(raw_until, "entitlement-valid-until")
            )
            if valid_until is not None and valid_until <= valid_from:
                raise SupabaseMemoryError("provider-invalid-entitlement-window")
            if (
                isinstance(entitlement, dict)
                and entitlement.get("decision") == "allowed"
                and valid_from <= current
                and (valid_until is None or valid_until > current)
            ):
                return True
        return False

    def apply(
        self,
        access_token: str,
        *,
        idempotency_key: str,
        memory_id: str | None,
        scope: str,
        space_id: str | None,
        kind: str,
        sensitivity: str,
        content: str,
        provenance: str,
        source_timestamp: str,
        confidence: float | None,
        base_server_revision: int,
        tombstone: bool,
        resolver_version: int = 1,
    ) -> MemoryApplyResult:
        value = self._request_json(
            "POST",
            "/rest/v1/rpc/ordax_apply_memory_mutation_v1",
            access_token,
            {
                "p_idempotency_key": idempotency_key,
                "p_memory_id": memory_id,
                "p_scope": scope,
                "p_space_id": space_id,
                "p_kind": kind,
                "p_sensitivity": sensitivity,
                "p_content": content,
                "p_provenance": provenance,
                "p_source_timestamp": source_timestamp,
                "p_confidence": confidence,
                "p_base_server_revision": base_server_revision,
                "p_tombstone": tombstone,
                "p_resolver_version": resolver_version,
            },
        )
        if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
            raise SupabaseMemoryError("provider-invalid-memory-apply")
        row = value[0]
        memory_value = row.get("memory_id")
        revision = row.get("server_revision")
        cursor = row.get("change_cursor")
        if (
            not isinstance(memory_value, str)
            or not memory_value
            or isinstance(revision, bool)
            or not isinstance(revision, int)
            or revision < 0
            or (
                cursor is not None
                and (isinstance(cursor, bool) or not isinstance(cursor, int) or cursor < 0)
            )
        ):
            raise SupabaseMemoryError("provider-invalid-memory-apply")
        return MemoryApplyResult(
            memory_id=memory_value,
            server_revision=revision,
            tombstone=bool(row.get("tombstone")),
            applied=bool(row.get("applied")),
            conflict=bool(row.get("conflict")),
            change_cursor=cursor,
        )

    def read_state(self, access_token: str, memory_id: str) -> dict:
        if not isinstance(memory_id, str) or not memory_id:
            raise ValueError("memory_id is required")
        query = urlencode(
            {
                "select": "memory_id,scope,state,sensitivity",
                "memory_id": f"eq.{memory_id}",
                "limit": "2",
            }
        )
        value = self._request_json(
            "GET",
            f"/rest/v1/ordax_memory_items?{query}",
            access_token,
        )
        if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
            raise SupabaseMemoryError("provider-memory-state-not-found")
        row = value[0]
        if row.get("memory_id") != memory_id:
            raise SupabaseMemoryError("provider-invalid-memory-state")
        return row
