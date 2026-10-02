from __future__ import annotations

from dataclasses import dataclass
import re
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


@dataclass(frozen=True)
class RegistrationLegalPolicy:
    policy_id: str
    privacy_version: str
    privacy_effective_date: str
    privacy_sha256: str
    privacy_url: str
    terms_version: str
    terms_effective_date: str
    terms_sha256: str
    terms_url: str


_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _document_url(value: object) -> str:
    if not isinstance(value, str):
        raise RegistrationLegalError("registration-legal-authority-invalid-response")
    split = urlsplit(value.strip())
    if (
        split.scheme != "https"
        or not split.netloc
        or split.username is not None
        or split.password is not None
        or split.query
        or split.fragment
    ):
        raise RegistrationLegalError("registration-legal-authority-invalid-response")
    return value.strip()


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

    def active_policy(self) -> RegistrationLegalPolicy:
        status, raw = self.transport.request(
            "POST",
            self.project_url + "/rest/v1/rpc/ordax_get_account_registration_legal_policy_v1",
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "apikey": self.secret_key,
            },
            b"{}",
        )
        if status < 200 or status >= 300:
            raise RegistrationLegalError("registration-legal-policy-unavailable")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RegistrationLegalError("registration-legal-authority-invalid-response") from exc
        if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
            raise RegistrationLegalError("registration-legal-policy-unavailable")
        item = value[0]
        policy_id = item.get("policy_id")
        try:
            parsed = UUID(policy_id) if isinstance(policy_id, str) else None
        except ValueError as exc:
            raise RegistrationLegalError("registration-legal-authority-invalid-response") from exc
        if parsed is None or str(parsed) != policy_id.lower():
            raise RegistrationLegalError("registration-legal-authority-invalid-response")
        fields = {
            "privacy_version": item.get("privacy_version"),
            "privacy_effective_date": item.get("privacy_effective_date"),
            "privacy_sha256": item.get("privacy_sha256"),
            "terms_version": item.get("terms_version"),
            "terms_effective_date": item.get("terms_effective_date"),
            "terms_sha256": item.get("terms_sha256"),
        }
        if (
            not isinstance(fields["privacy_version"], str)
            or _VERSION_RE.fullmatch(fields["privacy_version"]) is None
            or not isinstance(fields["terms_version"], str)
            or _VERSION_RE.fullmatch(fields["terms_version"]) is None
            or not isinstance(fields["privacy_effective_date"], str)
            or _DATE_RE.fullmatch(fields["privacy_effective_date"]) is None
            or not isinstance(fields["terms_effective_date"], str)
            or _DATE_RE.fullmatch(fields["terms_effective_date"]) is None
            or not isinstance(fields["privacy_sha256"], str)
            or _SHA256_RE.fullmatch(fields["privacy_sha256"]) is None
            or not isinstance(fields["terms_sha256"], str)
            or _SHA256_RE.fullmatch(fields["terms_sha256"]) is None
        ):
            raise RegistrationLegalError("registration-legal-authority-invalid-response")
        return RegistrationLegalPolicy(
            policy_id=policy_id.lower(),
            privacy_version=fields["privacy_version"],
            privacy_effective_date=fields["privacy_effective_date"],
            privacy_sha256=fields["privacy_sha256"],
            privacy_url=_document_url(item.get("privacy_url")),
            terms_version=fields["terms_version"],
            terms_effective_date=fields["terms_effective_date"],
            terms_sha256=fields["terms_sha256"],
            terms_url=_document_url(item.get("terms_url")),
        )

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
