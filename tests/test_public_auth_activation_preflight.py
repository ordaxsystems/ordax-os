"""Fail-closed tests for the public Account activation preflight.

The preflight owns release readiness. These tests deliberately distinguish
transport evidence that is already live (OIDC, Public Edge, named bridge,
same-origin session) from the broader Account/legal gates that still prevent
public activation. Historical absence of a transport proof must never become a
permanent architectural requirement.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools" / "public-site" / "auth_activation_preflight.py"

spec = importlib.util.spec_from_file_location("ordax_auth_activation_preflight", MODULE)
preflight = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(preflight)

REQUIRED = (
    preflight.LEGAL,
    preflight.HARDENING,
    preflight.PROVIDER_POLICY,
    preflight.DEPLOYMENT,
    preflight.IDENTITY,
    preflight.LIFECYCLE,
    preflight.RUNTIME,
    preflight.PUBLIC_SITE,
    preflight.EDGE,
    preflight.REFERENCE_GATEWAY,
    preflight.LIFECYCLE_EDGE,
)


class PublicAuthActivationPreflightTests(unittest.TestCase):
    def fixture_root(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        for relative in REQUIRED:
            source = ROOT / relative
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        return temporary, root

    def test_current_repository_is_safe_disabled_with_current_runtime_proofs(self):
        blockers, controls = preflight.readiness(ROOT)
        hardening = preflight.load_json(ROOT, preflight.HARDENING)
        deployment = preflight.load_json(ROOT, preflight.DEPLOYMENT)
        observation = hardening["current_observation"]
        destination = hardening["postgresql_destination"]
        edge = deployment["public_edge_gateway"]
        migration = deployment["vercel_migration"]

        self.assertTrue(blockers)
        self.assertTrue(all(enabled is False for enabled in controls.values()))
        self.assertTrue(preflight.source_web_auth_only(ROOT))

        self.assertTrue(observation["same_origin_session_owner_deployed"])
        self.assertTrue(observation["public_edge_provenance_e2e_verified"])
        self.assertTrue(edge["deployed"])
        self.assertEqual(edge["deployed_version"], 8)
        self.assertTrue(edge["runtime_provenance_e2e_verified"])
        self.assertTrue(edge["named_inner_service_bridge_provisioned"])
        self.assertTrue(edge["named_inner_service_bridge_runtime_e2e_verified"])
        self.assertEqual(edge["inner_gateway_deployed_version"], 13)
        self.assertTrue(destination["internal_gateway_runtime_e2e_verified"])
        self.assertTrue(destination["destination_service_transport_runtime_verified"])
        self.assertTrue(destination["destination_vercel_oidc_binding_verified"])
        self.assertTrue(destination["destination_vercel_oidc_runtime_e2e_verified"])
        self.assertTrue(migration["target_runtime_oidc_e2e_verified"])

        for stale_blocker in (
            "public-edge-gateway-deployment",
            "public-edge-oidc-source",
            "public-edge-oidc-deployment",
            "public-edge-provenance-proof",
            "same-origin-session-owner",
            "vercel-production-oidc-proof",
            "vercel-same-origin-adapter-deployment",
            "vercel-public-edge-routing",
            "same-origin-adapter-deployment",
            "destination-account-gateway-deployment",
            "destination-internal-gateway-runtime-proof",
            "destination-service-auth-transport-proof",
            "destination-vercel-oidc-project-binding",
            "destination-vercel-oidc-runtime-proof",
        ):
            self.assertNotIn(stale_blocker, blockers)

        for required_blocker in (
            "account-provider-cutover-target-mismatch",
            "account-provider-cutover-incomplete",
            "destination-active-legal-policy",
            "destination-provider-settings-proof",
            "destination-auth-rate-limit-e2e-proof",
            "destination-session-revocation-proof",
            "destination-recovery-e2e-proof",
            "destination-account-export-e2e-proof",
            "destination-sync-runtime-e2e-proof",
            "provider-leaked-password-protection",
            "provider-password-policy-verification",
            "redirect-allowlist-provider-verification",
            "public-rate-limit-deployment",
            "recovery-email-template",
            "recovery-e2e-proof",
            "session-revocation-proof",
            "bot-protection-e2e-proof",
            "turnstile-canonical-runtime-proof",
            "registration-legal-web-binding",
            "registration-legal-native-binding",
            "registration-legal-activation",
            "account-registration-switch",
        ):
            self.assertIn(required_blocker, blockers)

        self.assertEqual(preflight.main(["check", "--root", str(ROOT)]), 0)
        self.assertEqual(preflight.main(["require-ready", "--root", str(ROOT)]), 1)

    def test_canonical_domain_and_runtime_oidc_proofs_are_not_absence_blockers(self):
        blockers, _ = preflight.readiness(ROOT)
        deployment = preflight.load_json(ROOT, preflight.DEPLOYMENT)
        migration = deployment["vercel_migration"]
        adapter = deployment["vercel_adapter"]

        self.assertEqual(migration["target_canonical_domain"], "ordax.com.br")
        self.assertTrue(migration["target_canonical_domain_verified"])
        self.assertTrue(migration["target_dns_apex_routing_cutover_verified"])
        self.assertTrue(migration["target_www_domain_verified"])
        self.assertTrue(migration["target_project_production_deployment_ready"])
        self.assertTrue(migration["target_project_production_http_smoke_verified"])
        self.assertTrue(migration["target_project_environment_variables_present"])
        self.assertTrue(migration["target_runtime_oidc_e2e_verified"])
        self.assertTrue(adapter["canonical_public_origin_live_configured"])
        self.assertTrue(adapter["canonical_public_origin_deployment_verified"])

        for code in (
            "vercel-canonical-domain-ownership",
            "vercel-apex-dns-cutover",
            "vercel-www-domain-ownership",
            "vercel-www-canonical-redirect",
            "vercel-production-ready",
            "vercel-production-http-proof",
            "vercel-production-environment",
            "vercel-production-oidc-proof",
            "vercel-canonical-origin-binding",
        ):
            self.assertNotIn(code, blockers)

        self.assertIn("vercel-production-account-routes", blockers)

    def test_transport_proof_cannot_authorize_registration_or_recovery(self):
        hardening = preflight.load_json(ROOT, preflight.HARDENING)
        observation = hardening["current_observation"]
        destination = hardening["postgresql_destination"]
        switches = preflight.source_switches(ROOT)

        self.assertTrue(destination["destination_service_transport_runtime_verified"])
        self.assertTrue(destination["destination_named_bridge_runtime_e2e_verified"])
        self.assertTrue(destination["destination_vercel_oidc_runtime_e2e_verified"])
        self.assertFalse(destination["functional_provider_cutover_complete"])
        self.assertFalse(destination["public_login_enabled"])
        self.assertFalse(destination["public_registration_enabled"])
        self.assertFalse(destination["recovery_e2e_verified"])
        self.assertFalse(destination["session_revocation_e2e_verified"])
        self.assertFalse(observation["account_recovery_flow_tested"])
        self.assertFalse(observation["session_revocation_tested"])
        self.assertEqual(
            switches,
            {
                "PUBLIC_SITE_ACCOUNT_ENABLED": False,
                "ACCOUNT_REGISTRATION_ENABLED": False,
                "ACCOUNT_RECOVERY_REQUEST_ENABLED": False,
                "ACCOUNT_RECOVERY_COMPLETION_ENABLED": False,
                "ACCOUNT_CLOSE_ENABLED": False,
            },
        )

    def test_destination_cutover_requires_each_unproven_capability_independently(self):
        blockers, _ = preflight.readiness(ROOT)
        hardening = preflight.load_json(ROOT, preflight.HARDENING)
        stage = hardening["postgresql_destination"]

        proven = {
            "destination-account-gateway-deployment": stage["public_account_gateway_deployed"],
            "destination-internal-gateway-runtime-proof": stage["internal_gateway_runtime_e2e_verified"],
            "destination-service-auth-transport-proof": stage["destination_service_transport_runtime_verified"],
            "destination-vercel-oidc-project-binding": stage["destination_vercel_oidc_binding_verified"],
            "destination-vercel-oidc-runtime-proof": stage["destination_vercel_oidc_runtime_e2e_verified"],
            "destination-sync-export-db-proof": stage["sync_export_db_boundary_proven"],
        }
        for blocker, value in proven.items():
            self.assertTrue(value, blocker)
            self.assertNotIn(blocker, blockers)

        pending = {
            "account-provider-cutover-incomplete": stage["functional_provider_cutover_complete"],
            "destination-active-legal-policy": stage["active_legal_policy_present"],
            "destination-provider-settings-proof": stage["provider_settings_e2e_verified"],
            "destination-auth-rate-limit-e2e-proof": stage["public_auth_rate_limit_runtime_e2e_verified"],
            "destination-session-revocation-proof": stage["session_revocation_e2e_verified"],
            "destination-recovery-e2e-proof": stage["recovery_e2e_verified"],
            "destination-account-export-e2e-proof": stage["account_export_runtime_e2e_verified"],
            "destination-sync-runtime-e2e-proof": stage["sync_runtime_e2e_verified"],
        }
        for blocker, value in pending.items():
            self.assertFalse(value, blocker)
            self.assertIn(blocker, blockers)

    def test_all_destination_flags_can_clear_without_clearing_unrelated_release_gates(self):
        temporary, root = self.fixture_root()
        try:
            path = root / preflight.HARDENING
            hardening = preflight.load_json(root, preflight.HARDENING)
            stage = hardening["postgresql_destination"]
            hardening["target"]["project_ref"] = stage["project_ref"]
            for flag in (
                "functional_provider_cutover_complete",
                "public_account_gateway_deployed",
                "internal_gateway_runtime_e2e_verified",
                "destination_service_transport_runtime_verified",
                "destination_vercel_oidc_binding_verified",
                "destination_vercel_oidc_runtime_e2e_verified",
                "active_legal_policy_present",
                "provider_settings_e2e_verified",
                "public_auth_rate_limit_runtime_e2e_verified",
                "session_revocation_e2e_verified",
                "recovery_e2e_verified",
                "sync_export_db_boundary_proven",
                "account_export_runtime_e2e_verified",
                "sync_runtime_e2e_verified",
            ):
                stage[flag] = True
            path.write_text(json.dumps(hardening, indent=2) + "\n", encoding="utf-8")

            blockers, _ = preflight.readiness(root)
            self.assertFalse(any(
                code == "account-provider-cutover-target-mismatch"
                or code == "account-provider-cutover-incomplete"
                or code.startswith("destination-")
                for code in blockers
            ))
            self.assertIn("provider-leaked-password-protection", blockers)
            self.assertIn("registration-legal-activation", blockers)
            self.assertEqual(preflight.main(["require-ready", "--root", str(root)]), 1)
        finally:
            temporary.cleanup()

    def test_malformed_destination_evidence_fails_closed(self):
        temporary, root = self.fixture_root()
        try:
            path = root / preflight.HARDENING
            hardening = preflight.load_json(root, preflight.HARDENING)
            hardening["postgresql_destination"] = []
            path.write_text(json.dumps(hardening, indent=2) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "postgresql_destination must be an object"):
                preflight.readiness(root)
        finally:
            temporary.cleanup()

    def test_proven_oidc_or_bridge_regression_becomes_a_blocker_again(self):
        temporary, root = self.fixture_root()
        try:
            hardening_path = root / preflight.HARDENING
            hardening = preflight.load_json(root, preflight.HARDENING)
            hardening["postgresql_destination"]["destination_service_transport_runtime_verified"] = False
            hardening["postgresql_destination"]["destination_vercel_oidc_runtime_e2e_verified"] = False
            hardening_path.write_text(json.dumps(hardening, indent=2) + "\n", encoding="utf-8")

            deployment_path = root / preflight.DEPLOYMENT
            deployment = preflight.load_json(root, preflight.DEPLOYMENT)
            deployment["public_edge_gateway"]["runtime_provenance_e2e_verified"] = False
            deployment["vercel_migration"]["target_runtime_oidc_e2e_verified"] = False
            deployment_path.write_text(json.dumps(deployment, indent=2) + "\n", encoding="utf-8")

            blockers, _ = preflight.readiness(root)
            for blocker in (
                "destination-service-auth-transport-proof",
                "destination-vercel-oidc-runtime-proof",
                "public-edge-provenance-proof",
                "vercel-production-oidc-proof",
            ):
                self.assertIn(blocker, blockers)
        finally:
            temporary.cleanup()


if __name__ == "__main__":
    unittest.main()
