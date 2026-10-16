from __future__ import annotations

import importlib.util
import os
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "account" / "ensure_public_account_bridge.py"
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "ordax-public-account-gateway-destination.yml"
SPEC = importlib.util.spec_from_file_location("ensure_public_account_bridge", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class PublicAccountBridgeProvisioningTests(unittest.TestCase):
    project_ref = "jhfphsjptrpmtnzkpwud"

    def test_reuses_existing_named_secret_without_revealing_value(self) -> None:
        with mock.patch.object(module, "_request", return_value=[{
            "id": "key-id",
            "name": module.BRIDGE_KEY_NAME,
            "type": "secret",
            "prefix": "sb_secret_example",
        }]) as request:
            self.assertEqual(module.ensure_bridge(self.project_ref, "management-token"), "existing")
        request.assert_called_once_with(
            f"{module.API_ROOT}/projects/{self.project_ref}/api-keys?reveal=false",
            "management-token",
        )

    def test_creates_dedicated_named_secret_when_absent(self) -> None:
        created = {"id": "key-id", "name": module.BRIDGE_KEY_NAME, "type": "secret"}
        with mock.patch.object(module, "_request", side_effect=[[], created]) as request:
            self.assertEqual(module.ensure_bridge(self.project_ref, "management-token"), "created")
        self.assertEqual(request.call_count, 2)
        _, create_call = request.call_args_list
        self.assertEqual(create_call.kwargs["method"], "POST")
        self.assertEqual(create_call.kwargs["body"]["type"], "secret")
        self.assertEqual(create_call.kwargs["body"]["name"], module.BRIDGE_KEY_NAME)
        self.assertNotIn("api_key", create_call.kwargs["body"])

    def test_duplicate_or_wrong_type_fails_closed(self) -> None:
        duplicate = [
            {"name": module.BRIDGE_KEY_NAME, "type": "secret"},
            {"name": module.BRIDGE_KEY_NAME, "type": "secret"},
        ]
        with mock.patch.object(module, "_request", return_value=duplicate):
            with self.assertRaisesRegex(RuntimeError, "duplicate-bridge-key-name"):
                module.ensure_bridge(self.project_ref, "management-token")
        with mock.patch.object(module, "_request", return_value=[{"name": module.BRIDGE_KEY_NAME, "type": "publishable"}]):
            with self.assertRaisesRegex(RuntimeError, "wrong-type"):
                module.ensure_bridge(self.project_ref, "management-token")

    def test_cli_requires_management_token(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(module.main(["--project-ref", self.project_ref]), 1)

    def test_destination_workflow_fails_closed_when_management_token_is_missing(self) -> None:
        text = WORKFLOW_PATH.read_text(encoding="utf-8")
        self.assertIn("secrets.SUPABASE_ACCESS_TOKEN", text)
        self.assertIn("PUBLIC_ACCOUNT_GATEWAY=BLOCKED", text)
        self.assertIn("exit 1", text)
        self.assertNotIn("PUBLIC_ACCOUNT_GATEWAY=NOT_DEPLOYED", text)
        self.assertNotIn("enabled=false", text)
        self.assertNotIn("steps.credential.outputs.enabled", text)
        self.assertIn("Ensure dedicated internal service bridge", text)
        self.assertIn("Deploy exact public account gateway bundle", text)


if __name__ == "__main__":
    unittest.main()
