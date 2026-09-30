#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "tools/cloud-memory/prove_authenticated_bidirectional_restore.py"
VALIDATOR = ROOT / "tools/cloud-memory/validate_bidirectional_restore_receipt.py"


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


proof = load(PROOF, "cloud_memory_bidirectional_restore_proof")
validator = load(VALIDATOR, "cloud_memory_bidirectional_restore_receipt")


class CloudMemoryBidirectionalRestoreProofTests(unittest.TestCase):
    def test_source_uses_three_user_sessions_and_no_service_role(self):
        source = PROOF.read_text(encoding="utf-8")
        self.assertIn("identity_a = SupabasePasswordProvider", source)
        self.assertIn("identity_b = SupabasePasswordProvider", source)
        self.assertIn("identity_c = SupabasePasswordProvider", source)
        self.assertIn("client B receives it through sync and performs a valid edit", source)
        self.assertIn("Its first operation is the canonical account snapshot", source)
        self.assertIn("validate_tombstone", source)
        self.assertNotIn("SUPABASE_SERVICE_ROLE", source)
        self.assertNotIn("service_role_key", source)

    def test_receipt_is_exact_sanitized_and_validated(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "receipt.json"
            env = {"GITHUB_SHA": "a" * 40, "GITHUB_RUN_ID": "12345"}
            with patch.dict(os.environ, env, clear=False):
                proof.write_receipt(
                    str(path),
                    "https://example.supabase.co",
                    create_revision=1,
                    edit_revision=2,
                    delete_revision=3,
                    create_cursor=10,
                    edit_cursor=11,
                    delete_cursor=12,
                    fresh_snapshot_cursor=11,
                )
            payload = validator.validate(str(path))
            self.assertEqual(payload["status"], "pass")
            self.assertTrue(payload["bidirectional_convergence_proven"])
            self.assertTrue(payload["fresh_session_restore_proven"])
            self.assertFalse(payload["service_role_used"])
            serialized = path.read_text(encoding="utf-8").lower()
            for forbidden in ("password", "access_token", "refresh_token", "memory_content", "account_id", "memory_id"):
                self.assertNotIn(f'"{forbidden}":', serialized)

    def test_validator_rejects_cursor_order_or_secret_shaped_extension(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "receipt.json"
            proof.write_receipt(
                str(path),
                "https://example.supabase.co",
                create_revision=1,
                edit_revision=2,
                delete_revision=3,
                create_cursor=10,
                edit_cursor=11,
                delete_cursor=12,
                fresh_snapshot_cursor=11,
            )
            payload = json.loads(path.read_text(encoding="utf-8"))
            payload["delete_cursor"] = 10
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(SystemExit):
                validator.validate(str(path))

            payload["delete_cursor"] = 12
            payload["access_token"] = "secret"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(SystemExit):
                validator.validate(str(path))


if __name__ == "__main__":
    unittest.main()
