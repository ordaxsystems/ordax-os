"""Device-local client for the OrdaX account gateway.

This adapter is intentionally provider-neutral. It speaks only to the OrdaX
same-origin gateway protocol over HTTPS. Account access/refresh cookies live only
in this Native Host process: they never enter Surface JS, are never synchronized,
and are never persisted to removable-media storage in plaintext.

A legacy session path is accepted only so older plaintext session files can be
removed during startup. Persistent account sessions require a future encrypted
vault explicitly bound to device-local unlock; file permissions alone are not a
credential-at-rest boundary for removable USB media.
"""

from __future__ import annotations

import json
import os
import re
import stat
import threading
from dataclasses import dataclass
from http.cookies import SimpleCookie
from typing import Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
COOKIE_NAMES = frozenset(("ordax_access", "ordax_refresh"))
COOKIE_VALUE_RE = re.compile(r"^[^;\r\n]{1,16384}$")


class NativeAccountGatewayError(RuntimeError):
    def __init__(self, code: str, *, status: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        del req, fp, code, msg, headers, newurl
        return None


@dataclass(frozen=True)
class GatewayReply:
    status: int
    headers: Mapping[str, tuple[str, ...]]
    body: bytes


def _validated_base_url(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("account gateway base URL must be a string")
    split = urlsplit(value.strip())
    if (
        split.scheme != "https"
        or not split.netloc
        or split.username is not None
        or split.password is not None
        or split.query
        or split.fragment
        or split.path.endswith("/")
    ):
        raise ValueError("account gateway must be an HTTPS base URL without query, fragment or trailing slash")
    return f"https://{split.netloc}{split.path}"


def _response_headers(message) -> dict[str, tuple[str, ...]]:
    result: dict[str, tuple[str, ...]] = {}
    for key in message.keys():
        values = tuple(message.get_all(key) or ())
        result[key.lower()] = values
    return result


def _cookie_header(cookies: Mapping[str, str]) -> str:
    return "; ".join(f"{name}={cookies[name]}" for name in sorted(cookies))


def _parse_set_cookies(values: tuple[str, ...], existing: Mapping[str, str]) -> dict[str, str]:
    next_cookies = dict(existing)
    for raw in values:
        parsed = SimpleCookie()
        try:
            parsed.load(raw)
        except Exception:
            continue
        for name in COOKIE_NAMES:
            morsel = parsed.get(name)
            if morsel is None:
                continue
            max_age = morsel["max-age"]
            if max_age == "0" or not morsel.value:
                next_cookies.pop(name, None)
                continue
            if not COOKIE_VALUE_RE.fullmatch(morsel.value):
                raise NativeAccountGatewayError("invalid-session-cookie")
            next_cookies[name] = morsel.value
    return next_cookies


def _purge_legacy_plaintext_session(path: str) -> None:
    """Remove the former plaintext cookie file without following filesystem links.

    Refusing to continue when a credential-bearing entry cannot be removed is
    deliberate: silently leaving a previously valid refresh token on removable
    media would preserve the exposure this hardening is intended to eliminate.
    Directories are not legacy credential files and are left untouched.
    """
    try:
        existing = os.lstat(path)
    except FileNotFoundError:
        return
    except OSError as exc:
        raise NativeAccountGatewayError("legacy-session-inspection-failed") from exc

    if stat.S_ISDIR(existing.st_mode):
        return

    try:
        os.unlink(path)
    except FileNotFoundError:
        return
    except OSError as exc:
        raise NativeAccountGatewayError("legacy-session-purge-failed") from exc


class NativeAccountGateway:
    def __init__(
        self,
        origin: str,
        legacy_session_path: str,
        *,
        timeout_seconds: float = 15.0,
    ) -> None:
        self.base_url = _validated_base_url(origin)
        if not os.path.isabs(legacy_session_path):
            raise ValueError("legacy session path must be absolute")
        self.legacy_session_path = legacy_session_path
        self.timeout_seconds = timeout_seconds
        self._lock = threading.Lock()
        self._opener = build_opener(_NoRedirect())
        _purge_legacy_plaintext_session(self.legacy_session_path)
        self._cookies: dict[str, str] = {}
        # Only a completed local detach may establish session absence offline.
        self._locally_detached = False

    @property
    def configured(self) -> bool:
        return True

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: bytes | None = None,
        content_type: str | None = None,
    ) -> GatewayReply:
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError("gateway path must be same-origin")
        headers = {
            "Accept": "application/json",
            "User-Agent": "OrdaX-Native-Account/1",
        }
        if self._cookies:
            headers["Cookie"] = _cookie_header(self._cookies)
        if body is not None:
            headers["Content-Type"] = content_type or "application/octet-stream"
        request = Request(self.base_url + path, data=body, headers=headers, method=method)
        try:
            response = self._opener.open(request, timeout=self.timeout_seconds)
            try:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
                status = int(response.status)
                response_headers = _response_headers(response.headers)
            finally:
                response.close()
        except HTTPError as exc:
            raw = exc.read(MAX_RESPONSE_BYTES + 1)
            status = int(exc.code)
            response_headers = _response_headers(exc.headers)
        except (URLError, OSError) as exc:
            raise NativeAccountGatewayError("gateway-unreachable") from exc

        if len(raw) > MAX_RESPONSE_BYTES:
            raise NativeAccountGatewayError("gateway-response-too-large", status=status)

        set_cookies = response_headers.get("set-cookie", ())
        if set_cookies:
            self._cookies = _parse_set_cookies(set_cookies, self._cookies)

        return GatewayReply(status=status, headers=response_headers, body=raw)

    def _product_access_token(self) -> str:
        """Return the Native-only account access token to trusted runtime code.

        This is deliberately private: Surface JS and public host routes must not
        receive account bearer material. Product device enrollment may borrow it
        only long enough to authenticate the canonical Control Plane request.
        """
        with self._lock:
            token = self._cookies.get("ordax_access", "")
            if not token or not COOKIE_VALUE_RE.fullmatch(token):
                raise NativeAccountGatewayError("authentication-required", status=401)
            return token

    def session(self) -> GatewayReply:
        with self._lock:
            if self._locally_detached and not self._cookies:
                return GatewayReply(
                    status=200,
                    headers={},
                    body=json.dumps({
                        "$schema": "prototype-ordax.public-identity-session/1",
                        "authenticated": False,
                        "provider": "ordax-native",
                        "status": "anonymous",
                    }).encode("utf-8"),
                )
            return self._request("GET", "/auth/session")

    def login(self, email: str, password: str) -> GatewayReply:
        with self._lock:
            payload = urlencode({"email": email, "password": password}).encode("utf-8")
            return self._request(
                "POST",
                "/auth/login",
                body=payload,
                content_type="application/x-www-form-urlencoded",
            )

    def registration_policy(self) -> GatewayReply:
        with self._lock:
            return self._request("GET", "/auth/registration-policy")

    def register(self, email: str, password: str, *, legal_accepted: bool) -> GatewayReply:
        if legal_accepted is not True:
            raise NativeAccountGatewayError("legal-acceptance-required")
        with self._lock:
            payload = urlencode({
                "email": email,
                "password": password,
                "legal_acceptance": "accepted",
            }).encode("utf-8")
            return self._request(
                "POST",
                "/auth/register",
                body=payload,
                content_type="application/x-www-form-urlencoded",
            )

    def logout(self) -> GatewayReply:
        with self._lock:
            if not self._cookies:
                self._locally_detached = True
                return GatewayReply(status=204, headers={}, body=b"")
            try:
                try:
                    reply = self._request(
                        "POST", "/auth/logout", body=b"", content_type="application/json"
                    )
                except NativeAccountGatewayError:
                    return GatewayReply(status=202, headers={}, body=b"")
                if reply.status not in (200, 204, 303):
                    # Remote revocation was not confirmed, but this USB's
                    # bearer credentials are detached regardless of HTTP status.
                    return GatewayReply(status=202, headers={}, body=b"")
                return reply
            finally:
                self._cookies.clear()
                self._locally_detached = True

    def account_export(self) -> GatewayReply:
        with self._lock:
            return self._request("GET", "/account/export")

    def close_account(self, password: str, confirmation: str) -> GatewayReply:
        if (
            not isinstance(password, str)
            or not password
            or len(password) > 1024
            or "\x00" in password
        ):
            raise NativeAccountGatewayError("invalid-account-close-password")
        if confirmation != "close-account":
            raise NativeAccountGatewayError("account-close-confirmation-required")
        with self._lock:
            payload = urlencode({
                "password": password,
                "confirmation": confirmation,
            }).encode("utf-8")
            return self._request(
                "POST",
                "/account/close",
                body=payload,
                content_type="application/x-www-form-urlencoded",
            )

    def spaces(self) -> GatewayReply:
        with self._lock:
            return self._request("GET", "/account/spaces")

    def memory_cloud_entitlement(self) -> GatewayReply:
        with self._lock:
            return self._request("GET", "/account/entitlements/memory-cloud")

    def send_network_message(self, body: bytes) -> GatewayReply:
        if not isinstance(body, bytes) or not body:
            raise TypeError("Network message request body must be non-empty bytes")
        with self._lock:
            return self._request(
                "POST",
                "/network/v2/messages/send",
                body=body,
                content_type="application/json",
            )

    def list_sync_objects(self, query: str = "") -> GatewayReply:
        suffix = f"?{query}" if query else ""
        with self._lock:
            return self._request("GET", "/sync/objects" + suffix)

    def sync_snapshot(self, query: str = "") -> GatewayReply:
        suffix = f"?{query}" if query else ""
        with self._lock:
            return self._request("GET", "/sync/snapshot" + suffix)

    def pull_sync_changes(self, query: str = "") -> GatewayReply:
        suffix = f"?{query}" if query else ""
        with self._lock:
            return self._request("GET", "/sync/changes" + suffix)

    def mutate_sync(self, body: bytes) -> GatewayReply:
        with self._lock:
            return self._request(
                "POST",
                "/sync/mutate",
                body=body,
                content_type="application/json",
            )
