"""HTTP boundary for OrdaX first-party Product OAuth.

This module is deliberately thin. Protocol validation remains owned by oauth.py
and persistence remains owned by the injected server authority. The default WSGI
application is fail-closed and does not auto-enable from environment variables
or from the presence of the Supabase schema.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
from dataclasses import dataclass
from typing import Mapping
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from services.product_core.session import ProductSession, SessionResolver

JSON_CONTENT_TYPE = "application/json; charset=utf-8"
FORM_CONTENT_TYPE = "application/x-www-form-urlencoded"
NO_STORE = "no-store, max-age=0"
ERROR_SCHEMA = "prototype-ordax.product-oauth-http-error/1"
HTTP_STATUS_SCHEMA = "prototype-ordax.product-oauth-http-status/1"
MAX_BODY_BYTES = 16 * 1024


def _load_oauth_core():
    module_name = "ordax_product_oauth_http_core"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing

    path = Path(__file__).with_name("oauth.py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("product OAuth core loader unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(module_name, None)
        raise
    return module


_oauth = _load_oauth_core()
AuthorizationRequest = _oauth.AuthorizationRequest
OAuthAccessDenied = _oauth.OAuthAccessDenied
OAuthError = _oauth.OAuthError
OAuthInvalidRequest = _oauth.OAuthInvalidRequest
OAuthUnavailable = _oauth.OAuthUnavailable
ProductOAuthBoundary = _oauth.ProductOAuthBoundary


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes


class AnonymousSessionResolver:
    @property
    def configured(self) -> bool:
        return False

    def resolve(self, cookie_header: str | None) -> ProductSession:
        del cookie_header
        return ProductSession(authenticated=False)


def _json_response(status: int, payload: Mapping[str, object]) -> HttpResponse:
    body = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )
    return HttpResponse(
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


def _error(status: int, code: str, message: str) -> HttpResponse:
    return _json_response(
        status,
        {
            "$schema": ERROR_SCHEMA,
            "error": code,
            "message": message,
        },
    )


def _redirect(location: str) -> HttpResponse:
    return HttpResponse(
        status=303,
        headers=(
            ("Location", location),
            ("Cache-Control", NO_STORE),
            ("Pragma", "no-cache"),
            ("X-Content-Type-Options", "nosniff"),
            ("Content-Length", "0"),
        ),
        body=b"",
    )


def _content_type(headers: Mapping[str, str]) -> str:
    return headers.get("content-type", "").split(";", 1)[0].strip().lower()


def _json_body(body: bytes | None) -> Mapping[str, object]:
    if body is None or len(body) == 0 or len(body) > MAX_BODY_BYTES:
        raise OAuthInvalidRequest("body")
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OAuthInvalidRequest("body") from exc
    if not isinstance(value, dict):
        raise OAuthInvalidRequest("body")
    return value


def _form_body(body: bytes | None) -> dict[str, str]:
    if body is None or len(body) == 0 or len(body) > MAX_BODY_BYTES:
        raise OAuthInvalidRequest("body")
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise OAuthInvalidRequest("body") from exc

    pairs = parse_qsl(
        text,
        keep_blank_values=True,
        strict_parsing=True,
        max_num_fields=16,
    )
    result: dict[str, str] = {}
    for key, value in pairs:
        if key in result:
            raise OAuthInvalidRequest("duplicate form field")
        result[key] = value
    return result


def _authorization_location(redirect_uri: str, code: str, state: str) -> str:
    parts = urlsplit(redirect_uri)
    query = parse_qsl(parts.query, keep_blank_values=True, max_num_fields=32)
    reserved = {"code", "state", "error", "error_description"}
    if any(key in reserved for key, _ in query):
        raise OAuthError("registered redirect URI contains reserved OAuth fields")
    query.extend((("code", code), ("state", state)))
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query), "")
    )


class ProductOAuthHttpGateway:
    def __init__(
        self,
        *,
        sessions: SessionResolver | None = None,
        boundary: object | None = None,
    ) -> None:
        self.sessions = sessions or AnonymousSessionResolver()
        self.boundary = boundary or ProductOAuthBoundary()

    def handle(
        self,
        method: str,
        target: str,
        headers: Mapping[str, str] | None = None,
        body: bytes | None = None,
    ) -> HttpResponse:
        method = method.upper()
        request_headers = {
            key.lower(): value for key, value in (headers or {}).items()
        }
        path = urlsplit(target).path

        if path == "/oauth/status":
            if method != "GET":
                return self._method_not_allowed("GET")
            core = self.boundary.status()
            return _json_response(
                200,
                {
                    "$schema": HTTP_STATUS_SCHEMA,
                    "identity_configured": self.sessions.configured,
                    "authority_configured": bool(core["authority_configured"]),
                    "public_activation": False,
                },
            )

        if path == "/oauth/authorize":
            if method != "POST":
                return self._method_not_allowed("POST")
            return self._authorize(request_headers, body)

        if path == "/oauth/token":
            if method != "POST":
                return self._method_not_allowed("POST")
            return self._token(request_headers, body)

        if path == "/oauth/revoke":
            if method != "POST":
                return self._method_not_allowed("POST")
            return self._revoke(request_headers, body)

        if path.startswith("/oauth/"):
            return _error(404, "oauth-route-not-found", "Rota OAuth inexistente.")
        return _error(404, "not-found", "Recurso inexistente.")

    def _authorize(
        self,
        headers: Mapping[str, str],
        body: bytes | None,
    ) -> HttpResponse:
        if not self.sessions.configured or not self.boundary.configured:
            return _error(
                503,
                "oauth-unavailable",
                "A autorização de produto ainda não está disponível.",
            )
        if _content_type(headers) != "application/json":
            return _error(
                415,
                "unsupported-media-type",
                "O corpo deve usar application/json.",
            )

        try:
            payload = _json_body(body)
            if set(payload) != {
                "response_type",
                "client_id",
                "redirect_uri",
                "scope",
                "space_id",
                "state",
                "code_challenge",
                "code_challenge_method",
            }:
                raise OAuthInvalidRequest("fields")
            if payload["response_type"] != "code":
                raise OAuthInvalidRequest("response_type")
            scope = payload["scope"]
            if not isinstance(scope, str) or not scope or scope != scope.strip():
                raise OAuthInvalidRequest("scope")
            scopes = tuple(scope.split(" "))
            if any(not item for item in scopes):
                raise OAuthInvalidRequest("scope")

            session = self.sessions.resolve(headers.get("cookie"))
            response = self.boundary.authorize(
                session=session,
                presented_csrf=headers.get("x-ordax-csrf"),
                sec_fetch_site=headers.get("sec-fetch-site"),
                request=AuthorizationRequest(
                    client_id=payload["client_id"],
                    redirect_uri=payload["redirect_uri"],
                    scopes=scopes,
                    space_id=payload["space_id"],
                    state=payload["state"],
                    code_challenge=payload["code_challenge"],
                    code_challenge_method=payload["code_challenge_method"],
                ),
            )
            return _redirect(
                _authorization_location(
                    response.redirect_uri,
                    response.code,
                    response.state,
                )
            )
        except OAuthUnavailable:
            return _error(
                503,
                "oauth-unavailable",
                "A autoridade OAuth está indisponível.",
            )
        except OAuthAccessDenied:
            return _error(403, "access-denied", "A autorização foi rejeitada.")
        except OAuthInvalidRequest:
            return _error(400, "invalid-request", "A solicitação OAuth é inválida.")
        except OAuthError:
            return _error(
                502,
                "oauth-authority-error",
                "A autoridade OAuth retornou um resultado inválido.",
            )

    def _token(
        self,
        headers: Mapping[str, str],
        body: bytes | None,
    ) -> HttpResponse:
        if not self.boundary.configured:
            return _error(
                503,
                "oauth-unavailable",
                "A autoridade OAuth está indisponível.",
            )
        if _content_type(headers) != FORM_CONTENT_TYPE:
            return _error(
                415,
                "unsupported-media-type",
                "O token endpoint exige application/x-www-form-urlencoded.",
            )
        try:
            form = _form_body(body)
            if set(form) != {
                "grant_type",
                "client_id",
                "code",
                "redirect_uri",
                "code_verifier",
            }:
                raise OAuthInvalidRequest("fields")
            if form["grant_type"] != "authorization_code":
                raise OAuthInvalidRequest("grant_type")
            pair = self.boundary.exchange_code(
                client_id=form["client_id"],
                code=form["code"],
                redirect_uri=form["redirect_uri"],
                code_verifier=form["code_verifier"],
            )
            payload: dict[str, object] = {
                "access_token": pair.access_token,
                "token_type": pair.token_type,
                "expires_in": pair.expires_in,
            }
            if pair.refresh_token is not None:
                raise OAuthError("refresh tokens are not enabled")
            return _json_response(200, payload)
        except OAuthUnavailable:
            return _error(
                503,
                "oauth-unavailable",
                "A autoridade OAuth está indisponível.",
            )
        except (OAuthAccessDenied, OAuthInvalidRequest):
            return _error(
                400,
                "invalid-grant",
                "O authorization code não pôde ser trocado.",
            )
        except OAuthError:
            return _error(
                502,
                "oauth-authority-error",
                "A autoridade OAuth retornou um resultado inválido.",
            )

    def _revoke(
        self,
        headers: Mapping[str, str],
        body: bytes | None,
    ) -> HttpResponse:
        if not self.boundary.configured:
            return _error(
                503,
                "oauth-unavailable",
                "A autoridade OAuth está indisponível.",
            )
        if _content_type(headers) != FORM_CONTENT_TYPE:
            return _error(
                415,
                "unsupported-media-type",
                "O revocation endpoint exige application/x-www-form-urlencoded.",
            )
        try:
            form = _form_body(body)
            if set(form) != {"token"}:
                raise OAuthInvalidRequest("fields")
            self.boundary.revoke(form["token"])
            # RFC-style revocation does not disclose whether the token existed.
            return _json_response(200, {"revoked": True})
        except OAuthUnavailable:
            return _error(
                503,
                "oauth-unavailable",
                "A autoridade OAuth está indisponível.",
            )
        except OAuthInvalidRequest:
            return _error(
                400,
                "invalid-request",
                "A solicitação de revogação é inválida.",
            )
        except OAuthError:
            return _error(
                502,
                "oauth-authority-error",
                "A autoridade OAuth está indisponível.",
            )

    @staticmethod
    def _method_not_allowed(allowed: str) -> HttpResponse:
        response = _error(405, "method-not-allowed", "Método não permitido.")
        return HttpResponse(
            status=response.status,
            headers=response.headers + (("Allow", allowed),),
            body=response.body,
        )


gateway = ProductOAuthHttpGateway()


def application(environ, start_response):
    """Default WSGI adapter; intentionally uses the fail-closed gateway."""

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
        length = int(raw_length or 0)
    except (TypeError, ValueError):
        length = 0
    if length < 0:
        length = 0
    read_length = min(length, MAX_BODY_BYTES + 1)
    stream = environ.get("wsgi.input")
    body = stream.read(read_length) if stream is not None and read_length else None

    response = gateway.handle(method, target, headers, body)
    reason = {
        200: "OK",
        303: "See Other",
        400: "Bad Request",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        415: "Unsupported Media Type",
        502: "Bad Gateway",
        503: "Service Unavailable",
    }.get(response.status, "Error")
    start_response(f"{response.status} {reason}", list(response.headers))
    return [response.body]
