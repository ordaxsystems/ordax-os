#!/usr/bin/env python3
"""Validate the sanitized receipt emitted by the authenticated cloud Memory proof.

The validator intentionally accepts only non-secret proof metadata. It is shared
by the preprovisioned-entitlement and operator-managed workflows so both use one
PASS contract.
"""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys

SHA40 = re.compile(r"^[0-9a-f]{40}$")
FORBIDDEN_KEYS = frozenset((
    "password",
    "access_token",
    "refresh_token",
    "cookie",
    "memory_id",
    "subject_id",
    "account_email",
))


def validate_receipt(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("receipt must be a JSON object")

    required = {
        "$schema": "prototype-ordax.cloud-memory-authenticated-proof/1",
        "status": "pass",
        "proof_scope": "dedicated-non-admin-account-two-independent-sessions",
        "entitlement_preexisted": True,
        "entitlement_created_by_proof": False,
        "client_sessions_independent": True,
        "same_account_verified": True,
        "client_b_entitlement_preexisted": True,
        "client_b_create_seen": True,
        "client_b_edit_seen": True,
        "client_b_runtime_payload_contract_seen": True,
        "client_b_stale_conflict_rejected": True,
        "client_b_delete_tombstone_seen": True,
        "client_b_identity_only_tombstone_seen": True,
        "client_b_canonical_deleted_seen": True,
        "direct_memory_table_write_used": False,
        "service_role_used": False,
        "create_revision": 1,
        "edit_revision": 2,
        "delete_revision": 3,
        "stale_revision_conflict_rejected": True,
        "tombstone_seen_in_sync": True,
        "canonical_memory_state_deleted": True,
        "credentials_persisted": False,
        "account_identifier_recorded": False,
        "memory_identifier_recorded": False,
        "memory_content_recorded": False,
        "sensitive_auth_material_recorded": False,
    }
    for key, expected in required.items():
        if value.get(key) != expected:
            raise ValueError(f"receipt field {key!r} is incompatible")

    cursors = (
        value.get("initial_cursor"),
        value.get("create_cursor"),
        value.get("edit_cursor"),
        value.get("delete_cursor"),
    )
    if any(isinstance(cursor, bool) or not isinstance(cursor, int) or cursor < 0 for cursor in cursors):
        raise ValueError("receipt cursors must be non-negative integers")
    if not (cursors[0] < cursors[1] < cursors[2] < cursors[3]):
        raise ValueError("receipt cursors must advance monotonically")

    source_commit = value.get("source_commit")
    if not isinstance(source_commit, str) or SHA40.fullmatch(source_commit) is None:
        raise ValueError("receipt source commit is invalid")

    forbidden = FORBIDDEN_KEYS.intersection(value)
    if forbidden:
        raise ValueError(f"receipt contains forbidden keys: {','.join(sorted(forbidden))}")

    return value


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        raise SystemExit("usage: validate_authenticated_proof_receipt.py RECEIPT.json")
    path = Path(argv[1])
    if not path.is_file() or path.is_symlink():
        raise SystemExit("CLOUD_MEMORY_AUTHENTICATED_RECEIPT=FAIL reason=receipt-file-invalid")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        validate_receipt(data)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise SystemExit(
            f"CLOUD_MEMORY_AUTHENTICATED_RECEIPT=FAIL reason={type(exc).__name__}"
        ) from exc
    print("CLOUD_MEMORY_AUTHENTICATED_RECEIPT=PASS_SANITIZED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
