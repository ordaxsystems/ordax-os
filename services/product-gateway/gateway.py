"""Provider-neutral server-authoritative gateway for OrdaX product projects.

This core intentionally owns no Supabase/service-role credential and no public
listener. It validates the HTTP/product boundary first and delegates approved
operations to a server-side ProductAuthority adapter.

The default configuration is fail-closed: public product mutations remain
unavailable until identity hardening and a reviewed authority adapter are both
configured.
"""

from __future__ import annotations

import hmac
import json
import re
from dataclasses import dataclass
from typing import Mapping, Protocol
from urllib.parse import urlsplit

from services.product_core.session import ProductSession, SessionResolver

JSON_CONTENT_TYPE = "application/json; charset=utf-8"
NO_STORE = "no-store, max-age=0"
ERROR_SCHEMA = "prototype-ordax.product-gateway-error/1"
STATUS_SCHEMA = "prototype-ordax.product-gateway-status/1"
RECEIPT_SCHEMA = "prototype-ordax.product-mutation-receipt/1"

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
CAPABILITY_RE = re.compile(r"^[a-z][a-z0-9.-]{1,119}$")
OPAQUE_PROJECT_REF_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")

FORBIDDEN_CAPABILITIES = frozenset(
    {
        "generic-shell",
        "raw-disk",
        "release-signing-key",
        "implicit-admin",
        "cross-user-memory",
        "cross-space-memory",
        "unscoped-github-account",
    }
)
PROJECT_KINDS = frozenset(
    {"general", "development", "creative", "legal", "business", "research"}
)
CLIENT_KINDS = frozenset({"ordax-web", "ordax-mobile", "product-mcp"})
ACCESS_MODES = frozenset({"read", "write"})


@dataclass(frozen=True)
class GatewayResponse:
    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes


@dataclass(frozen=True)
class MutationReceipt:
    resource_type: str
    resource_id: str
    audit_id: str
    entitlements_checked: bool
    approval_checked: bool


class ProductAuthority(Protocol):
    @property
    def configured(self) -> bool: ...

    def create_project(
        self,
        *,
        user_id: str,
        space_id: str,
        name: str,
        kind: str,
        idempotency_key: str,
    ) -> MutationReceipt: ...

    def bind_project_device(
        self,
        *,
        user_id: str,
        project_id: str,
        device_id: str,
        local_project_ref: str,
        allowed_capabilities: tuple[str, ...],
        idempotency_key: str,
    ) -> MutationReceipt: ...

    def grant_remote_capability(
        self,
        *,
        user_id: str,
        space_id: str,
        project_id: str,
        device_id: str,
        client_kind: str,
        capability: str,
        access_mode: str,
        idempotency_key: str,
    ) -> MutationReceipt: ...


class GatewayUnavailable(RuntimeError):
    pass


class AnonymousSessionResolver:
    @property
    def configured(self) -> bool:
        return False

    def resolve(self, cookie_header: str | None) -> ProductSession:
        del cookie_header
        return ProductSession(authenticated=False)


class DisabledProductAuthority:
    @property
    def configured(self) -> bool:
        return False

    def _unavailable(self, **_: object) -> MutationReceipt:
        raise GatewayUnavailable("product authority is not configured")

    create_project = _unavailable
    bind_project_device = _unavailable
    grant_remote_capability = _unavailable


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


def _valid_uuid(value: object) -> str:
    if not isinstance(value, str) or not UUID_RE.fullmatch(value):
        raise ValueError("uuid")
    return value.lower()


def _bounded_text(value: object, *, minimum: int, maximum: int, field: str) -> str:
    if not isinstance(value, str):
        raise ValueError(field)
    normalized = value.strip()
    if not minimum <= len(normalized) <= maximum or any(ord(ch) < 32 for ch in normalized):
        raise ValueError(field)
    return normalized


def _parse_json(body: bytes | None) -> Mapping[str, object]:
    if body is None or len(body) == 0 or len(body) > 32_768:
        raise ValueError("body")
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("body") from exc
    if not isinstance(value, dict):
        raise ValueError("body")
    return value


