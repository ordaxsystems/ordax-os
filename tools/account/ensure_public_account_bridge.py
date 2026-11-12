#!/usr/bin/env python3
"""Ensure the dedicated public->internal Account service key exists.

The bridge uses a named Supabase secret API key. The key value is never fetched,
printed, persisted in GitHub, or copied into another secret store: hosted Edge
Functions receive named secret keys through SUPABASE_SECRET_KEYS.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Any

API_ROOT = "https://api.supabase.com/v1"
BRIDGE_KEY_NAME = "ordax_account_public_bridge"
REF_RE = re.compile(r"[a-z0-9]{20}\Z")


def _request(url: str, token: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
    payload = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if payload is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        # Never emit a response body here: Management API error bodies can contain
        # account metadata and this command runs in CI logs.
        raise RuntimeError(f"management-api-http-{exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("management-api-unreachable") from exc
    try:
        return json.loads(raw.decode("utf-8")) if raw else None
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("management-api-invalid-json") from exc


def _items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("keys", "api_keys", "data"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    raise RuntimeError("management-api-unexpected-key-list")


def ensure_bridge(project_ref: str, token: str) -> str:
    if REF_RE.fullmatch(project_ref) is None:
        raise ValueError("invalid-project-ref")
    if not token.strip():
        raise ValueError("missing-management-token")

    endpoint = f"{API_ROOT}/projects/{project_ref}/api-keys"
    existing = [item for item in _items(_request(f"{endpoint}?reveal=false", token)) if item.get("name") == BRIDGE_KEY_NAME]
    if len(existing) > 1:
        raise RuntimeError("duplicate-bridge-key-name")
    if existing:
        if existing[0].get("type") != "secret":
            raise RuntimeError("bridge-key-name-has-wrong-type")
        return "existing"

    created = _request(
        f"{endpoint}?reveal=false",
        token,
        method="POST",
        body={
            "type": "secret",
            "name": BRIDGE_KEY_NAME,
            "description": "OrdaX public Account gateway to internal Account gateway",
        },
    )
    if not isinstance(created, dict) or created.get("name") != BRIDGE_KEY_NAME or created.get("type") != "secret":
        raise RuntimeError("bridge-key-create-not-confirmed")
    return "created"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-ref", required=True)
    args = parser.parse_args(argv)
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    try:
        state = ensure_bridge(args.project_ref, token)
    except (RuntimeError, ValueError) as exc:
        print(f"PUBLIC_ACCOUNT_BRIDGE=BLOCKED reason={exc}", file=sys.stderr)
        return 1
    print(f"PUBLIC_ACCOUNT_BRIDGE={state.upper()}")
    print(f"PUBLIC_ACCOUNT_BRIDGE_KEY_NAME={BRIDGE_KEY_NAME}")
    print("PUBLIC_ACCOUNT_BRIDGE_KEY_VALUE_PRINTED=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
