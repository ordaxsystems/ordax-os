"""Supabase REST adapter for OrdaX account lifecycle reads.

This adapter owns only provider-specific account export transport. It receives
an already validated user access token and calls the reviewed
``ordax_account_export_v1`` boundary. The RPC is SECURITY DEFINER only so it can
read the private sync relation after the least-privilege split; it pins an empty
search_path and scopes every exported domain to ``auth.uid()``. EXECUTE remains
limited to authenticated users (plus the database owner), and no service-role
key is accepted or used here.
"""

from __future__ import annotations

import json
from typing import Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

MAX_RESPONSE_BYTES = 16 * 1024 * 1024
MAX_VISIBLE_SPACES = 64
EXPORT_SCHEMA = "prototype-ordax.account-export/1"


class SupabaseAccountError(RuntimeError):
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
            with urlopen(request, timeout=30) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
                status = int(response.status)
        except HTTPError as exc:
            payload = exc.read(MAX_RESPONSE_BYTES + 1)
            status = int(exc.code)
        except (URLError, OSError) as exc:
            raise SupabaseAccountError("provider-unreachable") from exc
        if len(payload) > MAX_RESPONSE_BYTES:
            raise SupabaseAccountError("provider-response-too-large", status=status)
        return status, payload


def _validated_base_url(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("Supabase URL must be a string")
    split = urlsplit(value)
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


def _validated_publishable_key(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("Supabase publishable key must be a string")
    if not value.startswith("sb_publishable_") or any(ch.isspace() for ch in value):
        raise ValueError("Supabase account adapter requires an sb_publishable_ key")
    if len(value) < len("sb_publishable_") + 8 or len(value) > 512:
        raise ValueError("Supabase publishable key length is invalid")
    return value


class SupabaseAccountProvider:
    def __init__(
        self,
        project_url: str,
        publishable_key: str,
        *,
        transport: Transport | None = None,
    ) -> None:
        self.project_url = _validated_base_url(project_url)
        self.publishable_key = _validated_publishable_key(publishable_key)
        self.transport = transport or UrllibTransport()

    def export_account(self, access_token: str) -> dict:
        if not isinstance(access_token, str) or not access_token:
            raise ValueError("Access token is invalid")
        status, raw = self.transport.request(
            "POST",
            self.project_url + "/rest/v1/rpc/ordax_account_export_v1",
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "apikey": self.publishable_key,
                "Authorization": f"Bearer {access_token}",
            },
            b"{}",
        )
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise SupabaseAccountError("provider-invalid-response", status=status) from exc
        if status < 200 or status >= 300:
            raise SupabaseAccountError("provider-account-export-failed", status=status)
        if not isinstance(value, dict) or value.get("$schema") != EXPORT_SCHEMA:
            raise SupabaseAccountError("provider-invalid-account-export", status=status)
        subject = value.get("subject")
        if not isinstance(subject, str) or not subject:
            raise SupabaseAccountError("provider-invalid-account-export", status=status)
        for section in (
            "spaces",
            "memberships",
            "space_profile_packs",
            "entitlements",
            "projects",
            "devices",
            "project_connections",
            "memory_items",
            "sync_objects",
        ):
            if not isinstance(value.get(section), list):
                raise SupabaseAccountError("provider-invalid-account-export", status=status)
        if not isinstance(value.get("account"), dict):
            raise SupabaseAccountError("provider-invalid-account-export", status=status)
        return value


    def list_spaces(self, access_token: str) -> list[dict]:
        if not isinstance(access_token, str) or not access_token:
            raise ValueError("Access token is invalid")
        headers = {
            "Accept": "application/json",
            "apikey": self.publishable_key,
            "Authorization": f"Bearer {access_token}",
        }
        spaces_status, spaces_raw = self.transport.request(
            "GET",
            self.project_url
            + "/rest/v1/ordax_spaces"
            + "?select=space_id,owner_user_id,name,kind,state"
            + "&order=created_at.asc"
            + f"&limit={MAX_VISIBLE_SPACES + 1}",
            headers,
            None,
        )
        packs_status, packs_raw = self.transport.request(
            "GET",
            self.project_url
            + "/rest/v1/ordax_space_profile_packs"
            + "?select=space_id,pack_slug,pack_version"
            + f"&limit={MAX_VISIBLE_SPACES + 1}",
            headers,
            None,
        )
        try:
            spaces_value = json.loads(spaces_raw.decode("utf-8"))
            packs_value = json.loads(packs_raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise SupabaseAccountError("provider-invalid-spaces-response") from exc
        if not (200 <= spaces_status < 300 and 200 <= packs_status < 300):
            raise SupabaseAccountError(
                "provider-spaces-read-failed",
                status=spaces_status if not 200 <= spaces_status < 300 else packs_status,
            )
        if (
            not isinstance(spaces_value, list)
            or not isinstance(packs_value, list)
            or len(spaces_value) > MAX_VISIBLE_SPACES
            or len(packs_value) > MAX_VISIBLE_SPACES
        ):
            raise SupabaseAccountError("provider-invalid-spaces-response")

        pack_by_space: dict[str, str] = {}
        for row in packs_value:
            if (
                not isinstance(row, dict)
                or not isinstance(row.get("space_id"), str)
                or not isinstance(row.get("pack_slug"), str)
                or not 1 <= len(row["pack_slug"]) <= 160
                or "\x00" in row["pack_slug"]
                or isinstance(row.get("pack_version"), bool)
                or not isinstance(row.get("pack_version"), int)
                or row["pack_version"] < 1
                or row["space_id"] in pack_by_space
            ):
                raise SupabaseAccountError("provider-invalid-spaces-response")
            pack_by_space[row["space_id"]] = row["pack_slug"]

        spaces: list[dict] = []
        seen: set[str] = set()
        for row in spaces_value:
            if not isinstance(row, dict):
                raise SupabaseAccountError("provider-invalid-spaces-response")
            space_id = row.get("space_id")
            owner_id = row.get("owner_user_id")
            name = row.get("name")
            kind = row.get("kind")
            state = row.get("state")
            if (
                not isinstance(space_id, str)
                or not space_id
                or "\x00" in space_id
                or space_id in seen
                or not isinstance(owner_id, str)
                or not owner_id
                or "\x00" in owner_id
                or not isinstance(name, str)
                or not 1 <= len(name) <= 120
                or "\x00" in name
                or kind not in {"personal", "work", "professional"}
                or state not in {"active", "archived"}
            ):
                raise SupabaseAccountError("provider-invalid-spaces-response")
            seen.add(space_id)
            spaces.append(
                {
                    "id": space_id,
                    "ownerId": owner_id,
                    "name": name,
                    "kind": kind,
                    "state": state,
                    "profilePack": pack_by_space.get(space_id),
                }
            )
        return spaces
