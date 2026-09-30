#!/usr/bin/env python3
"""Validate the sanitized bidirectional/fresh-session Cloud Memory proof receipt."""

from __future__ import annotations

import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

SHA40 = re.compile(r"^[0-9a-f]{40}$")
SCHEMA = "prototype-ordax.cloud-memory-bidirectional-restore-proof/1"
REQUIRED_TRUE = {
    "entitlement_preexisted",
    "three_client_sessions_independent",
    "same_account_verified",
    "client_a_create_seen_by_b",
    "client_b_valid_edit_seen_by_a",
    "client_c_started_after_edit",
    "client_c_fresh_snapshot_restore_seen",
    "client_b_identity_only_tombstone_seen",
    "bidirectional_convergence_proven",
    "fresh_session_restore_proven",
}
REQUIRED_FALSE = {
    "entitlement_created_by_proof",
    "client_c_local_checkpoint_required",
    "direct_memory_table_write_used",
    "service_role_used",
    "credentials_persisted",
    "account_identifier_recorded",
    "memory_identifier_recorded",
    "memory_content_recorded",
    "sensitive_auth_material_recorded",
}
INTEGER_FIELDS = {
    "create_revision",
    "edit_revision",
    "delete_revision",
    "create_cursor",
    "edit_cursor",
    "delete_cursor",
    "fresh_snapshot_cursor",
}
ALLOWED_KEYS = {
    "$schema",
    "status",
    "proof_scope",
    "provider_origin",
    "source_commit",
    "workflow_run_id",
    *REQUIRED_TRUE,
    *REQUIRED_FALSE,
    *INTEGER_FIELDS,
}


def fail(reason: str) -> None:
    raise SystemExit(f"CLOUD_MEMORY_BIDIRECTIONAL_RECEIPT=FAIL reason={reason}")


def validate(path: str) -> dict:
    source = Path(path)
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        fail("receipt-unreadable")
    if not isinstance(payload, dict) or set(payload) != ALLOWED_KEYS:
        fail("receipt-shape-invalid")
    if payload.get("$schema") != SCHEMA or payload.get("status") != "pass":
        fail("receipt-status-invalid")
    if payload.get("proof_scope") != "dedicated-non-admin-account-three-independent-sessions":
        fail("receipt-scope-invalid")
    origin = payload.get("provider_origin")
    if not isinstance(origin, str):
        fail("provider-origin-invalid")
    split = urlsplit(origin)
    if split.scheme != "https" or not split.netloc or split.path or split.query or split.fragment:
        fail("provider-origin-invalid")
    source_commit = payload.get("source_commit")
    if source_commit is not None and (not isinstance(source_commit, str) or SHA40.fullmatch(source_commit) is None):
        fail("source-commit-invalid")
    run_id = payload.get("workflow_run_id")
    if run_id is not None and (not isinstance(run_id, str) or not run_id.isdigit()):
        fail("workflow-run-id-invalid")
    for key in REQUIRED_TRUE:
        if payload.get(key) is not True:
            fail(f"{key}-not-proven")
    for key in REQUIRED_FALSE:
        if payload.get(key) is not False:
            fail(f"{key}-unsafe")
    for key in INTEGER_FIELDS:
        value = payload.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            fail(f"{key}-invalid")
    if not (
        payload["create_revision"] == 1
        and payload["edit_revision"] == 2
        and payload["delete_revision"] == 3
        and payload["create_cursor"] < payload["edit_cursor"] < payload["delete_cursor"]
        and payload["fresh_snapshot_cursor"] >= payload["edit_cursor"]
    ):
        fail("revision-or-cursor-order-invalid")
    return payload


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        fail("usage")
    validate(argv[1])
    print("CLOUD_MEMORY_BIDIRECTIONAL_RECEIPT=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
