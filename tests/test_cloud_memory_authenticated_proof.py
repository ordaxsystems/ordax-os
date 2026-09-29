#!/usr/bin/env python3
"""Regression guards for authenticated cloud Memory proof/provider."""

from __future__ import annotations

import importlib.util
import json
from datetime import datetime, timezone
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROVIDER_PATH = ROOT / "services" / "public-identity" / "supabase_memory.py"
PROOF = ROOT / "tools" / "cloud-memory" / "prove_authenticated_atomic_sync.py"
WORKFLOW = ROOT / ".github" / "workflows" / "cloud-memory-authenticated-proof.yml"
PROOF_SPEC = importlib.util.spec_from_file_location("ordax_cloud_memory_proof", PROOF)
proof_module = importlib.util.module_from_spec(PROOF_SPEC)
assert PROOF_SPEC.loader is not None
PROOF_SPEC.loader.exec_module(proof_module)

spec = importlib.util.spec_from_file_location("ordax_supabase_memory", PROVIDER_PATH)
memory_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = memory_module
spec.loader.exec_module(memory_module)
SupabaseMemoryProvider = memory_module.SupabaseMemoryProvider


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, headers, body):
        self.calls.append((method, url, dict(headers), body))
        return self.responses.pop(0)


class CloudMemoryAuthenticatedProofTests(unittest.TestCase):
    def test_provider_uses_only_publishable_key_and_user_bearer_for_atomic_rpc(self):
        transport = FakeTransport(
            [
                (
                    200,
                    json.dumps(
                        [
                            {
                                "memory_id": "11111111-1111-1111-1111-111111111111",
                                "server_revision": 1,
                                "tombstone": False,
                                "applied": True,
                                "conflict": False,
                                "change_cursor": 41,
                            }
                        ]
                    ).encode(),
                )
            ]
        )
        provider = SupabaseMemoryProvider(
            "https://example.supabase.co",
            "sb_publishable_1234567890",
            transport=transport,
        )
        result = provider.apply(
            "user-access-token",
            idempotency_key="proof-create-12345678",
            memory_id=None,
            scope="account",
            space_id=None,
            kind="fact",
            sensitivity="private",
            content="proof",
            provenance="proof/1",
            source_timestamp="2026-09-29T00:00:00Z",
            confidence=1.0,
            base_server_revision=0,
            tombstone=False,
        )
        self.assertTrue(result.applied)
        self.assertFalse(result.conflict)
        self.assertEqual(result.server_revision, 1)
        method, url, headers, body = transport.calls[0]
        self.assertEqual(method, "POST")
        self.assertTrue(url.endswith("/rest/v1/rpc/ordax_apply_memory_mutation_v1"))
        self.assertEqual(headers["apikey"], "sb_publishable_1234567890")
        self.assertEqual(headers["Authorization"], "Bearer user-access-token")
        payload = json.loads(body)
        self.assertEqual(payload["p_scope"], "account")
        self.assertEqual(payload["p_base_server_revision"], 0)
        self.assertNotIn("owner_user_id", payload)

    def test_entitlement_check_is_read_only_and_requires_active_window(self):
        now = datetime(2026, 9, 29, 19, 0, tzinfo=timezone.utc)
        transport = FakeTransport(
            [
                (
                    200,
                    json.dumps(
                        [
                            {
                                "entitlement_value": {"decision": "allowed"},
                                "valid_from": "2026-09-01T00:00:00Z",
                                "valid_until": "2026-10-01T00:00:00+00:00",
                            }
                        ]
                    ).encode(),
                )
            ]
        )
        provider = SupabaseMemoryProvider(
            "https://example.supabase.co",
            "sb_publishable_1234567890",
            transport=transport,
        )
        self.assertTrue(
            provider.has_account_cloud_entitlement("user-access-token", now=now)
        )
        method, url, _, body = transport.calls[0]
        self.assertEqual(method, "GET")
        self.assertIn("/rest/v1/ordax_entitlement_grants?", url)
        self.assertIn("memory.cloud.enabled", url)
        self.assertIsNone(body)

    def test_entitlement_preflight_rejects_expired_future_and_malformed_windows(self):
        now = datetime(2026, 9, 29, 19, 0, tzinfo=timezone.utc)
        rows = [
            {
                "entitlement_value": {"decision": "allowed"},
                "valid_from": "2026-09-01T00:00:00Z",
                "valid_until": "2026-09-29T18:59:59Z",
            },
            {
                "entitlement_value": {"decision": "allowed"},
                "valid_from": "2026-09-29T19:00:01Z",
                "valid_until": None,
            },
        ]
        provider = SupabaseMemoryProvider(
            "https://example.supabase.co",
            "sb_publishable_1234567890",
            transport=FakeTransport([(200, json.dumps(rows).encode())]),
        )
        self.assertFalse(
            provider.has_account_cloud_entitlement("user-access-token", now=now)
        )

        malformed = SupabaseMemoryProvider(
            "https://example.supabase.co",
            "sb_publishable_1234567890",
            transport=FakeTransport([(
                200,
                json.dumps([{
                    "entitlement_value": {"decision": "allowed"},
                    "valid_from": "not-a-timestamp",
                    "valid_until": None,
                }]).encode(),
            )]),
        )
        with self.assertRaises(memory_module.SupabaseMemoryError):
            malformed.has_account_cloud_entitlement("user-access-token", now=now)

    def test_manual_proof_uses_two_independent_sessions_without_admin_authority(self):
        text = PROOF.read_text(encoding="utf-8")
        lower = text.lower()
        self.assertIn("identity_a.sign_in_with_password", text)
        self.assertIn("identity_b.sign_in_with_password", text)
        self.assertIn("same-account-subject-mismatch", text)
        self.assertIn("sessions-not-independent", text)
        self.assertIn("memory_a.has_account_cloud_entitlement(token_a)", text)
        self.assertIn("memory_b.has_account_cloud_entitlement(token_b)", text)
        self.assertIn("sync_b.pull_changes", text)
        self.assertIn("stale = memory_b.apply", text)
        self.assertIn("client-b-stale-revision-not-rejected", text)
        self.assertIn("client-b-canonical-memory-delete-state-invalid", text)
        self.assertIn('MEMORY_SYNC_SCHEMA = "ordax.memory-sync-payload/1"', text)
        self.assertIn('MEMORY_SCHEMA = "ordax.memory/1"', text)
        self.assertIn("client-b-memory-tombstone-envelope-invalid", text)
        self.assertIn("client-b-memory-active-authority-invalid", text)
        self.assertNotIn("supabase_service_role_key", lower)
        self.assertIn('"service_role_used": False', text)
        self.assertNotIn("ordax_entitlement_grants", lower)
        self.assertNotIn("insert into", lower)
        self.assertNotIn("update public.ordax_memory_items", lower)
        self.assertNotIn("delete from", lower)

    @staticmethod
    def _active_change(*, cursor: int = 44) -> dict:
        return {
            "objectId": "11111111-1111-1111-1111-111111111111",
            "dataClass": "memory",
            "serverRevision": 2,
            "tombstone": False,
            "cursor": cursor,
            "payload": {
                "schema": "ordax.memory-sync-payload/1",
                "memory": {
                    "schema": "ordax.memory/1",
                    "id": "11111111-1111-1111-1111-111111111111",
                    "ownerKind": "account",
                    "ownerId": "22222222-2222-2222-2222-222222222222",
                    "scope": "account",
                    "kind": "fact",
                    "sensitivity": "private",
                    "content": "proof-content",
                    "provenance": "ordax-cloud-memory-authenticated-proof/1",
                    "sourceTimestamp": "2026-09-29T00:00:00Z",
                    "spaceId": None,
                    "projectId": None,
                },
            },
        }

    def test_client_b_change_validation_binds_revision_cursor_and_runtime_payload(self):
        delivered = {"changes": [self._active_change()]}
        item = proof_module.memory_change(
            delivered,
            memory_id="11111111-1111-1111-1111-111111111111",
            owner_id="22222222-2222-2222-2222-222222222222",
            revision=2,
            tombstone=False,
            expected_cursor=44,
            expected_content="proof-content",
        )
        self.assertEqual(item["cursor"], 44)

        with self.assertRaises(SystemExit):
            proof_module.memory_change(
                delivered,
                memory_id="11111111-1111-1111-1111-111111111111",
                owner_id="22222222-2222-2222-2222-222222222222",
                revision=2,
                tombstone=False,
                expected_cursor=45,
                expected_content="proof-content",
            )

        wrong_owner = self._active_change()
        wrong_owner["payload"]["memory"]["ownerId"] = "33333333-3333-3333-3333-333333333333"
        with self.assertRaises(SystemExit):
            proof_module.memory_change(
                {"changes": [wrong_owner]},
                memory_id="11111111-1111-1111-1111-111111111111",
                owner_id="22222222-2222-2222-2222-222222222222",
                revision=2,
                tombstone=False,
                expected_cursor=44,
                expected_content="proof-content",
            )

    def test_client_b_tombstone_must_be_identity_only(self):
        tombstone = {
            "objectId": "11111111-1111-1111-1111-111111111111",
            "dataClass": "memory",
            "serverRevision": 3,
            "tombstone": True,
            "cursor": 45,
            "payload": {
                "schema": "ordax.memory-sync-payload/1",
                "memoryIdentity": {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "ownerKind": "account",
                    "ownerId": "22222222-2222-2222-2222-222222222222",
                },
            },
        }
        proof_module.memory_change(
            {"changes": [tombstone]},
            memory_id="11111111-1111-1111-1111-111111111111",
            owner_id="22222222-2222-2222-2222-222222222222",
            revision=3,
            tombstone=True,
            expected_cursor=45,
        )

        tombstone["payload"]["memory"] = {"content": "must-not-survive-forget"}
        with self.assertRaises(SystemExit):
            proof_module.memory_change(
                {"changes": [tombstone]},
                memory_id="11111111-1111-1111-1111-111111111111",
                owner_id="22222222-2222-2222-2222-222222222222",
                revision=3,
                tombstone=True,
                expected_cursor=45,
            )

    def test_workflow_is_manual_secret_backed_receipt_only_and_context_valid(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", text)
        self.assertNotIn("pull_request:", text)
        self.assertNotIn("push:", text)
        self.assertIn("secrets.ORDAX_MEMORY_PROOF_ACCOUNT_EMAIL", text)
        self.assertIn("secrets.ORDAX_MEMORY_PROOF_ACCOUNT_PASSWORD", text)
        self.assertIn("secrets.ORDAX_SUPABASE_PUBLISHABLE_KEY", text)
        self.assertIn("cloud-memory-authenticated-proof.json", text)
        self.assertIn("CLOUD_MEMORY_AUTHENTICATED_RECEIPT=PASS_SANITIZED", text)
        self.assertIn("dedicated-non-admin-account-two-independent-sessions", text)
        self.assertIn('data["client_sessions_independent"] is True', text)
        self.assertIn('data["client_b_stale_conflict_rejected"] is True', text)
        self.assertIn('data["client_b_delete_tombstone_seen"] is True', text)
        self.assertIn("retention-days: 14", text)
        self.assertIn("assert forbidden not in data", text)
        self.assertNotIn("assert forbidden not in serialized", text)
        self.assertNotIn('echo "$ORDAX_MEMORY_PROOF_ACCOUNT_EMAIL"', text)
        self.assertNotIn('echo "$ORDAX_MEMORY_PROOF_ACCOUNT_PASSWORD"', text)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", text)
        self.assertNotIn(
            "\n      ORDAX_MEMORY_PROOF_RECEIPT_PATH: ${{ runner.temp }}",
            text,
            "runner context is unavailable in jobs.<job_id>.env",
        )
        self.assertGreaterEqual(
            text.count("ORDAX_MEMORY_PROOF_RECEIPT_PATH: ${{ runner.temp }}"),
            2,
            "receipt path must be resolved only inside step-level contexts",
        )


if __name__ == "__main__":
    unittest.main()
