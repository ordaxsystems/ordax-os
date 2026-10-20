"""Native-only bridge to the existing OrdaX Platform owner MCP grant authority.

No independent grant store, OAuth server, credentials in Surface JS or executor.
The Platform checks owner, consented OAuth client and bound device on every call.
"""
from __future__ import annotations

import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

from product_device_enrollment import _validated_control_plane_origin

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
MAX_RESPONSE_BYTES = 256 * 1024
PROFILE = "full-computer-control"


class OwnerRemotePermissionError(RuntimeError):
    def __init__(self, code: str, status: int = 503):
        self.code = code
        self.status = status
        super().__init__(code)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class ProductOwnerRemotePermissions:
    """Read and mutate only the canonical device-scoped owner-grant profile."""

    def __init__(self, origin: str, gateway, identity_store, *, opener=None):
        self.origin = _validated_control_plane_origin(origin)
        self.gateway = gateway
        self.identity_store = identity_store
        self.opener = opener if opener is not None else build_opener(_NoRedirect())

    def _identity(self):
        credential = self.identity_store.read_enrolled_credential()
        device_id = credential.get("device_id") if isinstance(credential, dict) else None
        if not isinstance(device_id, str) or not UUID.fullmatch(device_id):
            raise OwnerRemotePermissionError("device-not-enrolled", 409)
        try:
            session = self.gateway.session()
            body = json.loads(session.body.decode("utf-8"))
            if session.status != 200 or not isinstance(body, dict) or body.get("authenticated") is not True:
                raise OwnerRemotePermissionError("account-authentication-required", 401)
            subject = body.get("subject")
            if not isinstance(subject, str) or not UUID.fullmatch(subject):
                raise OwnerRemotePermissionError("account-subject-invalid", 401)
            token = self.gateway._product_access_token()
        except OwnerRemotePermissionError:
            raise
        except (RuntimeError, OSError, UnicodeError, ValueError, AttributeError):
            raise OwnerRemotePermissionError("account-authentication-required", 401) from None
        if not isinstance(token, str) or not token:
            raise OwnerRemotePermissionError("account-authentication-required", 401)
        return device_id, token

    def _call(self, method: str, path: str, token: str, payload: dict | None = None):
        body = None if payload is None else json.dumps(
            payload, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
        request = Request(
            self.origin + path, data=body, method=method,
            headers={
                "Accept": "application/json",
                "Authorization": "Bearer " + token,
                "User-Agent": "OrdaX-Native-Owner-Permissions/1",
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
        )
        try:
            with self.opener.open(request, timeout=10) as response:
                status = response.status
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as error:
            status = error.code
            raw = error.read(MAX_RESPONSE_BYTES + 1)
        except (URLError, OSError):
            raise OwnerRemotePermissionError("remote-authority-unreachable") from None
        if len(raw) > MAX_RESPONSE_BYTES:
            raise OwnerRemotePermissionError("remote-authority-response-too-large")
        try:
            result = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            raise OwnerRemotePermissionError("remote-authority-invalid-response") from None
        if not isinstance(result, dict) or result.get("ok") is not True or status != 200:
            code = result.get("error") if isinstance(result, dict) else None
            raise OwnerRemotePermissionError(
                code if isinstance(code, str) and len(code) < 120 else "remote-authority-denied",
                status if 400 <= status <= 599 else 503,
            )
        return result

    def read(self):
        device_id, token = self._identity()
        result = self._call(
            "GET", "/v3/owner/remote-authority?device_id=" + device_id, token
        )
        if result.get("device_id") != device_id:
            raise OwnerRemotePermissionError("remote-authority-device-mismatch")
        clients = result.get("clients")
        groups = result.get("grant_groups")
        if (not isinstance(clients, list) or not isinstance(groups, list)
                or len(clients) > 100 or len(groups) > 300):
            raise OwnerRemotePermissionError("remote-authority-invalid-response")
        # No raw OAuth tokens, contact details or mutable client input reach Surface JS.
        clean_clients = []
        for client in clients:
            if isinstance(client, dict) and isinstance(client.get("client_id"), str) and UUID.fullmatch(client["client_id"]):
                clean_clients.append({
                    "client_id": client["client_id"],
                    "client_name": str(client.get("client_name") or "ChatGPT / MCP")[:120],
                })
        clean_groups = []
        for group in groups:
            if not isinstance(group, dict):
                continue
            group_id, client_id = group.get("grant_group_id"), group.get("client_id")
            if not isinstance(group_id, str) or not UUID.fullmatch(group_id):
                continue
            if not isinstance(client_id, str) or not UUID.fullmatch(client_id):
                continue
            if group.get("device_id") != device_id:
                raise OwnerRemotePermissionError("remote-authority-device-mismatch")
            clean_groups.append({
                "grant_group_id": group_id,
                "client_id": client_id,
                "profile_key": str(group.get("profile_key") or "")[:80],
                "scope_kind": str(group.get("scope_kind") or "")[:30],
                "client_consent_active": group.get("client_consent_active") is True,
            })
        return {
            "schema": "ordax.owner-remote-permissions/1",
            "device_id": device_id,
            "clients": clean_clients,
            "grant_groups": clean_groups,
        }

    def configure(self, client_id: str, enabled: bool):
        if not isinstance(client_id, str) or not UUID.fullmatch(client_id) or type(enabled) is not bool:
            raise OwnerRemotePermissionError("remote-permission-invalid", 400)
        device_id, token = self._identity()
        before = self.read()
        if client_id not in {item["client_id"] for item in before["clients"]}:
            raise OwnerRemotePermissionError("oauth-client-consent-required", 403)
        existing = [
            group for group in before["grant_groups"]
            if group["client_id"] == client_id and group["profile_key"] == PROFILE
            and group["scope_kind"] == "device"
        ]
        if enabled and not any(group["client_consent_active"] for group in existing):
            self._call("POST", "/v3/owner/remote-grant-groups", token, {
                "client_id": client_id,
                "device_id": device_id,
                "profile_key": PROFILE,
                "space_id": None, "project_id": None, "valid_until": None,
            })
        if not enabled:
            for group in existing:
                self._call(
                    "DELETE",
                    "/v3/owner/remote-grant-groups/"
                    + quote(group["grant_group_id"], safe="")
                    + "?client_id=" + quote(client_id, safe=""),
                    token,
                )
        after = self.read()
        active = any(
            group["client_id"] == client_id
            and group["profile_key"] == PROFILE
            and group["scope_kind"] == "device"
            and group["client_consent_active"] for group in after["grant_groups"]
        )
        if active is not enabled:
            # Verify postcondition so a pending/rejected mutation never
            # looks like success in the Settings switch.
            raise OwnerRemotePermissionError("remote-permission-not-confirmed", 409)
        return after
