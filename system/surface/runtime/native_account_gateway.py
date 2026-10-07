"""Device-local client for the OrdaX account gateway.

This adapter is intentionally provider-neutral. It speaks only to the OrdaX
same-origin gateway protocol over HTTPS and stores the resulting OrdaX session
cookies as device-bound credentials. Those cookies never enter Surface JS and
must never be synchronized.
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
MAX_SESSION_BYTES = 32 * 1024
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
        or split.path not in ("", "/")
    ):
        raise ValueError("account gateway must be a clean HTTPS public origin")
    return f"https://{split.netloc}"


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


class NativeAccountGateway:
    def __init__(
        self,
        origin: str,
        session_path: str,
        *,
        timeout_seconds: float = 15.0,
    ) -> None:
        self.base_url = _validated_base_url(origin)
        if not os.path.isabs(session_path):
            raise ValueError("session path must be absolute")
        self.session_path = session_path
        self.timeout_seconds = timeout_seconds
        self._lock = threading.Lock()
        self._opener = build_opener(_NoRedirect())
        self._cookies = self._load_session()

    @property
    def configured(self) -> bool:
        return True

    def _load_session(self) -> dict[str, str]:
        try:
            st = os.stat(self.session_path, follow_symlinks=False)
            if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_SESSION_BYTES:
                return {}
            if st.st_mode & 0o077:
                return {}
            with open(self.session_path, "r", encoding="utf-8") as handle:
                value = json.load(handle)
        except (FileNotFoundError, OSError, UnicodeError, json.JSONDecodeError):
            return {}
        if not isinstance(value, dict) or set(value) - COOKIE_NAMES:
            return {}
        result: dict[str, str] = {}
        for name, cookie_value in value.items():
            if isinstance(cookie_value, str) and COOKIE_VALUE_RE.fullmatch(cookie_value):
                result[name] = cookie_value
        return result

    def _persist_session(self) -> None:
        directory = os.path.dirname(self.session_path)
        os.makedirs(directory, mode=0o700, exist_ok=True)
        temporary = f"{self.session_path}.tmp.{os.getpid()}.{threading.get_ident()}"
        try:
            flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            descriptor = os.open(temporary, flags, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(self._cookies, handle, separators=(",", ":"), sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.session_path)
            os.chmod(self.session_path, 0o600)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

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
        if method in {"POST", "PUT", "PATCH", "DELETE"}:
            headers["Origin"] = self.base_url
            headers["Sec-Fetch-Site"] = "same-origin"
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
            self._persist_session()

        return GatewayReply(status=status, headers=response_headers, body=raw)

    def session(self) -> GatewayReply:
        with self._lock:
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
            reply = self._request("POST", "/auth/logout", body=b"", content_type="application/json")
            self._cookies = {}
            self._persist_session()
            return reply

    def account_export(self) -> GatewayReply:
        with self._lock:
            return self._request("GET", "/account/export")

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
