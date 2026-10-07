"""Supabase Auth email/password adapter for the OrdaX identity service.

This module owns provider-specific HTTP only. It deliberately does not own
public routes, UI, cookies, entitlement policy, or account semantics. The
adapter accepts only a Supabase publishable key; service-role/secret keys are
not valid client configuration here.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Mapping, Protocol
from uuid import UUID
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

MAX_RESPONSE_BYTES = 1024 * 1024
MAX_PASSWORD_CHARS = 1024
MIN_REGISTRATION_PASSWORD_CHARS = 12
MAX_REGISTRATION_PASSWORD_CHARS = 256
MAX_EMAIL_CHARS = 320


class SupabaseIdentityError(RuntimeError):
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
    def request(
        self,
        method: str,
        url: str,
        headers: Mapping[str, str],
        body: bytes | None,
    ) -> tuple[int, bytes]:
        request = Request(url, data=body, headers=dict(headers), method=method)
        try:
            with urlopen(request, timeout=15) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
                status = int(response.status)
        except HTTPError as exc:
            payload = exc.read(MAX_RESPONSE_BYTES + 1)
            status = int(exc.code)
        except (URLError, OSError) as exc:
            raise SupabaseIdentityError("provider-unreachable") from exc
        if len(payload) > MAX_RESPONSE_BYTES:
            raise SupabaseIdentityError("provider-response-too-large", status=status)
        return status, payload


@dataclass(frozen=True)
class SessionTokens:
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str


@dataclass(frozen=True)
class AuthResult:
    subject_id: str
    email: str
    session: SessionTokens | None
    email_confirmation_required: bool


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
        raise ValueError("Supabase identity adapter requires an sb_publishable_ key")
    if len(value) < len("sb_publishable_") + 8 or len(value) > 512:
        raise ValueError("Supabase publishable key length is invalid")
    return value


def _email(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("Email must be a string")
    normalized = value.strip()
    if (
        len(normalized) < 3
        or len(normalized) > MAX_EMAIL_CHARS
        or "@" not in normalized
        or "\n" in normalized
        or "\r" in normalized
    ):
        raise ValueError("Email is invalid")
    return normalized


def _recovery_redirect(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("Recovery redirect must be a string")
    split = urlsplit(value.strip())
    if (
        split.scheme != "https"
        or not split.netloc
        or split.username is not None
        or split.password is not None
        or split.query
        or split.fragment
    ):
        raise ValueError("Recovery redirect must be a clean HTTPS URL")
    path = split.path or "/"
    return f"https://{split.netloc}{path}"


def _new_password(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("Password must be a string")
    if (
        len(value) < MIN_REGISTRATION_PASSWORD_CHARS
        or len(value) > MAX_REGISTRATION_PASSWORD_CHARS
        or "\x00" in value
    ):
        raise ValueError("New password does not meet OrdaX policy")
    return value


def _credentials(
    email: str,
    password: str,
    *,
    registration: bool = False,
) -> tuple[str, str]:
    if not isinstance(password, str):
        raise TypeError("Password must be a string")
    normalized = _email(email)
    if not password or len(password) > MAX_PASSWORD_CHARS:
        raise ValueError("Password is invalid")
    if "\x00" in password:
        raise ValueError("Password is invalid")
    if registration:
        _new_password(password)
    return normalized, password


def _json_object(payload: bytes, *, status: int) -> dict:
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise SupabaseIdentityError("provider-invalid-response", status=status) from exc
    if not isinstance(value, dict):
        raise SupabaseIdentityError("provider-invalid-response", status=status)
    return value


def _provider_error(value: dict, status: int) -> SupabaseIdentityError:
    provider_code = value.get("error_code") or value.get("code")
    if isinstance(provider_code, str) and provider_code:
        code = f"provider-{provider_code}"
    else:
        code = "provider-auth-failed"
    return SupabaseIdentityError(code, status=status)


def _session(value: dict) -> SessionTokens | None:
    access = value.get("access_token")
    refresh = value.get("refresh_token")
    if access is None and refresh is None:
        return None
    expires = value.get("expires_in")
    token_type = value.get("token_type")
    if (
        not isinstance(access, str)
        or not access
        or not isinstance(refresh, str)
        or not refresh
        or isinstance(expires, bool)
        or not isinstance(expires, int)
        or expires <= 0
        or not isinstance(token_type, str)
        or not token_type
    ):
        raise SupabaseIdentityError("provider-invalid-session")
    return SessionTokens(access, refresh, expires, token_type)


def _user_identity(value: object) -> tuple[str, str]:
    if not isinstance(value, dict):
        raise SupabaseIdentityError("provider-user-missing")
    subject = value.get("id")
    email = value.get("email")
    if not isinstance(subject, str) or not subject:
        raise SupabaseIdentityError("provider-user-invalid")
    if not isinstance(email, str) or not email:
        raise SupabaseIdentityError("provider-user-invalid")
    return subject, email


class SupabasePasswordProvider:
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

    def _request(
        self,
        method: str,
        path: str,
        payload: dict | None = None,
        *,
        access_token: str | None = None,
    ) -> dict:
        body = None if payload is None else json.dumps(
            payload, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "apikey": self.publishable_key,
        }
        if body is not None:
            headers["Content-Type"] = "application/json"
        if access_token is not None:
            if not isinstance(access_token, str) or not access_token:
                raise ValueError("Access token is invalid")
            headers["Authorization"] = f"Bearer {access_token}"
        status, raw = self.transport.request(
            method,
            self.project_url + path,
            headers,
            body,
        )
        value = _json_object(raw, status=status)
        if status < 200 or status >= 300:
            raise _provider_error(value, status)
        return value

    def sign_in_with_password(self, email: str, password: str) -> AuthResult:
        email, password = _credentials(email, password)
        value = self._request(
            "POST",
            "/auth/v1/token?grant_type=password",
            {"email": email, "password": password},
        )
        subject, canonical_email = _user_identity(value.get("user"))
        session = _session(value)
        if session is None:
            raise SupabaseIdentityError("provider-session-missing")
        return AuthResult(subject, canonical_email, session, False)

    def sign_up_with_password(
        self,
        email: str,
        password: str,
        *,
        registration_intent_id: str | None = None,
    ) -> AuthResult:
        email, password = _credentials(email, password, registration=True)
        payload: dict[str, object] = {"email": email, "password": password}
        if registration_intent_id is not None:
            if not isinstance(registration_intent_id, str):
                raise TypeError("Registration intent id must be a string")
            try:
                parsed_intent = UUID(registration_intent_id)
            except ValueError as exc:
                raise ValueError("Registration intent id is invalid") from exc
            canonical_intent = str(parsed_intent)
            if canonical_intent != registration_intent_id.lower():
                raise ValueError("Registration intent id is invalid")
            payload["data"] = {"ordax_registration_intent_id": canonical_intent}
        value = self._request(
            "POST",
            "/auth/v1/signup",
            payload,
        )
        subject, canonical_email = _user_identity(value.get("user"))
        session = _session(value)
        return AuthResult(
            subject,
            canonical_email,
            session,
            email_confirmation_required=session is None,
        )

    def request_password_recovery(self, email: str, redirect_to: str) -> None:
        normalized_email = _email(email)
        redirect = _recovery_redirect(redirect_to)
        query = urlencode({"redirect_to": redirect})
        self._request(
            "POST",
            f"/auth/v1/recover?{query}",
            {"email": normalized_email},
        )

    def verify_recovery_token(self, token_hash: str) -> SessionTokens:
        if (
            not isinstance(token_hash, str)
            or len(token_hash) < 16
            or len(token_hash) > 2048
            or any(ch.isspace() for ch in token_hash)
        ):
            raise ValueError("Recovery token hash is invalid")
        value = self._request(
            "POST",
            "/auth/v1/verify",
            {"token_hash": token_hash, "type": "recovery"},
        )
        session = _session(value)
        if session is None:
            raise SupabaseIdentityError("provider-session-missing")
        return session

    def update_password(self, access_token: str, new_password: str) -> None:
        password = _new_password(new_password)
        self._request(
            "PUT",
            "/auth/v1/user",
            {"password": password},
            access_token=access_token,
        )

    def refresh_session(self, refresh_token: str) -> SessionTokens:
        if not isinstance(refresh_token, str) or not refresh_token:
            raise ValueError("Refresh token is invalid")
        value = self._request(
            "POST",
            "/auth/v1/token?grant_type=refresh_token",
            {"refresh_token": refresh_token},
        )
        session = _session(value)
        if session is None:
            raise SupabaseIdentityError("provider-session-missing")
        return session

    def get_user(self, access_token: str) -> tuple[str, str]:
        value = self._request(
            "GET",
            "/auth/v1/user",
            access_token=access_token,
        )
        return _user_identity(value)

    def sign_out(self, access_token: str) -> None:
        self._request(
            "POST",
            "/auth/v1/logout",
            {},
            access_token=access_token,
        )

    def sign_out_local(self, access_token: str) -> None:
        self._request(
            "POST",
            "/auth/v1/logout?scope=local",
            {},
            access_token=access_token,
        )
