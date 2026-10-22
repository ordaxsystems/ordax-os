"""Device-local client for the OrdaX account gateway.

This adapter is provider-neutral and speaks only to the OrdaX HTTPS gateway.
Cookies stay in trusted Native memory; the kernel user keyring optionally
preserves them across Native Host restarts within one boot. The canonical Native
account vault can persist encrypted refresh credentials across a full reboot
only when unlocked with a strong local passphrase and revalidated by the HTTPS
gateway. Short PINs cannot enable this on copyable USB media without a separate
hardware-backed proof. Provider credentials never enter Surface JavaScript.

The former plaintext session file is cleanup-only, not session authority.
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

from native_account_hot_session import KernelSessionUnavailable, NativeKernelAccountSession
from native_account_vault import AccountVaultError, NativeAccountVault

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


SESSION_SCHEMA = "prototype-ordax.public-identity-session/1"


def verified_account_session_reply(
    reply: GatewayReply, *, allow_anonymous: bool = False
) -> dict:
    """Accept only a fresh canonical session proof from the HTTPS gateway.

    The USB/Native login must never treat POST 200/303 as authentication.
    No tokens, password or raw gateway errors enter the Surface response.
    """
    if reply.status != 200:
        raise NativeAccountGatewayError("account-session-not-verified", status=503)
    try:
        raw = json.loads(reply.body.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise NativeAccountGatewayError("account-session-invalid", status=503) from exc
    if not isinstance(raw, dict) or raw.get("$schema") != SESSION_SCHEMA:
        raise NativeAccountGatewayError("account-session-invalid", status=503)
    if (
        raw.get("authenticated") is True
        and raw.get("status") == "authenticated"
        and isinstance(raw.get("provider"), str)
        and bool(raw["provider"])
        and raw["provider"] not in ("unconfigured", "gated")
    ):
        subject = raw.get("subject")
        email = raw.get("email")
        if not isinstance(subject, str) or not subject or not isinstance(email, str) or not email:
            raise NativeAccountGatewayError("account-session-invalid", status=503)
        return {
            "$schema": SESSION_SCHEMA,
            "authenticated": True,
            "status": "authenticated",
            "subject": subject,
            "email": email,
            "provider": raw.get("provider") if isinstance(raw.get("provider"), str) else "unconfigured",
            **({"displayName": raw["displayName"].strip()}
               if isinstance(raw.get("displayName"), str)
               and 0 < len(raw["displayName"].strip()) <= 120
               and not any(ord(character) < 32 or ord(character) == 127 for character in raw["displayName"])
               else {}),
            "accountCloseEnabled": raw.get("accountCloseEnabled") is True,
        }
    if allow_anonymous and raw.get("authenticated") is False and raw.get("status") == "anonymous":
        return {
            "$schema": SESSION_SCHEMA,
            "authenticated": False,
            "status": "anonymous",
            "provider": raw.get("provider") if isinstance(raw.get("provider"), str) else "unconfigured",
            "accountCloseEnabled": False,
        }
    raise NativeAccountGatewayError("account-session-not-verified", status=503)


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
        hot_session_store=None,
        vault_path: str | None = None,
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
        self._vault = NativeAccountVault(vault_path, self.base_url) if vault_path else None
        self._vault_confirmed = False
        self._hot_session_store = hot_session_store
        if self._hot_session_store is None:
            try:
                self._hot_session_store = NativeKernelAccountSession(self.base_url)
            except (KernelSessionUnavailable, OSError):
                self._hot_session_store = None
        if self._hot_session_store is not None:
            try:
                self._cookies = self._hot_session_store.load()
            except (KernelSessionUnavailable, OSError, ValueError):
                # Unsupported kernels remain memory-only; never fall back to USB files.
                self._cookies = {}

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
            self._sync_hot_session()
            if self._vault_confirmed and self._vault is not None:
                try:
                    self._vault.save(self._cookies)
                except (AccountVaultError, OSError, ValueError):
                    # Network session remains usable; no unencrypted fallback.
                    self._vault.lock()

        return GatewayReply(status=status, headers=response_headers, body=raw)

    def _sync_hot_session(self) -> None:
        if self._hot_session_store is None:
            return
        try:
            self._hot_session_store.save(self._cookies)
        except (KernelSessionUnavailable, OSError):
            # Native login must continue even when kernel keyrings are disabled.
            pass

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

    def unlock_local_session(self, secret: str) -> None:
        """Called ONLY after the Native Host verified its existing local credential."""
        with self._lock:
            if self._vault is None:
                return
            try:
                restored = self._vault.unlock(secret)
            except (AccountVaultError, OSError, ValueError):
                # Corrupt/invalid vault cannot authenticate. Clear only a safe
                # file; the next cloud login may create a new encrypted vault.
                try:
                    self._vault.clear()
                    restored = self._vault.unlock(secret)
                except (AccountVaultError, OSError, ValueError):
                    self._vault.lock()
                    return
            if restored and not self._cookies:
                self._cookies = restored
                self._sync_hot_session()
            elif self._vault_confirmed:
                try:
                    self._vault.save(self._cookies)
                except (AccountVaultError, OSError, ValueError):
                    self._vault.lock()

    def lock_local_session(self) -> None:
        with self._lock:
            if self._vault is not None:
                self._vault.lock()

    def clear_local_session_vault(self) -> None:
        with self._lock:
            if self._vault is not None:
                self._vault.clear()

    def session(self) -> GatewayReply:
        with self._lock:
            reply = self._request("GET", "/auth/session")
            if self._vault is not None and reply.status == 200:
                try:
                    proof = verified_account_session_reply(reply, allow_anonymous=True)
                except NativeAccountGatewayError:
                    return reply
                if proof["authenticated"]:
                    self._vault_confirmed = True
                    try:
                        self._vault.save(self._cookies)
                    except (AccountVaultError, OSError, ValueError):
                        self._vault.lock()
                elif proof.get("provider") not in ("unconfigured", "gated"):
                    self._vault_confirmed = False
                    try:
                        self._vault.clear()
                    except (AccountVaultError, OSError, ValueError):
                        pass
            return reply

    def login(self, email: str, password: str) -> GatewayReply:
        with self._lock:
            self._vault_confirmed = False
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
            self._vault_confirmed = False
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

    def _erase_local_account_session(self) -> None:
        """One Native-only teardown for logout and confirmed account closure."""
        self._cookies = {}
        self._vault_confirmed = False
        try:
            self._sync_hot_session()
        finally:
            if self._vault is not None:
                self._vault.clear()

    def logout(self) -> GatewayReply:
        with self._lock:
            try:
                return self._request("POST", "/auth/logout", body=b"", content_type="application/json")
            finally:
                # Local logout always completes; remote revocation is only
                # confirmed when the Gateway accepts the online request.
                self._erase_local_account_session()

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
            reply = self._request(
                "POST",
                "/account/close",
                body=payload,
                content_type="application/x-www-form-urlencoded",
            )
            if reply.status == 200:
                try:
                    closed = json.loads(reply.body.decode("utf-8")).get("closed") is True
                except (UnicodeError, ValueError, AttributeError):
                    closed = False
                if closed:
                    self._erase_local_account_session()
            return reply

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
