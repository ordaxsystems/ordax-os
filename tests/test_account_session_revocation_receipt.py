from pathlib import Path
import importlib.util
import json
import os
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools" / "account-sync" / "prove_session_revocation.py"


def load_module():
    spec = importlib.util.spec_from_file_location("ordax_session_revocation_proof", TOOL)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


proof = load_module()


class AccountSessionRevocationReceiptTests(unittest.TestCase):
    def test_public_origin_parser_rejects_internal_or_ambiguous_urls(self):
        self.assertEqual(
            proof.canonical_public_origin("https://accounts.example.invalid/"),
            "https://accounts.example.invalid",
        )
        for value in (
            "http://accounts.example.invalid",
            "https://user:pass@accounts.example.invalid",
            "https://accounts.example.invalid/functions/v1/ordax-account-gateway",
            "https://accounts.example.invalid/?next=x",
            "https://accounts.example.invalid/#fragment",
        ):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                proof.canonical_public_origin(value)

    def test_receipt_is_local_scope_and_sanitized(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "receipt.json"
            old_sha = os.environ.get("GITHUB_SHA")
            old_run = os.environ.get("GITHUB_RUN_ID")
            try:
                os.environ["GITHUB_SHA"] = "0123456789abcdef0123456789abcdef01234567"
                os.environ["GITHUB_RUN_ID"] = "98765"
                proof.write_receipt(
                    str(path),
                    "https://example.invalid",
                )
            finally:
                if old_sha is None:
                    os.environ.pop("GITHUB_SHA", None)
                else:
                    os.environ["GITHUB_SHA"] = old_sha
                if old_run is None:
                    os.environ.pop("GITHUB_RUN_ID", None)
                else:
                    os.environ["GITHUB_RUN_ID"] = old_run
            data = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(
            data["$schema"],
            "prototype-ordax.account-session-revocation-proof/1",
        )
        self.assertEqual(data["scope"], "local")
        self.assertTrue(data["two_independent_sessions"])
        self.assertTrue(data["session_a_anonymous_after_logout"])
        self.assertTrue(data["revoked_session_restore_rejected"])
        self.assertTrue(data["session_b_remained_authenticated"])
        self.assertFalse(data["credentials_persisted"])
        self.assertFalse(data["account_identifier_recorded"])
        self.assertFalse(data["sensitive_auth_material_recorded"])
        serialized = json.dumps(data, sort_keys=True).lower()
        for forbidden in ("password", "access_token", "refresh_token", "cookie"):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
