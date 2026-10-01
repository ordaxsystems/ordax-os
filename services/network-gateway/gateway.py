"""Provider-neutral OrdaX Network v2 message gateway.

This module owns the HTTP boundary only. It has no Supabase credential, no
database connection and no public listener. Authentication is supplied by a
server-side session resolver and the provider-specific authority receives only
an opaque, non-serializable authority context.

The default configuration is fail-closed and cannot send a message.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Mapping, Protocol
from urllib.parse import urlsplit

JSON_CONTENT_TYPE = "application/json; charset=utf-8"
NO_STORE = "no-store, max-age=0"
ERROR_SCHEMA = "prototype-ordax.network-gateway-error/1"
OUTCOME_SCHEMA = "prototype-ordax.network-mutation-outcome/2"
MAX_BODY_BYTES = 16 * 1024

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9._:-]{16,120}$")
MACHINE_CODE_RE = re.compile(r"^[a-z][a-z0-9-]{2,95}$")
RESOURCE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$")
UNSAFE_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
OUTCOMES = frozenset({"applied", "idempotent", "rate_limited", "denied", "invalid"})


@dataclass(frozen=True)
class GatewayResponse:
    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes


@dataclass(frozen=True)
class NetworkSession:
    authenticated: bool
    user_id: str | None = None
    authority_context: object | None = None


@dataclass(frozen=True)
class MutationOutcome:
    outcome: str
    code: str
    resource_id: str | None
    retry_after_seconds: int | None
    idempotency_key: str


class NetworkSessionResolver(Protocol):
    @property
    def configured(self) -> bool: ...

    def resolve(self, cookie_header: str | None) -> NetworkSession: ...


class NetworkAuthority(Protocol):
    @property
    def configured(self) -> bool: ...

    def send_message(
        self,
        *,
        session: NetworkSession,
        sender_space_id: str,
        conversation_id: str,
        idempotency_key: str,
        body: str,
    ) -> MutationOutcome: ...


class GatewayUnavailable(RuntimeError):
    pass


class AnonymousNetworkSessions:
    @property
    def configured(self) -> bool:
        return False

    def resolve(self, cookie_header: str | None) -> NetworkSession:
        del cookie_header
        return NetworkSession(authenticated=False)


class DisabledNetworkAuthority:
    @property
    def configured(self) -> bool:
        return False

    def send_message(self, **_: object) -> MutationOutcome:
        raise GatewayUnavailable("Network authority is not configured")


def _json_response(status: int, payload: Mapping[str, object]) -> GatewayResponse:
    body = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    return GatewayResponse(
        status=status,
        headers=(
            ("Content-Type", JSON_CONTENT_TYPE),
            ("Cache-Control", NO_STORE),
            ("Pragma", "no-cache"),
            ("X-Content-Type-Options", "nosniff"),
            ("Content-Length", str(len(body))),
        ),
        body=body,
    )


def _error(status: int, code: str, message: str) -> GatewayResponse:
    return _json_response(
        status,
        {"$schema": ERROR_SCHEMA, "error": code, "message": message},
    )


def _method_not_allowed(allowed: str) -> GatewayResponse:
    response = _error(405, "method-not-allowed", "Método não permitido.")
    return GatewayResponse(
        status=response.status,
        headers=response.headers + (("Allow", allowed),),
        body=response.body,
    )


def _uuid(value: object, label: str) -> str:
    if not isinstance(value, str) or not UUID_RE.fullmatch(value):
        raise ValueError(label)
    return value.lower()


def _plain_text(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("body")
    body = value.strip()
    if not 1 <= len(body) <= 4000 or UNSAFE_CONTROL_RE.search(body):
        raise ValueError("body")
    return body


def _cross_site_state_change(headers: Mapping[str, str]) -> bool:
    if headers.get("sec-fetch-site", "").lower() == "cross-site":
        return True
    forwarded_host = headers.get("x-forwarded-host", "").strip().lower()
    origin = headers.get("origin", "").strip()
    if not forwarded_host or not origin:
        return False
    split = urlsplit(origin)
    if split.scheme not in {"http", "https"} or not split.netloc:
        return True
    return split.netloc.lower() != forwarded_host


def _payload(raw: bytes | None) -> Mapping[str, object]:
    if raw is None or len(raw) == 0 or len(raw) > MAX_BODY_BYTES:
        raise ValueError("body")
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("body") from exc
    if not isinstance(value, dict):
        raise ValueError("body")
    if set(value) != {"space_id", "conversation_id", "idempotency_key", "body"}:
        raise ValueError("fields")
    return value


def _outcome_response(outcome: MutationOutcome, expected_key: str) -> GatewayResponse:
    if (
        not isinstance(outcome.outcome, str)
        or outcome.outcome not in OUTCOMES
        or not isinstance(outcome.code, str)
        or not MACHINE_CODE_RE.fullmatch(outcome.code)
        or outcome.idempotency_key != expected_key
    ):
        return _error(502, "invalid-network-outcome", "A autoridade Network retornou um resultado inválido.")

    success_like = outcome.outcome in {"applied", "idempotent"}
    resource_id = outcome.resource_id
    if success_like:
        if not isinstance(resource_id, str) or not RESOURCE_ID_RE.fullmatch(resource_id):
            return _error(502, "invalid-network-outcome", "A autoridade Network retornou um resultado inválido.")
    elif resource_id is not None:
        return _error(502, "invalid-network-outcome", "A autoridade Network retornou um resultado inválido.")

    retry = outcome.retry_after_seconds
    if outcome.outcome == "rate_limited":
        if not isinstance(retry, int) or isinstance(retry, bool) or not 1 <= retry <= 86400:
            return _error(502, "invalid-network-outcome", "A autoridade Network retornou um resultado inválido.")
    elif retry is not None:
        return _error(502, "invalid-network-outcome", "A autoridade Network retornou um resultado inválido.")

    # Semantic mutation rejection remains a successful HTTP exchange so clients
    # can consume the canonical v2 outcome instead of interpreting null/void or
    # transport errors as mutation success.
    return _json_response(
        200,
        {
            "schema": OUTCOME_SCHEMA,
            "outcome": outcome.outcome,
            "operation": "message-send",
            "code": outcome.code,
            "resource_id": resource_id,
            "retry_after_seconds": retry,
            "idempotency_key": outcome.idempotency_key,
        },
    )


class NetworkGatewayV2:
    def __init__(
        self,
        *,
        sessions: NetworkSessionResolver | None = None,
        authority: NetworkAuthority | None = None,
    ) -> None:
        self.sessions = sessions or AnonymousNetworkSessions()
        self.authority = authority or DisabledNetworkAuthority()

    def handle(
        self,
        method: str,
        target: str,
        headers: Mapping[str, str] | None = None,
        body: bytes | None = None,
    ) -> GatewayResponse:
        method = method.upper()
        request_headers = {key.lower(): value for key, value in (headers or {}).items()}
        path = urlsplit(target).path

        if path == "/network/v2/status":
            if method != "GET":
                return _method_not_allowed("GET")
            return _json_response(
                200,
                {
                    "$schema": "prototype-ordax.network-gateway-status/1",
                    "identity_configured": self.sessions.configured,
                    "authority_configured": self.authority.configured,
                    "message_send_enabled": self.sessions.configured and self.authority.configured,
                },
            )

        if path != "/network/v2/messages/send":
            if path.startswith("/network/"):
                return _error(404, "network-route-not-found", "Rota Network inexistente.")
            return _error(404, "not-found", "Recurso inexistente.")

        if method != "POST":
            return _method_not_allowed("POST")
        if _cross_site_state_change(request_headers):
            return _error(403, "cross-site-request-rejected", "A solicitação cross-site foi rejeitada.")
        if request_headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            return _error(415, "unsupported-media-type", "O corpo deve usar application/json.")

        session = self.sessions.resolve(request_headers.get("cookie"))
        if (
            not session.authenticated
            or session.user_id is None
            or session.authority_context is None
        ):
            return _error(401, "authentication-required", "Uma sessão OrdaX autenticada é necessária.")
        try:
            _uuid(session.user_id, "user_id")
            request = _payload(body)
            sender_space_id = _uuid(request["space_id"], "space_id")
            conversation_id = _uuid(request["conversation_id"], "conversation_id")
            idempotency_key = request["idempotency_key"]
            if not isinstance(idempotency_key, str) or not IDEMPOTENCY_RE.fullmatch(idempotency_key):
                raise ValueError("idempotency_key")
            message_body = _plain_text(request["body"])
        except ValueError:
            return _error(400, "invalid-network-request", "A solicitação Network é inválida.")

        if not self.authority.configured:
            return _error(503, "network-authority-unavailable", "O backend Network ainda não está ativado.")

        try:
            outcome = self.authority.send_message(
                session=session,
                sender_space_id=sender_space_id,
                conversation_id=conversation_id,
                idempotency_key=idempotency_key,
                body=message_body,
            )
        except GatewayUnavailable:
            return _error(503, "network-authority-unavailable", "O backend Network ainda não está ativado.")

        return _outcome_response(outcome, idempotency_key)


gateway = NetworkGatewayV2()


def application(environ, start_response):
    """Minimal WSGI adapter; deployment remains external to this module."""
    method = str(environ.get("REQUEST_METHOD", "GET"))
    path = str(environ.get("PATH_INFO", "/"))
    query = str(environ.get("QUERY_STRING", ""))
    target = path + (("?" + query) if query else "")

    headers: dict[str, str] = {}
    for key, value in environ.items():
        if key.startswith("HTTP_") and isinstance(value, str):
            headers[key[5:].replace("_", "-").lower()] = value
    content_type = environ.get("CONTENT_TYPE")
    if isinstance(content_type, str):
        headers["content-type"] = content_type

    raw_length = environ.get("CONTENT_LENGTH", "0")
    try:
        length = min(max(int(raw_length or 0), 0), MAX_BODY_BYTES + 1)
    except (TypeError, ValueError):
        length = 0
    stream = environ.get("wsgi.input")
    body = stream.read(length) if stream is not None and length else None

    response = gateway.handle(method, target, headers, body)
    reason = {
        200: "OK",
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        415: "Unsupported Media Type",
        502: "Bad Gateway",
        503: "Service Unavailable",
    }.get(response.status, "Error")
    start_response(f"{response.status} {reason}", list(response.headers))
    return [response.body]
