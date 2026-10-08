import importlib.util
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

    def test_current_repository_is_coherently_safe_disabled_with_explicit_blockers(self):
        blockers, controls = preflight.readiness(ROOT)
        self.assertTrue(blockers)
        hardening = preflight.load_json(ROOT, preflight.HARDENING)
        deployment = preflight.load_json(ROOT, preflight.DEPLOYMENT)
        provider_policy = preflight.load_json(ROOT, preflight.PROVIDER_POLICY)
        self.assertTrue(
            hardening["current_observation"]["product_leaked_password_protection_verified"]
        )
        self.assertEqual(
            provider_policy["redirect_policy"]["origin"],
            "https://ordax-os-public.vercel.app",
        )
        self.assertEqual(
            provider_policy["redirect_policy"]["recovery_verify_url"],
            "https://ordax-os-public.vercel.app/auth/recover/verify",
        )
        self.assertFalse(provider_policy["provider_verification"]["production_origin"])
        self.assertTrue(deployment["public_edge_gateway"]["deployed"])
        self.assertTrue(deployment["public_edge_gateway"]["oidc_source_ready"])
        self.assertTrue(deployment["public_edge_gateway"]["oidc_deployed"])
        self.assertIn("provider-leaked-password-protection", blockers)
        self.assertNotIn("product-leaked-password-protection", blockers)
        self.assertNotIn("account-data-export-implementation", blockers)
        self.assertNotIn("email-confirmation-policy", blockers)
        self.assertNotIn("email-confirmation-provider-verification", blockers)
        self.assertNotIn("redirect-allowlist", blockers)
        self.assertNotIn("password-policy-review", blockers)
        self.assertNotIn("account-close-implementation", blockers)
        self.assertNotIn("public-edge-gateway-deployment", blockers)
        self.assertNotIn("public-edge-oidc-source", blockers)
        self.assertNotIn("public-edge-oidc-deployment", blockers)
        self.assertTrue(all(value is False for value in controls.values()))
        self.assertNotIn("registration-legal-receipt", blockers)
        self.assertNotIn("registration-provider-bypass-guard", blockers)
        for expected in (
            "registration-legal-policy-review",
            "registration-legal-web-binding",
            "registration-legal-native-binding",
            "registration-legal-activation",
            "account-registration-switch",

            "redirect-allowlist-provider-verification",
            "provider-password-policy-verification",
            "public-edge-provenance-proof",
            "vercel-same-origin-adapter-deployment",
            "vercel-public-edge-routing",
            "same-origin-adapter-deployment",
            "public-rate-limit-deployment",
            "recovery-email-template",
            "recovery-e2e-proof",
            "session-revocation-proof",
            "bot-protection-production-secret",
            "bot-protection-e2e-proof",
        ):
            self.assertIn(expected, blockers)
        self.assertNotIn("legacy-account-legal-receipt-reconciliation", blockers)
        self.assertEqual(preflight.main(["check", "--root", str(ROOT)]), 0)
        self.assertEqual(preflight.main(["require-ready", "--root", str(ROOT)]), 1)

    def test_domain_identity_and_provider_redirects_use_deployment_ssot(self):
        blockers, _ = preflight.readiness(ROOT)
        # DNS ownership, apex routing and www verification are now proven
        # by the deployed public-site SSOT; they must no longer be blockers.
        for code in (
            "vercel-canonical-domain-ownership",
            "vercel-apex-dns-cutover",
            "vercel-www-domain-ownership",
            "vercel-www-canonical-redirect",
            "vercel-production-ready",
            "vercel-production-http-proof",
        ):
            self.assertNotIn(code, blockers)

        # A valid custom domain alone never enables the account runtime.
        for code in (
            "vercel-production-environment",
            "vercel-production-account-routes",
            "vercel-production-oidc-proof",
            "vercel-canonical-origin-binding",
            "provider-redirect-canonical-origin",
            "provider-recovery-canonical-origin",
        ):
            self.assertIn(code, blockers)

    def test_canonical_domain_cutover_requires_independent_vercel_proofs(self):
        temporary, root = self.fixture_root()
        try:
            deployment_file = root / preflight.DEPLOYMENT
            policy_file = root / preflight.PROVIDER_POLICY
            deployment = preflight.load_json(root, preflight.DEPLOYMENT)
            policy = preflight.load_json(root, preflight.PROVIDER_POLICY)
            migration = deployment["vercel_migration"]
            adapter = deployment["vercel_adapter"]
            origin = "https://" + migration["target_canonical_domain"]

            for name in (
                "target_canonical_domain_verified",
                "target_dns_apex_routing_cutover_verified",
                "target_www_domain_verified",
                "target_project_production_deployment_ready",
                "target_project_production_http_smoke_verified",
                "target_project_environment_variables_present",
                "target_project_production_public_account_routes_available",
                "target_runtime_oidc_e2e_verified",
            ):
                migration[name] = True
            adapter["canonical_public_origin"] = origin
            adapter["canonical_public_origin_live_configured"] = True
            adapter["canonical_public_origin_deployment_verified"] = True
            policy["redirect_policy"]["origin"] = origin
            policy["redirect_policy"]["recovery_verify_url"] = origin + "/auth/recover/verify"

            def check():
                deployment_file.write_text(
                    __import__("json").dumps(deployment) + "\n", encoding="utf-8"
                )
                policy_file.write_text(
                    __import__("json").dumps(policy) + "\n", encoding="utf-8"
                )
                return set(preflight.readiness(root)[0])

            guarded = {
                "vercel-canonical-project-identity",
                "vercel-canonical-domain-ownership",
                "vercel-apex-dns-cutover",
                "vercel-www-domain-ownership",
                "vercel-www-canonical-redirect",
                "vercel-production-ready",
                "vercel-production-http-proof",
                "vercel-production-environment",
                "vercel-production-account-routes",
                "vercel-production-oidc-proof",
                "vercel-canonical-origin-binding",
                "provider-redirect-canonical-origin",
                "provider-recovery-canonical-origin",
            }
            self.assertFalse(guarded.intersection(check()))
            # Even when all independent Vercel proofs are marked true,
            # unrelated Account and legal security gates stay closed.
            self.assertIn("destination-service-auth-transport-proof", check())
            self.assertIn("destination-active-legal-policy", check())

            for name, expected in (
                ("target_canonical_domain_verified", "vercel-canonical-domain-ownership"),
                ("target_dns_apex_routing_cutover_verified", "vercel-apex-dns-cutover"),
                ("target_project_environment_variables_present", "vercel-production-environment"),
                ("target_project_production_public_account_routes_available", "vercel-production-account-routes"),
                ("target_runtime_oidc_e2e_verified", "vercel-production-oidc-proof"),
            ):
                migration[name] = False
                self.assertIn(expected, check())
                migration[name] = True

            adapter["canonical_public_origin"] = "https://old-team.vercel.app"
            self.assertIn("vercel-canonical-origin-binding", check())
            adapter["canonical_public_origin"] = origin
            policy["redirect_policy"]["origin"] = "https://old-team.vercel.app"
            self.assertIn("provider-redirect-canonical-origin", check())
            policy["redirect_policy"]["origin"] = origin
            policy["redirect_policy"]["recovery_verify_url"] = (
                "https://old-team.vercel.app/auth/recover/verify"
            )
            self.assertIn("provider-recovery-canonical-origin", check())
        finally:
            temporary.cleanup()

    def test_old_provider_proofs_do_not_authorize_destination_cutover(self):
        blockers, controls = preflight.readiness(ROOT)
        self.assertIn("account-provider-cutover-target-mismatch", blockers)
        self.assertIn("account-provider-cutover-incomplete", blockers)
        self.assertIn("destination-account-gateway-deployment", blockers)
        self.assertEqual(
            "destination-sync-export-db-proof" in blockers,
            not preflight.load_json(ROOT, preflight.HARDENING)["postgresql_destination"][
                "sync_export_db_boundary_proven"
            ],
        )
        self.assertIn("destination-account-export-e2e-proof", blockers)
        self.assertIn("destination-sync-runtime-e2e-proof", blockers)
        self.assertTrue(all(not enabled for enabled in controls.values()))

    def test_destination_project_match_alone_does_not_authorize_registration(self):
        temporary, root = self.fixture_root()
        try:
            path = root / preflight.HARDENING
            hardening = preflight.load_json(root, preflight.HARDENING)
            hardening["target"]["project_ref"] = hardening["postgresql_destination"]["project_ref"]
            path.write_text(__import__("json").dumps(hardening, indent=2) + "\n", encoding="utf-8")
            blockers, _ = preflight.readiness(root)
            self.assertNotIn("account-provider-cutover-target-mismatch", blockers)
            self.assertEqual(
                "destination-sync-export-db-proof" in blockers,
                not hardening["postgresql_destination"]["sync_export_db_boundary_proven"],
            )
            for flag in (
                "account-provider-cutover-incomplete",
                "destination-account-gateway-deployment",
                "destination-internal-gateway-runtime-proof",
                "destination-service-auth-transport-proof",
                "destination-vercel-oidc-project-binding",
                "destination-vercel-oidc-runtime-proof",
                "destination-active-legal-policy",
                "destination-provider-settings-proof",
                "destination-auth-rate-limit-e2e-proof",
                "destination-session-revocation-proof",
                "destination-recovery-e2e-proof",
                "destination-account-export-e2e-proof",
                "destination-sync-runtime-e2e-proof",
            ):
                self.assertIn(flag, blockers)
        finally:
            temporary.cleanup()

    def test_all_destination_proofs_are_individually_required(self):
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
            path.write_text(__import__("json").dumps(hardening, indent=2) + "\n", encoding="utf-8")
            blockers, _ = preflight.readiness(root)
            self.assertFalse(any(
                code == "account-provider-cutover-target-mismatch"
                or code.startswith("destination-")
                or code == "account-provider-cutover-incomplete"
                for code in blockers
            ))
            # Clearing destination gates alone never clears unrelated release gates.
            self.assertIn("provider-leaked-password-protection", blockers)
            self.assertEqual(preflight.main(["require-ready", "--root", str(root)]), 1)
        finally:
            temporary.cleanup()

    def test_staging_installation_and_old_oidc_never_authorize_cutover(self):
        hardening = preflight.load_json(ROOT, preflight.HARDENING)
        stage = hardening["postgresql_destination"]
        self.assertTrue(stage["internal_gateway_staging_deployed"])
        self.assertTrue(stage["internal_gateway_staging_verify_jwt"])
        self.assertFalse(stage["internal_gateway_runtime_e2e_verified"])
        self.assertTrue(stage["destination_vercel_public_project_found"])
        self.assertFalse(stage["destination_vercel_oidc_binding_verified"])
        self.assertFalse(stage["destination_vercel_oidc_binding_verified"])
        self.assertFalse(stage["destination_vercel_oidc_runtime_e2e_verified"])
        blockers, _ = preflight.readiness(ROOT)
        for blocker in (
            "destination-internal-gateway-runtime-proof",
            "destination-vercel-oidc-project-binding",
            "destination-vercel-oidc-runtime-proof",
        ):
            self.assertIn(blocker, blockers)

    def test_service_transport_cannot_be_inferred_from_staging_gateway_deployment(self):
        hardening = preflight.load_json(ROOT, preflight.HARDENING)
        stage = hardening["postgresql_destination"]
        self.assertTrue(stage["internal_gateway_staging_deployed"])
        self.assertTrue(stage["internal_gateway_staging_verify_jwt"])
        self.assertFalse(stage["destination_service_transport_runtime_verified"])
        blockers, _ = preflight.readiness(ROOT)
        self.assertIn("destination-service-auth-transport-proof", blockers)

    def test_malformed_destination_evidence_fails_closed(self):
        temporary, root = self.fixture_root()
        try:
            path = root / preflight.HARDENING
            hardening = preflight.load_json(root, preflight.HARDENING)
            hardening["postgresql_destination"] = []
            path.write_text(__import__("json").dumps(hardening, indent=2) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "postgresql_destination must be an object"):
                preflight.readiness(root)
        finally:
            temporary.cleanup()

    def test_missing_or_empty_destination_evidence_fails_closed(self):
        for missing_value in (None, {}):
            temporary, root = self.fixture_root()
            try:
                path = root / preflight.HARDENING
                hardening = preflight.load_json(root, preflight.HARDENING)
                if missing_value is None:
                    hardening.pop("postgresql_destination")
                else:
                    hardening["postgresql_destination"] = missing_value
                path.write_text(
                    __import__("json").dumps(hardening, indent=2) + "\n",
                    encoding="utf-8",
                )
                if missing_value is None:
                    with self.assertRaisesRegex(ValueError, "postgresql_destination"):
                        preflight.readiness(root)
                else:
                    blockers, _ = preflight.readiness(root)
                    self.assertIn("account-provider-cutover-target-mismatch", blockers)
                    self.assertIn("destination-sync-export-db-proof", blockers)
            finally:
                temporary.cleanup()

    def test_public_login_legal_receipt_guard_deployment_is_mandatory(self):
        temporary, root = self.fixture_root()
        try:
            hardening_path = root / preflight.HARDENING
            hardening = preflight.load_json(root, preflight.HARDENING)
            hardening["current_observation"]["public_login_legal_receipt_guard_deployed"] = False
            hardening_path.write_text(
                __import__("json").dumps(hardening, indent=2) + "\n",
                encoding="utf-8",
            )
            blockers, _ = preflight.readiness(root)
            self.assertIn("public-login-legal-receipt-guard-deployment", blockers)
        finally:
            temporary.cleanup()

    def test_legacy_account_legal_reconciliation_is_mandatory(self):
        temporary, root = self.fixture_root()
        try:
            hardening_path = root / preflight.HARDENING
            hardening = preflight.load_json(root, preflight.HARDENING)
            hardening["current_observation"][
                "legacy_account_legal_receipt_reconciliation_verified"
            ] = False
            hardening_path.write_text(
                __import__("json").dumps(hardening, indent=2) + "\n",
                encoding="utf-8",
            )
            blockers, _ = preflight.readiness(root)
            self.assertIn("legacy-account-legal-receipt-reconciliation", blockers)
        finally:
            temporary.cleanup()

    def test_registration_provider_bypass_guard_is_mandatory(self):
        temporary, root = self.fixture_root()
        try:
            hardening_path = root / preflight.HARDENING
            hardening = preflight.load_json(root, preflight.HARDENING)
            hardening["current_observation"]["registration_provider_bypass_guard_verified"] = False
            hardening_path.write_text(
                __import__("json").dumps(hardening, indent=2) + "\n",
                encoding="utf-8",
            )
            blockers, _ = preflight.readiness(root)
            self.assertIn("registration-provider-bypass-guard", blockers)
        finally:
            temporary.cleanup()

    def test_edge_presence_and_oidc_source_alone_cannot_satisfy_public_rollout(self):
        temporary, root = self.fixture_root()
        try:
            deployment_path = root / preflight.DEPLOYMENT
            deployment = preflight.load_json(root, preflight.DEPLOYMENT)
            deployment["public_edge_gateway"]["deployed"] = True
            deployment["public_edge_gateway"]["oidc_source_ready"] = True
            deployment["public_edge_gateway"]["oidc_deployed"] = False
            deployment["public_edge_gateway"]["runtime_provenance_e2e_verified"] = False
            deployment["vercel_adapter"]["status"] = "oidc-source-ready-not-deployed"
            deployment["routing"]["vercel_adapter_routed_to_public_edge_gateway"] = False
            deployment_path.write_text(
                __import__("json").dumps(deployment, indent=2) + "\n",
                encoding="utf-8",
            )
            blockers, _ = preflight.readiness(root)
            self.assertNotIn("public-edge-gateway-deployment", blockers)
            self.assertNotIn("public-edge-oidc-source", blockers)
            self.assertIn("public-edge-oidc-deployment", blockers)
            self.assertIn("public-edge-provenance-proof", blockers)
            self.assertIn("vercel-same-origin-adapter-deployment", blockers)
            self.assertIn("vercel-public-edge-routing", blockers)
        finally:
            temporary.cleanup()

    def test_partial_activation_is_rejected(self):
        temporary, root = self.fixture_root()
        try:
            edge = root / preflight.EDGE
            edge.write_text(
                edge.read_text(encoding="utf-8").replace(
                    "const PUBLIC_SITE_ACCOUNT_ENABLED = false;",
                    "const PUBLIC_SITE_ACCOUNT_ENABLED = true;",
                ),
                encoding="utf-8",
            )
            python = root / preflight.REFERENCE_GATEWAY
            python.write_text(
                python.read_text(encoding="utf-8").replace(
                    "PUBLIC_SITE_ACCOUNT_ENABLED = False",
                    "PUBLIC_SITE_ACCOUNT_ENABLED = True",
                ),
                encoding="utf-8",
            )
            self.assertEqual(preflight.main(["check", "--root", str(root)]), 1)
        finally:
            temporary.cleanup()

    def test_registration_switch_must_match_edge_and_reference_gateway(self):
        temporary, root = self.fixture_root()
        try:
            edge = root / preflight.EDGE
            edge.write_text(
                edge.read_text(encoding="utf-8").replace(
                    "const ACCOUNT_REGISTRATION_ENABLED = false;",
                    "const ACCOUNT_REGISTRATION_ENABLED = true;",
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "activation switch mismatch"):
                preflight.readiness(root)
        finally:
            temporary.cleanup()

    def test_lifecycle_and_gateway_close_switches_must_match(self):
        temporary, root = self.fixture_root()
        try:
            lifecycle = root / preflight.LIFECYCLE_EDGE
            lifecycle.write_text(
                lifecycle.read_text(encoding="utf-8").replace(
                    "const ACCOUNT_CLOSE_ENABLED = false;",
                    "const ACCOUNT_CLOSE_ENABLED = true;",
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "lifecycle/gateway activation switch mismatch"):
                preflight.readiness(root)
        finally:
            temporary.cleanup()

    def test_edge_and_reference_activation_switches_must_match(self):
        temporary, root = self.fixture_root()
        try:
            edge = root / preflight.EDGE
            edge.write_text(
                edge.read_text(encoding="utf-8").replace(
                    "const ACCOUNT_RECOVERY_REQUEST_ENABLED = false;",
                    "const ACCOUNT_RECOVERY_REQUEST_ENABLED = true;",
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "activation switch mismatch"):
                preflight.readiness(root)
        finally:
            temporary.cleanup()


if __name__ == "__main__":
    unittest.main()
