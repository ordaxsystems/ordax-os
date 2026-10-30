#!/usr/bin/env python3
"""Prove real account-sync continuity using two independent OrdaX sessions.

Credentials are accepted only through environment variables and are never
printed or persisted. The proof uses a unique non-product object id, verifies
incremental delivery A -> B, then tombstones the proof object.
"""

from __future__ import annotations

import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_GATEWAY_FILE = os.path.join(ROOT, "system", "services", "account", "gateway-base-url")
MUTATION_SCHEMA = "ordax.sync-mutation/1"
CHANGES_SCHEMA = "prototype-ordax.sync-changes/1"
SNAPSHOT_SCHEMA = "prototype-ordax.sync-snapshot/1"
ACK_SCHEMA = "prototype-ordax.sync-ack/1"


def fail(message: str) -> "NoReturn":
    raise SystemExit(f"ACCOUNT_SYNC_TWO_CLIENT_PROOF=FAIL reason={message}")


class Client:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(HTTPCookieProcessor(self.jar))

    def request(self, method: str, path: str, body: bytes | None = None, content_type: str | None = None):
        headers = {"Accept": "application/json", "User-Agent": "OrdaX-Account-Sync-Proof/1"}
        if content_type:
            headers["Content-Type"] = content_type
        req = Request(self.base_url + path, data=body, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=20) as response:
                raw = response.read(2 * 1024 * 1024)
                status = response.status
        except HTTPError as exc:
            raw = exc.read(2 * 1024 * 1024)
            status = exc.code
        except (URLError, OSError, TimeoutError) as exc:
            fail(f"gateway-unreachable:{type(exc).__name__}")
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError):
            fail(f"invalid-json:{status}")
        return status, payload

    def login(self, email: str, password: str) -> None:
        body = urlencode({"email": email, "password": password}).encode("utf-8")
        status, payload = self.request(
            "POST", "/auth/login", body, "application/x-www-form-urlencoded"
        )
        if status != 200 or payload.get("authenticated") is not True:
            fail(f"login:{status}")

    def logout(self) -> None:
        self.request("POST", "/auth/logout", b"", "application/json")

    def snapshot(self):
        status, payload = self.request("GET", "/sync/snapshot?limit=500")
        if status != 200 or payload.get("$schema") != SNAPSHOT_SCHEMA:
            fail(f"snapshot:{status}")
        return payload

    def changes(self, after_cursor: int):
        status, payload = self.request(
            "GET", f"/sync/changes?afterCursor={after_cursor}&limit=500"
        )
        if status != 200 or payload.get("$schema") != CHANGES_SCHEMA:
            fail(f"changes:{status}")
        return payload

    def mutate(self, mutation: dict):
        body = json.dumps(mutation, separators=(",", ":")).encode("utf-8")
        status, payload = self.request("POST", "/sync/mutate", body, "application/json")
        if status != 200 or payload.get("$schema") != ACK_SCHEMA:
            fail(f"mutate:{status}")
        return payload


