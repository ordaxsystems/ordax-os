#!/usr/bin/env python3
"""Authenticated bidirectional + fresh-session Cloud Memory proof.

This proof complements prove_authenticated_atomic_sync.py under the *same*
operator-issued temporary entitlement. It uses only publishable-key/user
sessions and proves:

1. client A creates account Memory;
2. independent client B receives it through sync and performs a valid edit;
3. client A observes B's edit through the sync stream;
4. a third session C, created only after the edit, restores the current Memory
   from a fresh account snapshot without any local cursor/checkpoint;
5. client A deletes the Memory and client B observes the identity-only
   tombstone.

No service-role authority is accepted. The optional receipt contains only
sanitized booleans/revisions/cursors and never stores account identifiers,
Memory identifiers, Memory content, credentials or access tokens.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import sys
from typing import NoReturn
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
IDENTITY_DIR = ROOT / "services" / "public-identity"
sys.path.insert(0, str(IDENTITY_DIR))

from supabase_memory import SupabaseMemoryProvider  # noqa: E402
from supabase_password import SupabasePasswordProvider  # noqa: E402
from supabase_sync import SupabaseSyncProvider  # noqa: E402

MEMORY_SCHEMA = "ordax.memory/1"
MEMORY_SYNC_SCHEMA = "ordax.memory-sync-payload/1"
PROVENANCE = "ordax-cloud-memory-bidirectional-restore-proof/1"


def fail(reason: str) -> NoReturn:
    raise SystemExit(f"CLOUD_MEMORY_BIDIRECTIONAL_RESTORE_PROOF=FAIL reason={reason}")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        fail(f"missing-{name.lower()}")
    return value


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def validate_active_object(item: dict, *, memory_id: str, owner_id: str, revision: int, content: str) -> None:
    if (
        item.get("objectId") != memory_id
        or item.get("dataClass") != "memory"
        or item.get("serverRevision") != revision
        or item.get("tombstone") is not False
    ):
        fail("active-memory-object-identity-invalid")
    payload = item.get("payload")
    if not isinstance(payload, dict) or set(payload) != {"schema", "memory"}:
        fail("active-memory-envelope-invalid")
    memory = payload.get("memory")
    expected_keys = {
        "schema", "id", "ownerKind", "ownerId", "scope", "kind",
        "sensitivity", "content", "provenance", "sourceTimestamp",
        "spaceId", "projectId",
    }
    if not isinstance(memory, dict) or set(memory) != expected_keys:
        fail("active-memory-shape-invalid")
    if (
        payload.get("schema") != MEMORY_SYNC_SCHEMA
        or memory.get("schema") != MEMORY_SCHEMA
        or memory.get("id") != memory_id
        or memory.get("ownerKind") != "account"
        or memory.get("ownerId") != owner_id
        or memory.get("scope") != "account"
        or memory.get("kind") != "fact"
        or memory.get("sensitivity") != "private"
        or memory.get("content") != content
        or memory.get("provenance") != PROVENANCE
        or memory.get("spaceId") is not None
        or memory.get("projectId") is not None
        or not isinstance(memory.get("sourceTimestamp"), str)
        or not memory.get("sourceTimestamp")
    ):
        fail("active-memory-authority-invalid")


def validate_tombstone(item: dict, *, memory_id: str, owner_id: str, revision: int) -> None:
    if (
        item.get("objectId") != memory_id
        or item.get("dataClass") != "memory"
        or item.get("serverRevision") != revision
        or item.get("tombstone") is not True
    ):
        fail("tombstone-object-identity-invalid")
    payload = item.get("payload")
    if not isinstance(payload, dict) or set(payload) != {"schema", "memoryIdentity"}:
        fail("tombstone-envelope-invalid")
    identity = payload.get("memoryIdentity")
    if (
        payload.get("schema") != MEMORY_SYNC_SCHEMA
        or not isinstance(identity, dict)
        or set(identity) != {"id", "ownerKind", "ownerId"}
        or identity.get("id") != memory_id
        or identity.get("ownerKind") != "account"
        or identity.get("ownerId") != owner_id
    ):
        fail("tombstone-authority-invalid")


def one_matching(items: list[dict], memory_id: str, revision: int) -> dict:
    matches = [
        item for item in items
        if item.get("objectId") == memory_id
        and item.get("dataClass") == "memory"
        and item.get("serverRevision") == revision
    ]
    if len(matches) != 1:
        fail(f"memory-revision-{revision}-not-delivered-exactly-once")
    return matches[0]


def write_receipt(
    path: str,
    project_url: str,
    *,
    create_revision: int,
    edit_revision: int,
    delete_revision: int,
    create_cursor: int,
    edit_cursor: int,
    delete_cursor: int,
    fresh_snapshot_cursor: int,
) -> None:
    if not path:
        return
    split = urlsplit(project_url)
    source_commit = os.environ.get("GITHUB_SHA", "").strip().lower()
    if len(source_commit) != 40:
        source_commit = None
    else:
        try:
            int(source_commit, 16)
        except ValueError:
            source_commit = None
    payload = {
        "$schema": "prototype-ordax.cloud-memory-bidirectional-restore-proof/1",
        "status": "pass",
        "proof_scope": "dedicated-non-admin-account-three-independent-sessions",
        "provider_origin": f"{split.scheme}://{split.netloc}",
        "source_commit": source_commit,
        "workflow_run_id": os.environ.get("GITHUB_RUN_ID") or None,
        "entitlement_preexisted": True,
        "entitlement_created_by_proof": False,
        "three_client_sessions_independent": True,
        "same_account_verified": True,
        "client_a_create_seen_by_b": True,
        "client_b_valid_edit_seen_by_a": True,
        "client_c_started_after_edit": True,
        "client_c_fresh_snapshot_restore_seen": True,
        "client_c_local_checkpoint_required": False,
        "client_b_identity_only_tombstone_seen": True,
        "bidirectional_convergence_proven": True,
        "fresh_session_restore_proven": True,
        "direct_memory_table_write_used": False,
        "service_role_used": False,
        "create_revision": create_revision,
        "edit_revision": edit_revision,
        "delete_revision": delete_revision,
        "create_cursor": create_cursor,
        "edit_cursor": edit_cursor,
        "delete_cursor": delete_cursor,
        "fresh_snapshot_cursor": fresh_snapshot_cursor,
        "credentials_persisted": False,
        "account_identifier_recorded": False,
        "memory_identifier_recorded": False,
        "memory_content_recorded": False,
        "sensitive_auth_material_recorded": False,
    }
    output = Path(path).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(f".{output.name}.tmp-{os.getpid()}")
    temp.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    os.replace(temp, output)


def main() -> int:
    project_url = required_env("ORDAX_SUPABASE_URL")
    publishable_key = required_env("ORDAX_SUPABASE_PUBLISHABLE_KEY")
    email = required_env("ORDAX_MEMORY_PROOF_ACCOUNT_EMAIL")
    password = required_env("ORDAX_MEMORY_PROOF_ACCOUNT_PASSWORD")

    identity_a = SupabasePasswordProvider(project_url, publishable_key)
    identity_b = SupabasePasswordProvider(project_url, publishable_key)
    identity_c = SupabasePasswordProvider(project_url, publishable_key)
    memory_a = SupabaseMemoryProvider(project_url, publishable_key)
    memory_b = SupabaseMemoryProvider(project_url, publishable_key)
    memory_c = SupabaseMemoryProvider(project_url, publishable_key)
    sync_a = SupabaseSyncProvider(project_url, publishable_key)
    sync_b = SupabaseSyncProvider(project_url, publishable_key)
    sync_c = SupabaseSyncProvider(project_url, publishable_key)

    tokens: list[tuple[SupabasePasswordProvider, str]] = []
    memory_id: str | None = None
    cleanup_revision: int | None = None
    deleted = False

    try:
        auth_a = identity_a.sign_in_with_password(email, password)
        auth_b = identity_b.sign_in_with_password(email, password)
        if auth_a.session is None or auth_b.session is None:
            fail("initial-session-missing")
        if auth_a.subject_id != auth_b.subject_id:
            fail("initial-subject-mismatch")
        owner_id = auth_a.subject_id
        token_a = auth_a.session.access_token
        token_b = auth_b.session.access_token
        if token_a == token_b:
            fail("initial-sessions-not-independent")
        tokens.extend(((identity_a, token_a), (identity_b, token_b)))
        if not memory_a.has_account_cloud_entitlement(token_a) or not memory_b.has_account_cloud_entitlement(token_b):
            fail("entitlement-not-preprovisioned-for-initial-clients")

        baseline_a = sync_a.snapshot(token_a, limit=500)
        baseline_b = sync_b.snapshot(token_b, limit=500)
        unique = secrets.token_hex(18)
        create_content = f"OrdaX bidirectional restore proof {unique}"
        created = memory_a.apply(
            token_a,
            idempotency_key=f"memory-bidir-create-{unique}",
            memory_id=None,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content=create_content,
            provenance=PROVENANCE,
            source_timestamp=iso_now(),
            confidence=1.0,
            base_server_revision=0,
            tombstone=False,
        )
        if (
            not created.applied or created.conflict or created.tombstone
            or created.server_revision != 1 or not isinstance(created.change_cursor, int)
            or created.change_cursor <= baseline_b["cursor"]
            or created.change_cursor <= baseline_a["cursor"]
        ):
            fail("create-result-invalid")
        memory_id = created.memory_id
        cleanup_revision = created.server_revision
        if not memory_id:
            fail("create-memory-id-missing")

        delivered_to_b = sync_b.pull_changes(token_b, after_cursor=baseline_b["cursor"], limit=500)
        create_item = one_matching(delivered_to_b["changes"], memory_id, 1)
        validate_active_object(create_item, memory_id=memory_id, owner_id=owner_id, revision=1, content=create_content)
        if create_item.get("cursor") != created.change_cursor:
            fail("create-cursor-mismatch")

        edit_content = f"OrdaX bidirectional restore proof edited by B {unique}"
        edited = memory_b.apply(
            token_b,
            idempotency_key=f"memory-bidir-edit-{unique}",
            memory_id=memory_id,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content=edit_content,
            provenance=PROVENANCE,
            source_timestamp=iso_now(),
            confidence=1.0,
            base_server_revision=created.server_revision,
            tombstone=False,
        )
        if (
            not edited.applied or edited.conflict or edited.tombstone
            or edited.server_revision != 2 or not isinstance(edited.change_cursor, int)
            or edited.change_cursor <= created.change_cursor
        ):
            fail("client-b-valid-edit-invalid")
        cleanup_revision = edited.server_revision

        delivered_to_a = sync_a.pull_changes(token_a, after_cursor=created.change_cursor, limit=500)
        edit_item = one_matching(delivered_to_a["changes"], memory_id, 2)
        validate_active_object(edit_item, memory_id=memory_id, owner_id=owner_id, revision=2, content=edit_content)
        if edit_item.get("cursor") != edited.change_cursor:
            fail("edit-cursor-mismatch")

        # Client C is created only after B's committed edit and has no local
        # checkpoint/cursor. Its first operation is the canonical account snapshot.
        auth_c = identity_c.sign_in_with_password(email, password)
        if auth_c.session is None or auth_c.subject_id != owner_id:
            fail("fresh-client-subject-invalid")
        token_c = auth_c.session.access_token
        if token_c in {token_a, token_b}:
            fail("fresh-client-session-not-independent")
        tokens.append((identity_c, token_c))
        if not memory_c.has_account_cloud_entitlement(token_c):
            fail("fresh-client-entitlement-not-preprovisioned")
        fresh_snapshot = sync_c.snapshot(token_c, limit=500)
        fresh_item = one_matching(fresh_snapshot["objects"], memory_id, 2)
        validate_active_object(fresh_item, memory_id=memory_id, owner_id=owner_id, revision=2, content=edit_content)
        if fresh_snapshot["cursor"] < edited.change_cursor:
            fail("fresh-snapshot-cursor-before-edit")
        canonical_c = memory_c.read_state(token_c, memory_id)
        if (
            canonical_c.get("state") != "active"
            or canonical_c.get("scope") != "account"
            or canonical_c.get("sensitivity") != "private"
        ):
            fail("fresh-client-canonical-memory-not-restored")

        removed = memory_a.apply(
            token_a,
            idempotency_key=f"memory-bidir-delete-{unique}",
            memory_id=memory_id,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content="deleted-proof-placeholder",
            provenance=PROVENANCE,
            source_timestamp=iso_now(),
            confidence=1.0,
            base_server_revision=edited.server_revision,
            tombstone=True,
        )
        if (
            not removed.applied or removed.conflict or not removed.tombstone
            or removed.server_revision != 3 or not isinstance(removed.change_cursor, int)
            or removed.change_cursor <= edited.change_cursor
        ):
            fail("delete-result-invalid")
        deleted = True
        cleanup_revision = removed.server_revision

        delete_delivery = sync_b.pull_changes(token_b, after_cursor=edited.change_cursor, limit=500)
        delete_item = one_matching(delete_delivery["changes"], memory_id, 3)
        validate_tombstone(delete_item, memory_id=memory_id, owner_id=owner_id, revision=3)
        if delete_item.get("cursor") != removed.change_cursor:
            fail("delete-cursor-mismatch")

        write_receipt(
            os.environ.get("ORDAX_MEMORY_BIDIRECTIONAL_PROOF_RECEIPT_PATH", "").strip(),
            project_url,
            create_revision=created.server_revision,
            edit_revision=edited.server_revision,
            delete_revision=removed.server_revision,
            create_cursor=created.change_cursor,
            edit_cursor=edited.change_cursor,
            delete_cursor=removed.change_cursor,
            fresh_snapshot_cursor=fresh_snapshot["cursor"],
        )
        print(
            "CLOUD_MEMORY_BIDIRECTIONAL_RESTORE_PROOF=PASS "
            "a_to_b=YES b_to_a=YES fresh_client_restore=YES identity_only_tombstone=YES"
        )
        return 0
    finally:
        if memory_id is not None and not deleted and cleanup_revision is not None and tokens:
            try:
                memory_a.apply(
                    tokens[0][1],
                    idempotency_key=f"memory-bidir-cleanup-{secrets.token_hex(18)}",
                    memory_id=memory_id,
                    scope="account",
                    space_id=None,
                    kind="fact",
                    sensitivity="private",
                    content="cleanup-proof-placeholder",
                    provenance=PROVENANCE,
                    source_timestamp=iso_now(),
                    confidence=1.0,
                    base_server_revision=cleanup_revision,
                    tombstone=True,
                )
            except Exception:
                print("CLOUD_MEMORY_BIDIRECTIONAL_RESTORE_CLEANUP=FAIL", file=sys.stderr)
        for identity, token in reversed(tokens):
            try:
                identity.sign_out(token)
            except Exception:
                print("CLOUD_MEMORY_BIDIRECTIONAL_RESTORE_SIGNOUT=FAIL", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
