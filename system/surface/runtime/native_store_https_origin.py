#!/usr/bin/env python3
"""Canonical HTTPS base-origin policy for Native Store byte transports.

The Store catalog and app artifact downloader use one source of truth.
This module only validates configuration and does not confer trust,
verify remote signatures, follow redirects or grant lifecycle authority.
"""

from __future__ import annotations

from urllib import parse


class StoreHttpsOriginError(ValueError):
    pass


def normalize_store_https_base_origin(value: object) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or any(ord(character) < 0x20 or ord(character) == 0x7f for character in value)
        or "\\" in value
    ):
        raise StoreHttpsOriginError("Store HTTPS base origin is invalid")
    try:
        parsed = parse.urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise StoreHttpsOriginError("Store HTTPS base origin is invalid") from exc

    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or port == 0
        or "%" in parsed.netloc
    ):
        raise StoreHttpsOriginError("Store HTTPS base origin is invalid")

    # The configured path is a fixed deployment prefix, not an untrusted URL
    # and not a file selector. Percent escapes may be interpreted differently
    # by proxies or servers (e.g. %2e%2e or %2f). Reject ambiguous paths
    # instead of allowing any endpoint to reinterpret the base prefix.
    path = parsed.path or "/"
    if (
        "%" in path
        or any(segment in {".", ".."} for segment in path.split("/"))
    ):
        raise StoreHttpsOriginError("Store HTTPS base origin path is invalid")

    if not path.endswith("/"):
        path += "/"
    return parse.urlunsplit(("https", parsed.netloc, path, "", ""))