def _receipt_response(receipt: MutationReceipt) -> GatewayResponse:
    if (
        not receipt.entitlements_checked
        or not receipt.approval_checked
        or not UUID_RE.fullmatch(receipt.resource_id)
        or not UUID_RE.fullmatch(receipt.audit_id)
    ):
        return _error(
            502,
            "invalid-authority-receipt",
            "A autoridade do produto retornou um recibo inválido.",
        )
    return _json_response(
        201,
        {
            "$schema": RECEIPT_SCHEMA,
            "resource_type": receipt.resource_type,
            "resource_id": receipt.resource_id,
            "audit_id": receipt.audit_id,
            "entitlements_checked": True,
            "approval_checked": True,
        },
    )


class ProductProjectGateway:
    def __init__(
        self,
        *,
        sessions: SessionResolver | None = None,
        authority: ProductAuthority | None = None,
    ) -> None:
        self.sessions = sessions or AnonymousSessionResolver()
        self.authority = authority or DisabledProductAuthority()

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

        if path == "/product/status":
            if method != "GET":
                return self._method_not_allowed("GET")
            return _json_response(
                200,
                {
                    "$schema": STATUS_SCHEMA,
                    "identity_configured": self.sessions.configured,
                    "authority_configured": self.authority.configured,
                    "mutations_enabled": self.sessions.configured and self.authority.configured,
                },
            )

        routes = {
            "/product/projects": self._create_project,
            "/product/project-bindings": self._bind_project_device,
            "/product/remote-grants": self._grant_remote_capability,
        }
        handler = routes.get(path)
        if handler is None:
            if path.startswith("/product/"):
                return _error(404, "product-route-not-found", "Rota de produto inexistente.")
            return _error(404, "not-found", "Recurso inexistente.")
        if method != "POST":
            return self._method_not_allowed("POST")

        if request_headers.get("sec-fetch-site") == "cross-site":
            return _error(403, "cross-site-request-rejected", "A solicitação cross-site foi rejeitada.")
        if request_headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
            return _error(415, "unsupported-media-type", "O corpo deve usar application/json.")

        session = self.sessions.resolve(request_headers.get("cookie"))
        if not session.authenticated or session.user_id is None:
            return _error(401, "authentication-required", "Uma sessão OrdaX autenticada é necessária.")
        try:
            user_id = _valid_uuid(session.user_id)
        except ValueError:
            return _error(500, "invalid-session", "A sessão OrdaX é inválida.")

        presented_csrf = request_headers.get("x-ordax-csrf")
        if (
            session.csrf_token is None
            or presented_csrf is None
            or not hmac.compare_digest(session.csrf_token, presented_csrf)
        ):
            return _error(403, "csrf-rejected", "A proteção CSRF rejeitou a solicitação.")

        idempotency_key = request_headers.get("idempotency-key", "")
        if not IDEMPOTENCY_RE.fullmatch(idempotency_key):
            return _error(400, "invalid-idempotency-key", "Uma chave de idempotência válida é obrigatória.")

        if not self.authority.configured:
            return _error(
                503,
                "product-authority-unavailable",
                "A autoridade server-side do produto ainda não está configurada.",
            )

        try:
            payload = _parse_json(body)
            receipt = handler(user_id, idempotency_key, payload)
        except ValueError:
            return _error(400, "invalid-request", "A solicitação de produto é inválida.")
        except GatewayUnavailable:
            return _error(
                503,
                "product-authority-unavailable",
                "A autoridade server-side do produto ainda não está configurada.",
            )
        return _receipt_response(receipt)

    def _create_project(
        self,
        user_id: str,
        idempotency_key: str,
        payload: Mapping[str, object],
    ) -> MutationReceipt:
        if set(payload) != {"space_id", "name", "kind"}:
            raise ValueError("fields")
        space_id = _valid_uuid(payload["space_id"])
        name = _bounded_text(payload["name"], minimum=1, maximum=120, field="name")
        kind = payload["kind"]
        if kind not in PROJECT_KINDS:
            raise ValueError("kind")
        return self.authority.create_project(
            user_id=user_id,
            space_id=space_id,
            name=name,
            kind=str(kind),
            idempotency_key=idempotency_key,
        )

    def _bind_project_device(
        self,
        user_id: str,
        idempotency_key: str,
        payload: Mapping[str, object],
    ) -> MutationReceipt:
        if set(payload) != {
            "project_id",
            "device_id",
            "local_project_ref",
            "allowed_capabilities",
        }:
            raise ValueError("fields")
        project_id = _valid_uuid(payload["project_id"])
        device_id = _valid_uuid(payload["device_id"])
        ref = payload["local_project_ref"]
        if not isinstance(ref, str) or not OPAQUE_PROJECT_REF_RE.fullmatch(ref) or ".." in ref:
            raise ValueError("local_project_ref")
        raw_capabilities = payload["allowed_capabilities"]
        if (
            not isinstance(raw_capabilities, list)
            or len(raw_capabilities) > 64
            or any(not isinstance(item, str) for item in raw_capabilities)
        ):
            raise ValueError("allowed_capabilities")
        capabilities = tuple(raw_capabilities)
        if len(set(capabilities)) != len(capabilities):
            raise ValueError("allowed_capabilities")
        for capability in capabilities:
            if not CAPABILITY_RE.fullmatch(capability) or capability in FORBIDDEN_CAPABILITIES:
                raise ValueError("allowed_capabilities")
        return self.authority.bind_project_device(
            user_id=user_id,
            project_id=project_id,
            device_id=device_id,
            local_project_ref=ref,
            allowed_capabilities=capabilities,
            idempotency_key=idempotency_key,
        )

    def _grant_remote_capability(
        self,
        user_id: str,
        idempotency_key: str,
        payload: Mapping[str, object],
    ) -> MutationReceipt:
        if set(payload) != {
            "space_id",
            "project_id",
            "device_id",
            "client_kind",
            "capability",
            "access_mode",
        }:
            raise ValueError("fields")
        space_id = _valid_uuid(payload["space_id"])
        project_id = _valid_uuid(payload["project_id"])
        device_id = _valid_uuid(payload["device_id"])
        client_kind = payload["client_kind"]
        capability = payload["capability"]
        access_mode = payload["access_mode"]
        if client_kind not in CLIENT_KINDS or access_mode not in ACCESS_MODES:
            raise ValueError("grant")
        if (
            not isinstance(capability, str)
            or not CAPABILITY_RE.fullmatch(capability)
            or capability in FORBIDDEN_CAPABILITIES
        ):
            raise ValueError("capability")
        return self.authority.grant_remote_capability(
            user_id=user_id,
            space_id=space_id,
            project_id=project_id,
            device_id=device_id,
            client_kind=str(client_kind),
            capability=capability,
            access_mode=str(access_mode),
            idempotency_key=idempotency_key,
        )

    @staticmethod
    def _method_not_allowed(allowed: str) -> GatewayResponse:
        response = _error(405, "method-not-allowed", "Método não permitido.")
        return GatewayResponse(
            status=response.status,
            headers=response.headers + (("Allow", allowed),),
            body=response.body,
        )


gateway = ProductProjectGateway()


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
        length = min(max(int(raw_length or 0), 0), 32_769)
    except (TypeError, ValueError):
        length = 0
    stream = environ.get("wsgi.input")
    body = stream.read(length) if stream is not None and length else None

    response = gateway.handle(method, target, headers, body)
    reason = {
        200: "OK",
        201: "Created",
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        415: "Unsupported Media Type",
        500: "Internal Server Error",
        502: "Bad Gateway",
        503: "Service Unavailable",
    }.get(response.status, "Error")
    start_response(f"{response.status} {reason}", list(response.headers))
    return [response.body]
