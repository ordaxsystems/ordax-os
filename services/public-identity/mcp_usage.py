"""Bounded, read-only OrdaX Product MCP usage adapter.

The Public Identity Gateway alone owns the HttpOnly account cookie. Only this
server-side adapter forwards the verified access token to the canonical
Product MCP owner read; browser JavaScript never receives a bearer token.
"""
from __future__ import annotations

import json
import re
from typing import Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

MCP_USAGE_URL = "https://mcp.ordax.com.br/v3/product/usage"
USAGE_SCHEMA = "ordax.product-mcp-usage/1"
MAX_RESPONSE_BYTES = 65536
MONTH = re.compile(r"^\d{4}-(?:0[1-9]|1[0-2])-01$")
TOOL = re.compile(r"^[a-z][a-z0-9._-]{1,95}$")


class ProductMcpUsageError(RuntimeError):
    """Sanitized unavailable/invalid response; never contains tokens or body."""


class UsageTransport(Protocol):
    def request(self, headers: Mapping[str, str]) -> tuple[int, bytes]: ...


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class UrllibUsageTransport:
    def request(self, headers: Mapping[str, str]) -> tuple[int, bytes]:
        request = Request(MCP_USAGE_URL, headers=dict(headers), method="GET")
        try:
            with build_opener(_NoRedirect()).open(request, timeout=10) as response:
                data = response.read(MAX_RESPONSE_BYTES + 1)
                status = int(response.status)
        except HTTPError as exc:
            # Do not follow redirects or expose the upstream response body.
            raise ProductMcpUsageError("mcp-usage-upstream-error") from None
        except (URLError, OSError, ValueError):
            raise ProductMcpUsageError("mcp-usage-upstream-unavailable") from None
        if len(data) > MAX_RESPONSE_BYTES:
            raise ProductMcpUsageError("mcp-usage-response-too-large")
        return status, data


def validated_usage(value: object) -> dict[str, object]:
    if not isinstance(value, dict) or value.get("ok") is not True:
        raise ProductMcpUsageError("mcp-usage-invalid-response")
    if (value.get("schema") != USAGE_SCHEMA
        or value.get("observed_only") is not True
        or value.get("billable") is not False
        or value.get("coverage") != "partial_observational"
        or value.get("quota", object()) is not None
        or value.get("charge", object()) is not None
        or type(value.get("collection_active_now")) is not bool):
        raise ProductMcpUsageError("mcp-usage-invalid-response")
    current = value.get("current_month")
    previous = value.get("previous_month")
    if (not isinstance(current, str) or not MONTH.fullmatch(current)
        or not isinstance(previous, str) or not MONTH.fullmatch(previous)):
        raise ProductMcpUsageError("mcp-usage-invalid-response")
    items = value.get("entries")
    if not isinstance(items, list) or len(items) > 256:
        raise ProductMcpUsageError("mcp-usage-invalid-response")
    sanitized = []
    seen = set()
    for row in items:
        if not isinstance(row, dict):
            raise ProductMcpUsageError("mcp-usage-invalid-response")
        month = row.get("month")
        tool = row.get("tool_name")
        calls = row.get("tool_calls")
        if (month not in (current, previous)
            or not isinstance(tool, str) or not TOOL.fullmatch(tool)
            or type(calls) is not int or calls < 0 or calls > 9007199254740991
            or (month, tool) in seen):
            raise ProductMcpUsageError("mcp-usage-invalid-response")
        seen.add((month, tool))
        sanitized.append({"month": month, "tool_name": tool, "tool_calls": calls})
    return {
        "ok": True, "schema": USAGE_SCHEMA, "observed_only": True, "billable": False,
        "collection_active_now": value["collection_active_now"],
        "coverage": "partial_observational", "quota": None, "charge": None,
        "current_month": current, "previous_month": previous, "entries": sanitized,
    }


class ProductMcpUsageReader:
    def __init__(self, transport: UsageTransport | None = None) -> None:
        self.transport = transport if transport is not None else UrllibUsageTransport()

    def read(self, access_token: str) -> dict[str, object]:
        if (not isinstance(access_token, str)
            or len(access_token) < 16 or len(access_token) > 16384
            or not re.fullmatch(r"[A-Za-z0-9_.-]+", access_token)):
            raise ProductMcpUsageError("mcp-usage-invalid-token")
        status, body = self.transport.request({
            "Authorization": "Bearer " + access_token,
            "Accept": "application/json",
        })
        if status != 200 or len(body) > MAX_RESPONSE_BYTES:
            raise ProductMcpUsageError("mcp-usage-unavailable")
        try:
            return validated_usage(json.loads(body.decode("utf-8")))
        except (UnicodeError, json.JSONDecodeError, TypeError, ValueError):
            raise ProductMcpUsageError("mcp-usage-invalid-response") from None
