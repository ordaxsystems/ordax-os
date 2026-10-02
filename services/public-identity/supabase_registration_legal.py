from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import UUID

MAX_RESPONSE_BYTES = 64 * 1024
MAX_EMAIL_CHARS = 320


class RegistrationLegalError(RuntimeError):
    pass


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
            raise RegistrationLegalError("registration-legal-authority-unreachable") from exc
        if len(payload) > MAX_RESPONSE_BYTES:
            raise RegistrationLegalError("registration-legal-authority-response-too-large")
        return status, payload


@dataclass(frozen=True)
class RegistrationLegalIntent:
    intent_id: str


def _base_url(value: str) -> str:
    split = urlsplit(value.strip())
    if (
        split.scheme != "https"
        or not split.netloc
        or split.username
        or split.password
        or split.query
        or split.fragment
    ):
        raise ValueError("Supabase project URL must be clean HTTPS")
    return f"https://{split.netloc}"


def _secret_key(value: str) -> str:
    key = value.strip()
    if not key or len(key) > 4096 or any(ch.isspace() for ch in key):
        raise ValueError("Supabase secret key is invalid")
    return key


def _email(value: str) -> str:
    email = value.strip().lower()
    if not email or len(email) > MAX_EMAIL_CHARS or "\x00" in email:
        raise ValueError("Email is invalid")
    return email


class SupabaseRegistrationLegalAuthority:
    def __init__(
        self,
        project_url: str,
        secret_key: str,
        *,
        transport: Transport | None = None,
    ) -> None:
        self.project_url = _base_url(project_url)
        self.secret_key = _secret_key(secret_key)
        self.transport = transport or UrllibTransport()

    def begin_intent(self, email: str) -> RegistrationLegalIntent:
        payload = json.dumps(
            {"p_normalized_email": _email(email), "p_accepted": True},
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
        status, raw = self.transport.request(
            "POST",
            self.project_url + "/rest/v1/rpc/ordax_begin_account_registration_legal_intent_v1",
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "apikey": self.secret_key,
            },
            payload,
        )
        if status < 200 or status >= 300:
            raise RegistrationLegalError("registration-legal-policy-unavailable")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RegistrationLegalError("registration-legal-authority-invalid-response") from exc
        if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
            raise RegistrationLegalError("registration-legal-authority-invalid-response")
        intent_id = value[0].get("intent_id")
        if not isinstance(intent_id, str):
            raise RegistrationLegalError("registration-legal-authority-invalid-response")
        try:
            parsed = UUID(intent_id)
        except ValueError as exc:
            raise RegistrationLegalError("registration-legal-authority-invalid-response") from exc
        if str(parsed) != intent_id.lower():
            raise RegistrationLegalError("registration-legal-authority-invalid-response")
        return RegistrationLegalIntent(intent_id=intent_id.lower())
