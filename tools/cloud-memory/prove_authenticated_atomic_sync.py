#!/usr/bin/env python3
"""Manual authenticated proof for atomic cloud Memory + sync.

The proof requires a dedicated non-admin account whose memory.cloud.enabled
entitlement was provisioned before the run. It never creates grants, never uses
service-role authority, never prints credentials/tokens and writes only a
sanitized receipt.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
IDENTITY_DIR = ROOT / "services" / "public-identity"
sys.path.insert(0, str(IDENTITY_DIR))

from supabase_memory import SupabaseMemoryProvider  # noqa: E402
from supabase_password import SupabasePasswordProvider  # noqa: E402
from supabase_sync import SupabaseSyncProvider  # noqa: E402


def fail(reason: str) -> "NoReturn":
    raise SystemExit(f"CLOUD_MEMORY_AUTHENTICATED_PROOF=FAIL reason={reason}")


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        fail(f"missing-{name.lower()}")
    return value


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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
        "proof_scope": "dedicated-non-admin-account-account-memory",
        "provider_origin": f"{split.scheme}://{split.netloc}",
        "source_commit": source_commit,
        "workflow_run_id": os.environ.get("GITHUB_RUN_ID") or None,
        "entitlement_preexisted": True,
        "entitlement_created_by_proof": False,
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

    identity = SupabasePasswordProvider(project_url, publishable_key)
    memory = SupabaseMemoryProvider(project_url, publishable_key)
    sync = SupabaseSyncProvider(project_url, publishable_key)

    auth = identity.sign_in_with_password(email, password)
    if auth.session is None:
        fail("session-missing")
    token = auth.session.access_token

    memory_id: str | None = None
    cleanup_revision: int | None = None
    deleted = False
    try:
        if not memory.has_account_cloud_entitlement(token):
            fail("memory-cloud-entitlement-not-preprovisioned")

        before = sync.snapshot(token, limit=500)
        initial_cursor = before["cursor"]

        unique = secrets.token_hex(18)
        created = memory.apply(
            token,
            idempotency_key=f"memory-proof-create-{unique}",
            memory_id=None,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content=f"OrdaX cloud Memory authenticated proof {unique}",
            provenance="ordax-cloud-memory-authenticated-proof/1",
            source_timestamp=iso_now(),
            confidence=1.0,
            base_server_revision=0,
            tombstone=False,
        )
        if (
            not created.applied
            or created.conflict
            or created.tombstone
            or created.server_revision != 1
            or not isinstance(created.change_cursor, int)
            or created.change_cursor <= initial_cursor
        ):
            fail("create-result-invalid")
        memory_id = created.memory_id
        cleanup_revision = created.server_revision

        edited = memory.apply(
            token,
            idempotency_key=f"memory-proof-edit-{unique}",
            memory_id=memory_id,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content=f"OrdaX cloud Memory authenticated proof edited {unique}",
            provenance="ordax-cloud-memory-authenticated-proof/1",
            source_timestamp=iso_now(),
            confidence=1.0,
            base_server_revision=created.server_revision,
            tombstone=False,
        )
        if (
            not edited.applied
            or edited.conflict
            or edited.tombstone
            or edited.server_revision != 2
            or not isinstance(edited.change_cursor, int)
            or edited.change_cursor <= created.change_cursor
        ):
            fail("edit-result-invalid")
        cleanup_revision = edited.server_revision

        stale = memory.apply(
            token,
            idempotency_key=f"memory-proof-stale-{unique}",
            memory_id=memory_id,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content=f"OrdaX cloud Memory stale edit {unique}",
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
            fail("stale-revision-not-rejected")

        removed = memory.apply(
            token,
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
        if (
            not removed.applied
            or removed.conflict
            or not removed.tombstone
            or removed.server_revision != 3
            or not isinstance(removed.change_cursor, int)
            or removed.change_cursor <= edited.change_cursor
        ):
            fail("delete-result-invalid")
        deleted = True
        cleanup_revision = removed.server_revision

        delivered = sync.pull_changes(token, after_cursor=initial_cursor, limit=500)
        matches = [
            item
            for item in delivered["changes"]
            if item.get("objectId") == memory_id and item.get("dataClass") == "memory"
        ]
        by_revision = {item.get("serverRevision"): item for item in matches}
        if set(by_revision) != {1, 2, 3}:
            fail("memory-revisions-not-delivered")
        if by_revision[1].get("tombstone") is not False:
            fail("create-sync-state-invalid")
        if by_revision[2].get("tombstone") is not False:
            fail("edit-sync-state-invalid")
        if by_revision[3].get("tombstone") is not True:
            fail("delete-tombstone-not-delivered")

        state = memory.read_state(token, memory_id)
        if (
            state.get("state") != "deleted"
            or state.get("scope") != "account"
            or state.get("sensitivity") != "private"
        ):
            fail("canonical-memory-delete-state-invalid")

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
            f"create_revision={created.server_revision} "
            f"edit_revision={edited.server_revision} "
            f"delete_revision={removed.server_revision}"
        )
        return 0
    finally:
        if memory_id is not None and not deleted and cleanup_revision is not None:
            try:
                memory.apply(
                    token,
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
        try:
            identity.sign_out(token)
        except Exception:
            print("CLOUD_MEMORY_AUTHENTICATED_PROOF_SIGNOUT=FAIL", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
