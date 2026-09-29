#!/usr/bin/env python3
"""Regression guards for authenticated cloud Memory proof/provider."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROVIDER_PATH = ROOT / "services" / "public-identity" / "supabase_memory.py"
PROOF = ROOT / "tools" / "cloud-memory" / "prove_authenticated_atomic_sync.py"
WORKFLOW = ROOT / ".github" / "workflows" / "cloud-memory-authenticated-proof.yml"

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

    def test_entitlement_check_is_read_only_and_does_not_create_grants(self):
        transport = FakeTransport(
            [
                (
                    200,
                    json.dumps(
                        [
                            {
                                "entitlement_value": {"decision": "allowed"},
                                "valid_from": "2026-09-01T00:00:00Z",
                                "valid_until": None,
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
        self.assertTrue(provider.has_account_cloud_entitlement("user-access-token"))
        method, url, _, body = transport.calls[0]
        self.assertEqual(method, "GET")
        self.assertIn("/rest/v1/ordax_entitlement_grants?", url)
        self.assertIn("memory.cloud.enabled", url)
        self.assertIsNone(body)

    def test_manual_proof_never_grants_entitlement_or_uses_admin_authority(self):
        text = PROOF.read_text(encoding="utf-8")
        lower = text.lower()
        self.assertIn("memory.has_account_cloud_entitlement(token)", text)
        self.assertIn("memory-cloud-entitlement-not-preprovisioned", text)
        self.assertIn("stale-revision-not-rejected", text)
        self.assertIn("delete-tombstone-not-delivered", text)
        self.assertIn("canonical-memory-delete-state-invalid", text)
        self.assertNotIn("service_role", lower)
        self.assertNotIn("ordax_entitlement_grants", lower)
        self.assertNotIn("insert into", lower)
        self.assertNotIn("update public.ordax_memory_items", lower)
        self.assertNotIn("delete from", lower)

    def test_workflow_is_manual_secret_backed_and_receipt_only(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", text)
        self.assertNotIn("pull_request:", text)
        self.assertNotIn("push:", text)
        self.assertIn("secrets.ORDAX_MEMORY_PROOF_ACCOUNT_EMAIL", text)
        self.assertIn("secrets.ORDAX_MEMORY_PROOF_ACCOUNT_PASSWORD", text)
        self.assertIn("secrets.ORDAX_SUPABASE_PUBLISHABLE_KEY", text)
        self.assertIn("cloud-memory-authenticated-proof.json", text)
        self.assertIn("CLOUD_MEMORY_AUTHENTICATED_RECEIPT=PASS_SANITIZED", text)
        self.assertIn("retention-days: 14", text)
        self.assertNotIn('echo "$ORDAX_MEMORY_PROOF_ACCOUNT_EMAIL"', text)
        self.assertNotIn('echo "$ORDAX_MEMORY_PROOF_ACCOUNT_PASSWORD"', text)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", text)


if __name__ == "__main__":
    unittest.main()
