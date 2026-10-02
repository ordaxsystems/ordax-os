"""Read-only first-party Product OAuth resource server for OrdaX Network.

This module is provider-neutral and deliberately disabled by default. It accepts
only opaque OrdaX Product OAuth bearer tokens, resolves them through the shared
OAuth boundary, enforces exact read scopes and delegates to a server-only
Network authority adapter.

No public listener is enabled merely because this source exists.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import re
import sys
from dataclasses import dataclass
from typing import Mapping, Protocol
from urllib.parse import parse_qs, urlsplit


def _load_oauth_core():
    module_name = "ordax_product_oauth_core"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing

    path = Path(__file__).resolve().parents[1] / "product-oauth" / "oauth.py"
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

JSON_CONTENT_TYPE = "application/json; charset=utf-8"
NO_STORE = "no-store, max-age=0"
STATUS_SCHEMA = "prototype-ordax.product-network-status/1"
SPACE_SCHEMA = "prototype-ordax.product-network-space/1"
DIRECTORY_SCHEMA = "prototype-ordax.product-network-directory/1"
COMMUNITIES_SCHEMA = "prototype-ordax.product-network-communities/1"
ERROR_SCHEMA = "prototype-ordax.product-network-error/1"

TOKEN_RE = _oauth.TOKEN_RE
UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
COMMUNITY_ID_RE = re.compile(r"^[a-z0-9]+([.-][a-z0-9]+)*$")
CATEGORY_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

ROUTE_SCOPES = {
    "/product/network/v1/space": "network.space.read",
    "/product/network/v1/directory": "network.directory.read",
    "/product/network/v1/communities": "network.communities.read",
}


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes


class ProductNetworkAuthority(Protocol):
    @property
    def configured(self) -> bool: ...

    def get_space(self, access_token: str) -> list[Mapping[str, object]]: ...

    def list_directory(
        self,
        access_token: str,
        *,
        search: str | None,
        category: str | None,
        after_name: str | None,
        after_space_id: str | None,
        limit: int,
    ) -> list[Mapping[str, object]]: ...

    def list_communities(
        self,
        access_token: str,
        *,
        limit: int,
    ) -> list[Mapping[str, object]]: ...


class ProductNetworkUnavailable(RuntimeError):
    pass


class ProductNetworkAccessDenied(RuntimeError):
    pass


class DisabledProductNetworkAuthority:
    @property
    def configured(self) -> bool:
        return False

    def _unavailable(self, *args, **kwargs):
        del args, kwargs
        raise ProductNetworkUnavailable("product Network authority disabled")

    get_space = _unavailable
    list_directory = _unavailable
    list_communities = _unavailable


def _json_response(status: int, payload: Mapping[str, object]) -> HttpResponse:
    body = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
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
        {"$schema": ERROR_SCHEMA, "error": code, "message": message},
    )


def _bearer(headers: Mapping[str, str]) -> str:
    raw = headers.get("authorization")
    if not isinstance(raw, str) or not raw.startswith("Bearer "):
        raise ProductNetworkAccessDenied("bearer-required")
    token = raw[7:]
    if TOKEN_RE.fullmatch(token) is None:
        raise ProductNetworkAccessDenied("bearer-invalid")
    return token


def _single(query: Mapping[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    if values is None:
        return None
    if len(values) != 1:
        raise ValueError(key)
    return values[0]


def _bounded_optional(value: str | None, *, maximum: int, field: str) -> str | None:
    if value is None or value == "":
        return None
    if len(value) > maximum or any(ord(ch) < 32 for ch in value):
        raise ValueError(field)
    return value


def _limit(value: str | None, default: int, maximum: int) -> int:
    if value is None or value == "":
        return default
    if not value.isascii() or not value.isdigit():
        raise ValueError("limit")
    number = int(value)
    if number < 1 or number > maximum:
        raise ValueError("limit")
    return number


def _space_row(row: Mapping[str, object]) -> dict[str, object]:
    if set(row) != {
        "space_id",
        "public_name",
        "description",
        "region_label",
        "categories",
        "visibility",
    }:
        raise ProductNetworkUnavailable("space-row-malformed")
    space_id = row["space_id"]
    public_name = row["public_name"]
    description = row["description"]
    region_label = row["region_label"]
    categories = row["categories"]
    visibility = row["visibility"]
    if not isinstance(space_id, str) or UUID_RE.fullmatch(space_id) is None:
        raise ProductNetworkUnavailable("space-row-malformed")
    if not isinstance(public_name, str) or not 1 <= len(public_name) <= 120:
        raise ProductNetworkUnavailable("space-row-malformed")
    if description is not None and (not isinstance(description, str) or len(description) > 600):
        raise ProductNetworkUnavailable("space-row-malformed")
    if region_label is not None and (not isinstance(region_label, str) or not 1 <= len(region_label) <= 120):
        raise ProductNetworkUnavailable("space-row-malformed")
    if (
        not isinstance(categories, list)
        or len(categories) > 12
        or any(not isinstance(item, str) or len(item) > 60 for item in categories)
    ):
        raise ProductNetworkUnavailable("space-row-malformed")
    if visibility not in {"hidden", "discoverable"}:
        raise ProductNetworkUnavailable("space-row-malformed")
    return {
        "space_id": space_id.lower(),
        "public_name": public_name,
        "description": description,
        "region_label": region_label,
        "categories": categories,
        "visibility": visibility,
    }


def _directory_row(row: Mapping[str, object]) -> dict[str, object]:
    extended = dict(row)
    extended["visibility"] = "discoverable"
    result = _space_row(extended)
    result.pop("visibility")
    return result


def _community_row(row: Mapping[str, object]) -> dict[str, object]:
    if set(row) != {"community_id", "title", "kind", "jurisdiction", "join_policy"}:
        raise ProductNetworkUnavailable("community-row-malformed")
    community_id = row["community_id"]
    title = row["title"]
    kind = row["kind"]
    jurisdiction = row["jurisdiction"]
    join_policy = row["join_policy"]
    if (
        not isinstance(community_id, str)
        or len(community_id) > 120
        or COMMUNITY_ID_RE.fullmatch(community_id) is None
        or not isinstance(title, str)
        or not 1 <= len(title) <= 120
        or not isinstance(kind, str)
        or not 1 <= len(kind) <= 80
        or not isinstance(jurisdiction, str)
        or len(jurisdiction) != 2
        or jurisdiction.upper() != jurisdiction
        or join_policy not in {"explicit-consent", "approval-required", "invite-only"}
    ):
        raise ProductNetworkUnavailable("community-row-malformed")
    return dict(row)


class ProductNetworkHttpGateway:
    def __init__(
        self,
        *,
        oauth_boundary=None,
        authority: ProductNetworkAuthority | None = None,
    ) -> None:
        self.oauth = oauth_boundary or _oauth.ProductOAuthBoundary()
        self.authority = authority or DisabledProductNetworkAuthority()

    def handle(
        self,
        method: str,
        target: str,
        headers: Mapping[str, str] | None = None,
        body: bytes | None = None,
    ) -> HttpResponse:
        method = method.upper()
        request_headers = {key.lower(): value for key, value in (headers or {}).items()}
        split = urlsplit(target)
        path = split.path

        if path == "/product/network/v1/status":
            if method != "GET":
                return self._method_not_allowed("GET")
            return _json_response(
                200,
                {
                    "$schema": STATUS_SCHEMA,
                    "oauth_configured": self.oauth.configured,
                    "resource_authority_configured": self.authority.configured,
                    "public_activation": False,
                    "read_only": True,
                },
            )

        required_scope = ROUTE_SCOPES.get(path)
        if required_scope is None:
            if path.startswith("/product/network/"):
                return _error(404, "resource-route-not-found", "Rota de recurso inexistente.")
            return _error(404, "not-found", "Recurso inexistente.")
        if method != "GET":
            return self._method_not_allowed("GET")
        if body not in (None, b""):
            return _error(400, "body-not-allowed", "A leitura não aceita corpo.")

        if not self.oauth.configured or not self.authority.configured:
            return _error(503, "resource-unavailable", "O recurso de produto está indisponível.")

        try:
            token = _bearer(request_headers)
            context = self.oauth.resolve(token)
            if required_scope not in context.scopes:
                return _error(403, "insufficient-scope", "O token não possui o escopo necessário.")
            query = parse_qs(
                split.query,
                keep_blank_values=True,
                strict_parsing=True,
                max_num_fields=8,
            )
            if path == "/product/network/v1/space":
                if query:
                    raise ValueError("query")
                rows = self.authority.get_space(token)
                if len(rows) > 1:
                    raise ProductNetworkUnavailable("space-cardinality")
                payload = {
                    "$schema": SPACE_SCHEMA,
                    "space": _space_row(rows[0]) if rows else None,
                }
                return _json_response(200, payload)

            if path == "/product/network/v1/directory":
                allowed = {"search", "category", "after_name", "after_space_id", "limit"}
                if set(query) - allowed:
                    raise ValueError("query")
                search = _bounded_optional(_single(query, "search"), maximum=80, field="search")
                category = _bounded_optional(_single(query, "category"), maximum=60, field="category")
                if category is not None and CATEGORY_RE.fullmatch(category) is None:
                    raise ValueError("category")
                after_name = _bounded_optional(_single(query, "after_name"), maximum=120, field="after_name")
                after_space_id = _single(query, "after_space_id")
                if (after_name is None) != (after_space_id is None):
                    raise ValueError("cursor")
                if after_space_id is not None and UUID_RE.fullmatch(after_space_id) is None:
                    raise ValueError("after_space_id")
                limit = _limit(_single(query, "limit"), 20, 50)
                rows = self.authority.list_directory(
                    token,
                    search=search,
                    category=category,
                    after_name=after_name,
                    after_space_id=after_space_id,
                    limit=limit,
                )
                if len(rows) > limit:
                    raise ProductNetworkUnavailable("directory-cardinality")
                return _json_response(
                    200,
                    {
                        "$schema": DIRECTORY_SCHEMA,
                        "entries": [_directory_row(row) for row in rows],
                    },
                )

            allowed = {"limit"}
            if set(query) - allowed:
                raise ValueError("query")
            limit = _limit(_single(query, "limit"), 50, 100)
            rows = self.authority.list_communities(token, limit=limit)
            if len(rows) > limit:
                raise ProductNetworkUnavailable("community-cardinality")
            return _json_response(
                200,
                {
                    "$schema": COMMUNITIES_SCHEMA,
                    "communities": [_community_row(row) for row in rows],
                },
            )
        except (_oauth.OAuthAccessDenied, ProductNetworkAccessDenied):
            return _error(401, "invalid-token", "O token de produto não é válido.")
        except _oauth.OAuthUnavailable:
            return _error(503, "resource-unavailable", "A autoridade OAuth está indisponível.")
        except ProductNetworkUnavailable:
            return _error(503, "resource-unavailable", "A autoridade Network está indisponível.")
        except ValueError:
            return _error(400, "invalid-request", "A solicitação de recurso é inválida.")

    @staticmethod
    def _method_not_allowed(allowed: str) -> HttpResponse:
        response = _error(405, "method-not-allowed", "Método não permitido.")
        return HttpResponse(
            status=response.status,
            headers=response.headers + (("Allow", allowed),),
            body=response.body,
        )


gateway = ProductNetworkHttpGateway()


def application(environ, start_response):
    """Default WSGI adapter; intentionally remains fail-closed."""

    method = str(environ.get("REQUEST_METHOD", "GET"))
    path = str(environ.get("PATH_INFO", "/"))
    query = str(environ.get("QUERY_STRING", ""))
    target = path + (("?" + query) if query else "")

    headers: dict[str, str] = {}
    for key, value in environ.items():
        if key.startswith("HTTP_") and isinstance(value, str):
            headers[key[5:].replace("_", "-").lower()] = value

    response = gateway.handle(method, target, headers, None)
    reason = {
        200: "OK",
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        503: "Service Unavailable",
    }.get(response.status, "Error")
    start_response(f"{response.status} {reason}", list(response.headers))
    return [response.body]