def gateway_url() -> str:
    override = os.environ.get("ORDAX_ACCOUNT_GATEWAY_BASE_URL", "").strip()
    if override:
        return override
    try:
        with open(DEFAULT_GATEWAY_FILE, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        fail("gateway-config-missing")


def mutation(object_id: str, base_revision: int, tombstone: bool, key: str) -> dict:
    return {
        "$schema": MUTATION_SCHEMA,
        "operation": "delete" if tombstone else "upsert",
        "objectId": object_id,
        "dataClass": "app-state-metadata",
        "objectSchemaVersion": 1,
        "resolverVersion": 1,
        "baseServerRevision": base_revision,
        "idempotencyKey": key,
        "payload": {} if tombstone else {"proof": "two-client-continuity-v1"},
    }


def write_receipt(
    path: str,
    base_url: str,
    create_cursor: int,
    delete_cursor: int,
) -> None:
    if not path:
        return
    parsed = urlsplit(base_url)
    source_commit = os.environ.get("GITHUB_SHA", "").strip()
    if len(source_commit) != 40:
        source_commit = None
    else:
        try:
            int(source_commit, 16)
        except ValueError:
            source_commit = None

    payload = {
        "$schema": "prototype-ordax.account-sync-two-client-proof/1",
        "status": "pass",
        "proof_scope": "two-independent-sessions-same-account",
        "gateway_origin": f"{parsed.scheme}://{parsed.netloc}",
        "source_commit": source_commit,
        "workflow_run_id": os.environ.get("GITHUB_RUN_ID") or None,
        "create_cursor": create_cursor,
        "delete_cursor": delete_cursor,
        "proof_object_tombstoned": True,
        "credentials_persisted": False,
        "account_identifier_recorded": False,
        "sensitive_auth_material_recorded": False,
    }
    output = Path(path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(f".{output.name}.tmp-{os.getpid()}")
    temp.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    os.replace(temp, output)


def main() -> int:
    email = os.environ.get("ORDAX_PROOF_ACCOUNT_EMAIL", "").strip()
    password = os.environ.get("ORDAX_PROOF_ACCOUNT_PASSWORD", "")
    if not email or not password:
        print("ACCOUNT_SYNC_TWO_CLIENT_PROOF=SKIP reason=credentials-not-provided")
        return 2

    base_url = gateway_url()
    if not base_url.startswith("https://") or "?" in base_url or "#" in base_url:
        fail("invalid-gateway-url")

    client_a = Client(base_url)
    client_b = Client(base_url)
    object_id = f"proof/two-client/{secrets.token_hex(16)}"

    try:
        client_a.login(email, password)
        client_b.login(email, password)

        before = client_b.snapshot()
        cursor = before.get("cursor")
        if not isinstance(cursor, int) or cursor < 0:
            fail("invalid-initial-cursor")

        first = client_a.mutate(
            mutation(object_id, 0, False, f"proof-create-{secrets.token_hex(12)}")
        )
        revision = first.get("serverRevision")
        change_cursor = first.get("changeCursor")
        if not isinstance(revision, int) or revision != 1:
            fail("invalid-create-revision")
        if not isinstance(change_cursor, int) or change_cursor <= cursor:
            fail("invalid-create-cursor")

        delivered = client_b.changes(cursor)
        seen = [
            item for item in delivered.get("changes", [])
            if item.get("objectId") == object_id
            and item.get("serverRevision") == revision
            and item.get("tombstone") is False
        ]
        if len(seen) != 1:
            fail("create-not-delivered-to-second-session")

        second = client_a.mutate(
            mutation(object_id, revision, True, f"proof-delete-{secrets.token_hex(12)}")
        )
        deleted_revision = second.get("serverRevision")
        deleted_cursor = second.get("changeCursor")
        if deleted_revision != revision + 1:
            fail("invalid-delete-revision")
        if not isinstance(deleted_cursor, int) or deleted_cursor <= change_cursor:
            fail("invalid-delete-cursor")

        removed = client_b.changes(change_cursor)
        tombstones = [
            item for item in removed.get("changes", [])
            if item.get("objectId") == object_id
            and item.get("serverRevision") == deleted_revision
            and item.get("tombstone") is True
        ]
        if len(tombstones) != 1:
            fail("tombstone-not-delivered-to-second-session")

        write_receipt(
            os.environ.get("ORDAX_PROOF_RECEIPT_PATH", "").strip(),
            base_url,
            change_cursor,
            deleted_cursor,
        )
        print(
            "ACCOUNT_SYNC_TWO_CLIENT_PROOF=PASS "
            f"create_cursor={change_cursor} delete_cursor={deleted_cursor}"
        )
        return 0
    finally:
        client_a.logout()
        client_b.logout()


if __name__ == "__main__":
    raise SystemExit(main())
