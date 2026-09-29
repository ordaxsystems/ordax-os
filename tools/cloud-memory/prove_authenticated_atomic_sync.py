#!/usr/bin/env python3
"""Manual two-client authenticated proof for atomic cloud Memory + sync.

The proof signs the same dedicated non-admin account into two independent
sessions. Client A mutates canonical Memory; Client B proves delivery through
the sync stream, attempts a stale concurrent edit, and observes the final
tombstone/canonical deleted state.

The memory.cloud.enabled entitlement must already exist. This proof never
creates grants, never uses service-role authority, never prints credentials or
tokens, and writes only a sanitized receipt.
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


def fail(reason: str) -> NoReturn:
    raise SystemExit(f"CLOUD_MEMORY_AUTHENTICATED_PROOF=FAIL reason={reason}")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        fail(f"missing-{name.lower()}")
    return value


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def memory_change(
    delivered: dict,
    *,
    memory_id: str,
    revision: int,
    tombstone: bool,
    expected_cursor: int,
) -> dict:
    changes = delivered.get("changes")
    if not isinstance(changes, list):
        fail("client-b-sync-response-invalid")
    matches = [
        item
        for item in changes
        if item.get("objectId") == memory_id
        and item.get("dataClass") == "memory"
        and item.get("serverRevision") == revision
    ]
    if len(matches) != 1:
        fail(f"client-b-memory-revision-{revision}-not-delivered")
    item = matches[0]
    if item.get("tombstone") is not tombstone:
        fail(f"client-b-memory-revision-{revision}-tombstone-invalid")
    if item.get("cursor") != expected_cursor:
        fail(f"client-b-memory-revision-{revision}-cursor-mismatch")
    return item


def write_receipt(
    path: str,
    project_url: str,
    *,
    initial_cursor: int,
    create_revision: int,
    edit_revision: int,
    delete_revision: int,
    create_cursor: int,
    edit_cursor: int,
    delete_cursor: int,
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
        "$schema": "prototype-ordax.cloud-memory-authenticated-proof/1",
        "status": "pass",
        "proof_scope": "dedicated-non-admin-account-two-independent-sessions",
        "provider_origin": f"{split.scheme}://{split.netloc}",
        "source_commit": source_commit,
        "workflow_run_id": os.environ.get("GITHUB_RUN_ID") or None,
        "entitlement_preexisted": True,
        "entitlement_created_by_proof": False,
        "client_sessions_independent": True,
        "same_account_verified": True,
        "client_b_entitlement_preexisted": True,
        "client_b_create_seen": True,
        "client_b_edit_seen": True,
        "client_b_stale_conflict_rejected": True,
        "client_b_delete_tombstone_seen": True,
        "client_b_canonical_deleted_seen": True,
        "direct_memory_table_write_used": False,
        "service_role_used": False,
        "create_revision": create_revision,
        "edit_revision": edit_revision,
        "delete_revision": delete_revision,
        "initial_cursor": initial_cursor,
        "create_cursor": create_cursor,
        "edit_cursor": edit_cursor,
        "delete_cursor": delete_cursor,
        "stale_revision_conflict_rejected": True,
        "tombstone_seen_in_sync": True,
        "canonical_memory_state_deleted": True,
        "credentials_persisted": False,
        "account_identifier_recorded": False,
        "memory_identifier_recorded": False,
        "memory_content_recorded": False,
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
    project_url = required_env("ORDAX_SUPABASE_URL")
    publishable_key = required_env("ORDAX_SUPABASE_PUBLISHABLE_KEY")
    email = required_env("ORDAX_MEMORY_PROOF_ACCOUNT_EMAIL")
    password = required_env("ORDAX_MEMORY_PROOF_ACCOUNT_PASSWORD")

    identity_a = SupabasePasswordProvider(project_url, publishable_key)
    identity_b = SupabasePasswordProvider(project_url, publishable_key)
    memory_a = SupabaseMemoryProvider(project_url, publishable_key)
    memory_b = SupabaseMemoryProvider(project_url, publishable_key)
    sync_b = SupabaseSyncProvider(project_url, publishable_key)

    token_a: str | None = None
    token_b: str | None = None
    memory_id: str | None = None
    cleanup_revision: int | None = None
    deleted = False

    try:
        auth_a = identity_a.sign_in_with_password(email, password)
        auth_b = identity_b.sign_in_with_password(email, password)
        if auth_a.session is None or auth_b.session is None:
            fail("session-missing")
        if auth_a.subject_id != auth_b.subject_id:
            fail("same-account-subject-mismatch")

        token_a = auth_a.session.access_token
        token_b = auth_b.session.access_token
        if token_a == token_b:
            fail("sessions-not-independent")

        if not memory_a.has_account_cloud_entitlement(token_a):
            fail("memory-cloud-entitlement-not-preprovisioned-client-a")
        if not memory_b.has_account_cloud_entitlement(token_b):
            fail("memory-cloud-entitlement-not-preprovisioned-client-b")

        before_b = sync_b.snapshot(token_b, limit=500)
        initial_cursor = before_b["cursor"]

        unique = secrets.token_hex(18)
        created = memory_a.apply(
            token_a,
            idempotency_key=f"memory-proof-create-{unique}",
            memory_id=None,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content=f"OrdaX cloud Memory two-client proof {unique}",
            provenance="ordax-cloud-memory-authenticated-proof/1",
            source_timestamp=iso_now(),
            confidence=1.0,
            base_server_revision=0,
            tombstone=False,
        )
        if created.applied and not created.conflict and not created.tombstone:
            memory_id = created.memory_id
            cleanup_revision = created.server_revision
        if (
            not created.applied
            or created.conflict
            or created.tombstone
            or created.server_revision != 1
            or not isinstance(created.change_cursor, int)
            or created.change_cursor <= initial_cursor
            or memory_id is None
        ):
            fail("create-result-invalid")

        create_delivery = sync_b.pull_changes(
            token_b,
            after_cursor=initial_cursor,
            limit=500,
        )
        create_seen = memory_change(
            create_delivery,
            memory_id=memory_id,
            revision=1,
            tombstone=False,
            expected_cursor=created.change_cursor,
        )

        edited = memory_a.apply(
            token_a,
            idempotency_key=f"memory-proof-edit-{unique}",
            memory_id=memory_id,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content=f"OrdaX cloud Memory two-client proof edited {unique}",
            provenance="ordax-cloud-memory-authenticated-proof/1",
            source_timestamp=iso_now(),
            confidence=1.0,
            base_server_revision=created.server_revision,
            tombstone=False,
        )
        if edited.applied and not edited.conflict and not edited.tombstone:
            cleanup_revision = edited.server_revision
        if (
            not edited.applied
            or edited.conflict
            or edited.tombstone
            or edited.server_revision != 2
            or not isinstance(edited.change_cursor, int)
            or edited.change_cursor <= created.change_cursor
        ):
            fail("edit-result-invalid")

        edit_delivery = sync_b.pull_changes(
            token_b,
            after_cursor=create_seen["cursor"],
            limit=500,
        )
        edit_seen = memory_change(
            edit_delivery,
            memory_id=memory_id,
            revision=2,
            tombstone=False,
            expected_cursor=edited.change_cursor,
        )

        stale = memory_b.apply(
            token_b,
            idempotency_key=f"memory-proof-stale-{unique}",
            memory_id=memory_id,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content=f"OrdaX cloud Memory client B stale edit {unique}",
            provenance="ordax-cloud-memory-authenticated-proof/1",
            source_timestamp=iso_now(),
            confidence=1.0,
            base_server_revision=created.server_revision,
            tombstone=False,
        )
        if (
            stale.applied
            or not stale.conflict
            or stale.server_revision != edited.server_revision
            or stale.change_cursor is not None
        ):
            fail("client-b-stale-revision-not-rejected")

        removed = memory_a.apply(
            token_a,
            idempotency_key=f"memory-proof-delete-{unique}",
            memory_id=memory_id,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content="deleted-proof-placeholder",
            provenance="ordax-cloud-memory-authenticated-proof/1",
            source_timestamp=iso_now(),
            confidence=1.0,
            base_server_revision=edited.server_revision,
            tombstone=True,
        )
        if removed.applied and not removed.conflict and removed.tombstone:
            deleted = True
            cleanup_revision = removed.server_revision
        if (
            not removed.applied
            or removed.conflict
            or not removed.tombstone
            or removed.server_revision != 3
            or not isinstance(removed.change_cursor, int)
            or removed.change_cursor <= edited.change_cursor
        ):
            fail("delete-result-invalid")

        delete_delivery = sync_b.pull_changes(
            token_b,
            after_cursor=edit_seen["cursor"],
            limit=500,
        )
        memory_change(
            delete_delivery,
            memory_id=memory_id,
            revision=3,
            tombstone=True,
            expected_cursor=removed.change_cursor,
        )

        state = memory_b.read_state(token_b, memory_id)
        if (
            state.get("state") != "deleted"
            or state.get("scope") != "account"
            or state.get("sensitivity") != "private"
        ):
            fail("client-b-canonical-memory-delete-state-invalid")

        write_receipt(
            os.environ.get("ORDAX_MEMORY_PROOF_RECEIPT_PATH", "").strip(),
            project_url,
            initial_cursor=initial_cursor,
            create_revision=created.server_revision,
            edit_revision=edited.server_revision,
            delete_revision=removed.server_revision,
            create_cursor=created.change_cursor,
            edit_cursor=edited.change_cursor,
            delete_cursor=removed.change_cursor,
        )
        print(
            "CLOUD_MEMORY_AUTHENTICATED_PROOF=PASS "
            "two_clients=YES "
            f"create_revision={created.server_revision} "
            f"edit_revision={edited.server_revision} "
            f"delete_revision={removed.server_revision}"
        )
        return 0
    finally:
        if (
            token_a is not None
            and memory_id is not None
            and not deleted
            and cleanup_revision is not None
        ):
            try:
                memory_a.apply(
                    token_a,
                    idempotency_key=f"memory-proof-cleanup-{secrets.token_hex(18)}",
                    memory_id=memory_id,
                    scope="account",
                    space_id=None,
                    kind="fact",
                    sensitivity="private",
                    content="cleanup-proof-placeholder",
                    provenance="ordax-cloud-memory-authenticated-proof/1",
                    source_timestamp=iso_now(),
                    confidence=1.0,
                    base_server_revision=cleanup_revision,
                    tombstone=True,
                )
            except Exception as exc:
                print(
                    f"CLOUD_MEMORY_AUTHENTICATED_PROOF_CLEANUP=FAIL type={type(exc).__name__}",
                    file=sys.stderr,
                )
        for identity, token, label in (
            (identity_b, token_b, "B"),
            (identity_a, token_a, "A"),
        ):
            if token is None:
                continue
            try:
                identity.sign_out(token)
            except Exception:
                print(
                    f"CLOUD_MEMORY_AUTHENTICATED_PROOF_SIGNOUT_{label}=FAIL",
                    file=sys.stderr,
                )


if __name__ == "__main__":
    raise SystemExit(main())
