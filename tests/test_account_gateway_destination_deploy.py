from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ordax-account-gateway-destination.yml"
RESOLVER = ROOT / "tools" / "account" / "resolve_account_gateway_destination.py"
SUPPLY_CHAIN = ROOT / "docs" / "contracts" / "ci-supply-chain.json"
SPEC = importlib.util.spec_from_file_location("ordax_gateway_destination", RESOLVER)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class AccountGatewayDestinationDeployTests(unittest.TestCase):
    def test_resolver_targets_destination_without_auth_cutover(self):
        ref, name = MODULE.resolve_destination(ROOT)
        self.assertEqual(ref, "jhfphsjptrpmtnzkpwud")
        self.assertEqual(name, "ordax-platform")

    def test_resolver_fails_closed_on_cutover_or_registration_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs/contracts").mkdir(parents=True)
            (root / "infra/supabase/product").mkdir(parents=True)
            hardening = json.loads((ROOT / MODULE.HARDENING).read_text(encoding="utf-8"))
            plan = json.loads((ROOT / MODULE.DESTINATION_PLAN).read_text(encoding="utf-8"))
            hardening["postgresql_destination"]["functional_provider_cutover_complete"] = True
            (root / MODULE.HARDENING).write_text(json.dumps(hardening), encoding="utf-8")
            (root / MODULE.DESTINATION_PLAN).write_text(json.dumps(plan), encoding="utf-8")
            with self.assertRaises(ValueError):
                MODULE.resolve_destination(root)

            hardening["postgresql_destination"]["functional_provider_cutover_complete"] = False
            hardening["postgresql_destination"]["public_registration_enabled"] = True
            (root / MODULE.HARDENING).write_text(json.dumps(hardening), encoding="utf-8")
            with self.assertRaises(ValueError):
                MODULE.resolve_destination(root)

    def test_workflow_deploys_only_reviewed_main_gateway_to_destination(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("  workflow_dispatch:", text)
        self.assertNotIn("\n  push:\n", text)
        self.assertIn("github.event_name == 'workflow_dispatch'", text)
        self.assertIn("inputs.approved_sha == github.sha", text)
        self.assertIn("inputs.release_confirmation == 'DEPLOY_ACCOUNT_GATEWAY_PRODUCTION'", text)
        self.assertIn("github.ref == 'refs/heads/main'", text)
        self.assertIn('test "${CURRENT}" = "${GITHUB_SHA}"', text)
        self.assertIn("resolve_account_gateway_destination.py", text)
        self.assertIn("SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}", text)
        self.assertIn("ACCOUNT_GATEWAY_DESTINATION=NOT_DEPLOYED", text)
        self.assertIn("enabled=false", text)
        # Missing production credentials must fail the workflow instead of
        # reporting a green run in which deployment and verification were skipped.
        missing_credential_step = text.split(
            "      - name: Resolve management credential availability without printing it",
            1,
        )[1].split("      - name: Set up pinned Supabase CLI", 1)[0]
        self.assertIn("::error::ACCOUNT_GATEWAY_DESTINATION=NOT_DEPLOYED", missing_credential_step)
        self.assertIn("exit 2", missing_credential_step)
        self.assertNotIn("exit 0", missing_credential_step)

        self.assertIn("enabled=true", text)
        # The sixth guarded step validates old remote bundle readability
        # before any replacement. No other release gate is weakened.
        self.assertEqual(text.count("if: steps.credential.outputs.enabled == 'true'"), 6)
        self.assertIn("Prove prior deployed Account source is readable before replacement", text)
        self.assertIn("--mode preflight", text)
        self.assertIn("--mode verify", text)
        self.assertNotIn("SUPABASE_ACCESS_TOKEN repository secret is required.", text)
        self.assertIn("supabase functions deploy ordax-account-gateway", text)
        self.assertIn('--project-ref "${SUPABASE_PROJECT_REF}"', text)
        self.assertIn("--no-verify-jwt", text)
        self.assertIn("--use-api", text)
        self.assertIn("cd infra", text)
        self.assertNotIn("supabase db push", text)
        self.assertNotIn("apply_migration", text)
        self.assertNotIn("functional_provider_cutover_complete = true", text.lower())
        self.assertIn('"version": 18', text)
        self.assertIn('value.get("error") == "native-account-session-required"', text)
        self.assertIn("ACCOUNT_GATEWAY_MCP_USAGE_UNAUTH=PASS", text)
        self.assertIn('Deno.env.get("ORDAX_MCP_USAGE_READ_ENABLED")', text)
        self.assertIn("node --test tests/test_account_mcp_usage_bridge.mjs", text)
        self.assertIn("      owner_device_console_rollout:", text)
        self.assertIn("inputs.owner_device_console_rollout != 'unchanged'", text)
        self.assertIn("ORDAX_MCP_OWNER_CENTRAL_SELECTION_ENABLED", text)
        self.assertIn("ACCOUNT_GATEWAY_OWNER_DEVICE_CONSOLE_SECRET_VALUES_PRINTED=NO", text)
        self.assertIn("ACCOUNT_GATEWAY_OWNER_DEVICE_CONSOLE_ROLLOUT=", text)
        self.assertIn("Only existing-account MCP devices", text)
        self.assertIn("        default: unchanged", text)
        # Existing Project/GitHub release remains independent. A console-only
        # rollout does not introduce a second Account gateway or expand grants.
        console_step=text.split("      - name: Apply independent Owner device MCP console rollout",1)[1].split("      - name: Smoke destination gateway",1)[0]
        self.assertIn("ORDAX_MCP_OWNER_ACCOUNT_ENABLED",console_step)
        self.assertIn("ORDAX_MCP_OWNER_CENTRAL_SELECTION_ENABLED",console_step)
        self.assertNotIn("ORDAX_MCP_OWNER_PROJECT_",console_step)
        self.assertNotIn("ORDAX_MCP_OWNER_GITHUB_",console_step)
        self.assertIn("      owner_project_rollout:", text)
        self.assertIn("          - unchanged", text)
        self.assertIn("          - enable", text)
        self.assertIn("          - disable", text)
        self.assertIn("inputs.owner_project_rollout != 'unchanged'", text)
        self.assertIn("supabase secrets set", text)
        # Project setup/OAuth is NOT permission to bind devices or create
        # execution grants. The workflow must never touch either gate, even
        # for its explicit "enable" or "disable" choice.
        project_step = text.split(
            "      - name: Apply explicit Owner Project setup rollout", 1,
        )[1].split(
            "      - name: Apply independent Owner device MCP console rollout", 1,
        )[0]
        for key in (
            "ORDAX_MCP_OWNER_ACCOUNT_ENABLED=1",
            "ORDAX_MCP_OWNER_PROJECT_ONBOARDING_ENABLED=1",
            "ORDAX_MCP_OWNER_GITHUB_AUTHORIZATION_ENABLED=1",
            "ORDAX_MCP_OWNER_PROJECT_ONBOARDING_ENABLED=0",
            "ORDAX_MCP_OWNER_GITHUB_AUTHORIZATION_ENABLED=0",
        ):
            self.assertIn(key, project_step)
        self.assertNotIn("ORDAX_MCP_OWNER_ACCOUNT_ENABLED=0", project_step)
        self.assertNotIn("ORDAX_MCP_OWNER_PROJECT_DEVICE_BINDING_ENABLED", project_step)
        self.assertNotIn("ORDAX_MCP_OWNER_PROJECT_GRANT_ENABLED", project_step)
        self.assertIn("inputs.owner_project_rollout != 'unchanged'", project_step)
        self.assertIn("ACCOUNT_GATEWAY_OWNER_PROJECT_EXECUTION_GRANTS=UNCHANGED", project_step)
        self.assertIn("ACCOUNT_GATEWAY_OWNER_PROJECT_SECRET_VALUES_PRINTED=NO", project_step)

    def test_workflow_pins_approved_cli_action_and_version(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        sha = "45a513f8c64c0bc8e0e3dfe572b5c95be85f6359"
        self.assertIn(f"supabase/setup-cli@{sha}", text)
        self.assertIn("version: 2.121.0", text)
        contract = json.loads(SUPPLY_CHAIN.read_text(encoding="utf-8"))
        approved = {
            (entry["uses"], entry["sha"], entry["version_label"])
            for entry in contract["approved_external_actions"]
        }
        self.assertIn(("supabase/setup-cli", sha, "v3.0.1"), approved)

    def test_workflow_release_is_manual_and_self_bootstrapping(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        # A reviewed code merge cannot implicitly mutate the Supabase Edge.
        self.assertNotIn("\n  push:\n", text)
        self.assertIn("  workflow_dispatch:", text)
        self.assertIn("      approved_sha:", text)
        self.assertIn("      release_confirmation:", text)
        self.assertIn("      owner_project_rollout:", text)
        self.assertIn("github.event_name == 'workflow_dispatch'", text)
        self.assertIn("github.ref == 'refs/heads/main'", text)
        self.assertIn("inputs.approved_sha == github.sha", text)
        self.assertIn("inputs.release_confirmation == 'DEPLOY_ACCOUNT_GATEWAY_PRODUCTION'", text)
        self.assertIn('test "${ACTUAL}" = "${GITHUB_SHA}"', text)
        self.assertIn('test "${CURRENT}" = "${GITHUB_SHA}"', text)
        self.assertIn("resolve_account_gateway_destination.py", text)
        self.assertIn("account_transport_admission.mjs", text)
        self.assertIn("node --test tests/test_account_mcp_owner_bridge.mjs", text)
        self.assertNotIn("infra/supabase/product/migrations/**", text)


if __name__ == "__main__":
    unittest.main()
