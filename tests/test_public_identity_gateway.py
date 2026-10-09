import importlib.util
import json
import os
import sys
import unittest
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE_ROOT = ROOT / "services" / "public-identity"
GATEWAY_PATH = SERVICE_ROOT / "gateway.py"
CONTRACT_PATH = ROOT / "docs" / "contracts" / "public-identity-gateway.json"

if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

spec = importlib.util.spec_from_file_location("ordax_public_identity_gateway", GATEWAY_PATH)
gateway_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = gateway_module
spec.loader.exec_module(gateway_module)


class SafePasswordChecker:
    def is_compromised(self, password):
        return False


class PublicIdentityGatewayTests(unittest.TestCase):
    def setUp(self):
        self.gateway = gateway_module.PublicIdentityGateway(
            provider=None,
            sync_provider=None,
        )

    def payload(self, response):
        return json.loads(response.body.decode("utf-8"))

    def test_contract_records_real_flow_but_keeps_runtime_provider_unconfigured(self):
        contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            contract["status"],
            "real-auth-sync-export-spaces-memory-entitlement-gateway-source-v17-deployed-v17-revision-28-public-login-legal-receipt-guard-live-registration-disabled-close-disabled",
        )
        self.assertFalse(contract["baseline"]["provider_configured"])
        self.assertTrue(contract["baseline"]["http_only_session_cookies"])
        self.assertTrue(contract["baseline"]["refresh_session_supported"])
        self.assertFalse(contract["baseline"]["tokens_in_response_body_allowed"])
        self.assertFalse(contract["baseline"]["cross_site_state_changes_allowed"])
        self.assertTrue(contract["baseline"]["csrf_state_change_protection"])
        self.assertTrue(contract["deployment"]["same_origin_adapter_source_ready"])
        self.assertFalse(contract["deployment"]["same_origin_adapter_deployed"])
        self.assertFalse(contract["deployment"]["public_browser_same_origin_activated"])
        self.assertTrue(contract["baseline"]["browser_form_redirects_implemented"])
        self.assertTrue(contract["baseline"]["json_api_mode_preserved"])
        self.assertTrue(contract["baseline"]["compromised_password_screening_implemented"])
        self.assertEqual(
            contract["baseline"]["compromised_password_screening_scope"],
            ["registration", "recovery-password-change"],
        )
        self.assertFalse(contract["baseline"]["compromised_password_screening_login"])
        self.assertEqual(
            contract["baseline"]["compromised_password_screening_k_anonymity_prefix_chars"],
            5,
        )
        self.assertTrue(contract["baseline"]["compromised_password_screening_padding"])
        self.assertFalse(contract["baseline"]["compromised_password_screening_plaintext_sent"])
        self.assertFalse(contract["baseline"]["compromised_password_screening_full_hash_sent"])
        self.assertTrue(contract["baseline"]["compromised_password_screening_fail_closed"])
        self.assertEqual(contract["baseline"]["registration_password_minimum_chars"], 12)
        self.assertTrue(contract["baseline"]["registration_password_policy_enforced_at_edge"])
        self.assertFalse(contract["baseline"]["existing_login_passwords_retroactively_rejected"])
        self.assertEqual(contract["runtime"]["gateway_source_version"], 17)
        self.assertEqual(contract["runtime"]["deployed_gateway_source_version"], 17)
        self.assertTrue(contract["baseline"]["native_direct_auth_rate_limit_source_ready"])
        self.assertTrue(contract["baseline"]["native_direct_auth_rate_limit_deployed"])
        self.assertEqual(
            contract["baseline"]["native_direct_auth_rate_limit_rpc"],
            "ordax_consume_public_auth_rate_limit_v1",
        )
        self.assertEqual(
            contract["baseline"]["native_direct_auth_rate_limit_client_address_source"],
            "supabase-edge-cf-connecting-ip",
        )
        self.assertTrue(contract["baseline"]["native_direct_auth_rate_limit_fail_closed"])
        self.assertFalse(contract["baseline"]["native_direct_auth_rate_limit_raw_ip_persisted"])
        self.assertEqual(
            contract["baseline"]["native_direct_auth_rate_limit_deployment_revision_observed"],
            28,
        )
        self.assertEqual(contract["runtime"]["edge_deployment_revision_observed"], 28)
        self.assertTrue(contract["runtime"]["lifecycle_service_deployed"])
        self.assertEqual(contract["runtime"]["lifecycle_service_deployment_revision_observed"], 2)
        self.assertFalse(contract["runtime"]["lifecycle_service_enabled"])
        self.assertTrue(contract["baseline"]["account_export_implemented"])
        self.assertEqual(contract["baseline"]["account_export_rpc"], "ordax_account_export_v1")
        self.assertTrue(contract["baseline"]["account_export_requires_authenticated_user"])
        self.assertTrue(contract["baseline"]["account_export_security_definer"])
        self.assertEqual(
            contract["baseline"]["account_export_executor_role"],
            "ordax_account_export_executor",
        )
        self.assertFalse(contract["baseline"]["account_export_executor_login_allowed"])
        self.assertFalse(contract["baseline"]["account_export_executor_bypass_rls_allowed"])
        self.assertFalse(contract["baseline"]["account_export_executor_auth_schema_usage"])
        self.assertEqual(
            contract["baseline"]["account_export_subject_bridge"],
            "ordax_request_subject_v1",
        )
        self.assertFalse(contract["baseline"]["account_export_subject_bridge_api_role_execute_allowed"])
        self.assertTrue(contract["baseline"]["account_export_own_subject_only"])
        self.assertFalse(contract["baseline"]["account_export_anon_execute_allowed"])
        self.assertFalse(contract["baseline"]["account_export_service_role_execute_allowed"])
        self.assertFalse(contract["baseline"]["account_export_opaque_metadata_included"])
        self.assertFalse(contract["baseline"]["public_site_account_export_enabled"])
        self.assertTrue(contract["baseline"]["account_spaces_read_source_implemented"])
        self.assertTrue(contract["baseline"]["account_spaces_requires_authenticated_user"])
        self.assertTrue(contract["baseline"]["account_spaces_uses_user_bearer_rls"])
        self.assertEqual(contract["baseline"]["account_spaces_max_visible_items"], 64)
        self.assertFalse(contract["baseline"]["account_spaces_mutation_exposed"])
        self.assertTrue(contract["baseline"]["account_spaces_edge_deployed"])
        self.assertTrue(contract["baseline"]["account_memory_entitlement_read_source_implemented"])
        self.assertEqual(
            contract["baseline"]["account_memory_entitlement_route"],
            "/account/entitlements/memory-cloud",
        )
        self.assertEqual(
            contract["baseline"]["account_memory_entitlement_key"],
            "memory.cloud.enabled",
        )
        self.assertTrue(contract["baseline"]["account_memory_entitlement_requires_authenticated_user"])
        self.assertTrue(contract["baseline"]["account_memory_entitlement_subject_from_session"])
        self.assertTrue(contract["baseline"]["account_memory_entitlement_uses_user_bearer_rls"])
        self.assertTrue(contract["baseline"]["account_memory_entitlement_server_authoritative"])
        self.assertFalse(contract["baseline"]["account_memory_entitlement_mutation_exposed"])
        self.assertFalse(contract["baseline"]["account_memory_entitlement_service_role_used"])
        self.assertTrue(contract["baseline"]["account_memory_entitlement_edge_deployed"])
        self.assertEqual(
            contract["baseline"]["account_memory_entitlement_edge_deployment_revision_observed"],
            28,
        )
        self.assertFalse(contract["baseline"]["public_cloud_memory_enabled"])
        self.assertTrue(contract["baseline"]["account_close_source_implemented"])
        self.assertFalse(contract["baseline"]["account_close_enabled"])
        self.assertTrue(contract["baseline"]["account_close_gateway_route_deployed"])
        self.assertTrue(contract["baseline"]["account_close_requires_recent_reauthentication"])
        self.assertTrue(contract["baseline"]["account_close_requires_explicit_confirmation"])
        self.assertFalse(contract["baseline"]["account_close_service_role_in_public_gateway"])
        self.assertTrue(contract["baseline"]["account_close_service_role_isolated_to_lifecycle_service"])
        self.assertTrue(contract["baseline"]["public_site_server_activation_gate"])
        self.assertFalse(contract["baseline"]["account_registration_enabled"])
        self.assertTrue(contract["baseline"]["account_registration_legal_binding_required"])
        self.assertTrue(contract["baseline"]["account_registration_server_authoritative_receipt_implemented"])
        self.assertEqual(
            contract["baseline"]["account_registration_legal_intent_rpc"],
            "ordax_begin_account_registration_legal_intent_v1",
        )
        self.assertTrue(contract["baseline"]["account_registration_legal_intent_service_role_only"])
        self.assertFalse(contract["baseline"]["account_registration_client_document_versions_allowed"])
        self.assertFalse(contract["baseline"]["account_registration_active_legal_policy_present"])
        self.assertFalse(contract["baseline"]["account_registration_web_acceptance_bound"])
        self.assertFalse(contract["baseline"]["account_registration_native_acceptance_bound"])
        self.assertFalse(contract["baseline"]["native_registration_may_bypass_legal_binding"])
        self.assertTrue(contract["baseline"]["account_registration_policy_projection_implemented"])
        self.assertEqual(contract["baseline"]["account_registration_policy_route"], "/auth/registration-policy")
        self.assertTrue(contract["baseline"]["account_registration_policy_route_read_only"])
        self.assertTrue(contract["baseline"]["account_registration_policy_service_role_only"])
        self.assertFalse(contract["baseline"]["account_registration_policy_active"])
        self.assertTrue(contract["baseline"]["account_registration_ui_binding_source_ready"])
        self.assertFalse(contract["baseline"]["public_site_account_enabled"])
        self.assertEqual(contract["baseline"]["public_site_marker_header"], "X-OrdaX-Public-Site")
        self.assertEqual(contract["baseline"]["public_site_disabled_error"], "public-account-access-disabled")
        self.assertTrue(contract["baseline"]["native_json_account_flow_remains_enabled"])
        self.assertTrue(contract["deployment"]["public_site_proxy_marker_required"])
        self.assertTrue(contract["baseline"]["password_recovery_request_implemented"])
        self.assertFalse(contract["baseline"]["password_recovery_request_enabled"])
        self.assertTrue(contract["baseline"]["password_recovery_server_side_token_hash_required"])
        self.assertTrue(contract["baseline"]["password_recovery_server_side_token_hash_implemented"])
        self.assertTrue(contract["baseline"]["password_recovery_redirect_required"])
        self.assertFalse(contract["baseline"]["password_recovery_redirect_verified"])
        self.assertFalse(contract["baseline"]["password_recovery_account_enumeration_allowed"])
        self.assertTrue(contract["baseline"]["password_recovery_completion_flow_implemented"])
        self.assertFalse(contract["baseline"]["password_recovery_completion_enabled"])
        self.assertTrue(contract["baseline"]["password_recovery_short_lived_session_cookie"])
        self.assertEqual(contract["baseline"]["password_recovery_session_max_age_seconds"], 600)
        self.assertFalse(contract["baseline"]["password_recovery_email_template_applied"])

    def test_marked_public_site_requests_are_server_gated(self):
        marker = {"X-OrdaX-Public-Site": "1"}

        session = self.gateway.handle("GET", "/auth/session", marker)
        self.assertEqual(session.status, 200)
        session_payload = self.payload(session)
        self.assertFalse(session_payload["authenticated"])
        self.assertEqual(session_payload["provider"], "unconfigured")

        sync = self.gateway.handle("GET", "/sync/snapshot?limit=1", marker)
        self.assertEqual(sync.status, 503)
        self.assertEqual(self.payload(sync)["error"], "public-account-access-disabled")

        export = self.gateway.handle("GET", "/account/export", marker)
        self.assertEqual(export.status, 503)
        self.assertEqual(self.payload(export)["error"], "public-account-access-disabled")

        spaces = self.gateway.handle("GET", "/account/spaces", marker)
        self.assertEqual(spaces.status, 503)
        self.assertEqual(self.payload(spaces)["error"], "public-account-access-disabled")

        entitlement = self.gateway.handle(
            "GET",
            "/account/entitlements/memory-cloud",
            marker,
        )
        self.assertEqual(entitlement.status, 503)
        self.assertEqual(self.payload(entitlement)["error"], "public-account-access-disabled")

        close = self.gateway.handle(
            "POST",
            "/account/close",
            {**marker, "content-type": "application/x-www-form-urlencoded"},
            b"password=secret&confirmation=close-account",
        )
        self.assertEqual(close.status, 503)
        self.assertEqual(self.payload(close)["error"], "public-account-access-disabled")

    def test_spaces_route_uses_authenticated_subject_and_neutral_account_provider(self):
        class FakeIdentityProvider:
            def get_user(self, access_token):
                self.last_token = access_token
                return "user-1", "user@example.com"

        class FakeAccountProvider:
            def list_spaces(self, access_token):
                self.last_token = access_token
                return [{
                    "id": "space-1",
                    "ownerId": "user-1",
                    "name": "Developer",
                    "kind": "professional",
                    "state": "active",
                    "profilePack": "developer",
                }]

        identity = FakeIdentityProvider()
        account = FakeAccountProvider()
        gateway = gateway_module.PublicIdentityGateway(
            provider=identity,
            sync_provider=None,
            account_provider=account,
            password_checker=SafePasswordChecker(),
        )
        response = gateway.handle(
            "GET",
            "/account/spaces",
            {"cookie": "ordax_access=user-access-token"},
        )

        self.assertEqual(response.status, 200)
        payload = self.payload(response)
        self.assertEqual(payload["$schema"], "prototype-ordax.account-spaces/1")
        self.assertEqual(payload["spaces"][0]["id"], "space-1")
        self.assertEqual(identity.last_token, "user-access-token")
        self.assertEqual(account.last_token, "user-access-token")

    def test_registration_rejects_compromised_password_before_provider(self):
        class FakeProvider:
            def __init__(self):
                self.calls = []

            def sign_up_with_password(self, email, password):
                self.calls.append((email, password))
                raise AssertionError("provider must not receive compromised password")

        class CompromisedChecker:
            def is_compromised(self, password):
                return True

        provider = FakeProvider()
        gateway = gateway_module.PublicIdentityGateway(
            provider=provider,
            sync_provider=None,
            password_checker=CompromisedChecker(),
        )
        with patch.object(gateway_module, "ACCOUNT_REGISTRATION_ENABLED", True):
            response = gateway.handle(
                "POST",
                "/auth/register",
                {"content-type": "application/x-www-form-urlencoded"},
                b"email=pessoa%40example.com&password=compromised-password-12&legal_acceptance=accepted",
            )
        self.assertEqual(response.status, 400)
        self.assertEqual(self.payload(response)["error"], "compromised-password")
        self.assertEqual(provider.calls, [])

    def test_registration_fails_closed_when_password_screening_is_unavailable(self):
        class FakeProvider:
            def sign_up_with_password(self, email, password):
                raise AssertionError("provider must not be reached")

        class UnavailableChecker:
            def is_compromised(self, password):
                raise gateway_module.PwnedPasswordsError("unavailable")

        gateway = gateway_module.PublicIdentityGateway(
            provider=FakeProvider(),
            sync_provider=None,
            password_checker=UnavailableChecker(),
        )
        with patch.object(gateway_module, "ACCOUNT_REGISTRATION_ENABLED", True):
            response = gateway.handle(
                "POST",
                "/auth/register",
                {"content-type": "application/x-www-form-urlencoded"},
                b"email=pessoa%40example.com&password=new-password-12&legal_acceptance=accepted",
            )
        self.assertEqual(response.status, 503)
        self.assertEqual(self.payload(response)["error"], "password-screening-unavailable")

    def test_public_login_requires_server_verified_legal_receipt(self):
        class FakeProvider:
            def __init__(self):
                self.local_signouts = []

            def sign_in_with_password(self, email, password):
                session = type(
                    "Session",
                    (),
                    {
                        "access_token": "access",
                        "refresh_token": "refresh",
                        "expires_in": 3600,
                    },
                )()
                return type(
                    "Result",
                    (),
                    {
                        "subject_id": "11111111-1111-4111-8111-111111111111",
                        "email": "person@example.com",
                        "session": session,
                    },
                )()

            def sign_out_local(self, access_token):
                self.local_signouts.append(access_token)

        class ReceiptAuthority:
            def __init__(self, value):
                self.value = value
                self.calls = []

            def has_registration_receipt(self, user_id):
                self.calls.append(user_id)
                return self.value

        headers = {
            "X-OrDaX-Public-Site": "1",
            "content-type": "application/x-www-form-urlencoded",
        }
        body = b"email=person%40example.com&password=old-pass"

        denied_provider = FakeProvider()
        denied_authority = ReceiptAuthority(False)
        denied_gateway = gateway_module.PublicIdentityGateway(
            provider=denied_provider,
            sync_provider=None,
            registration_legal_authority=denied_authority,
        )
        with patch.object(gateway_module, "PUBLIC_SITE_ACCOUNT_ENABLED", True):
            denied = denied_gateway.handle("POST", "/auth/login", headers, body)
        self.assertEqual(denied.status, 403)
        self.assertEqual(self.payload(denied)["error"], "account-legal-receipt-required")
        self.assertEqual(denied_provider.local_signouts, ["access"])
        self.assertEqual(
            denied_authority.calls,
            ["11111111-1111-4111-8111-111111111111"],
        )
        self.assertFalse(any(key == "Set-Cookie" for key, _ in denied.headers))

        allowed_provider = FakeProvider()
        allowed_authority = ReceiptAuthority(True)
        allowed_gateway = gateway_module.PublicIdentityGateway(
            provider=allowed_provider,
            sync_provider=None,
            registration_legal_authority=allowed_authority,
        )
        with patch.object(gateway_module, "PUBLIC_SITE_ACCOUNT_ENABLED", True):
            allowed = allowed_gateway.handle("POST", "/auth/login", headers, body)
        self.assertEqual(allowed.status, 303)
        self.assertEqual(dict(allowed.headers)["Location"], "/conta/")
        self.assertEqual(allowed_provider.local_signouts, [])
        self.assertTrue(any(key == "Set-Cookie" for key, _ in allowed.headers))

    def test_public_login_fails_closed_when_legal_receipt_check_is_unavailable(self):
        class FakeProvider:
            def __init__(self):
                self.local_signouts = []

            def sign_in_with_password(self, email, password):
                session = type(
                    "Session",
                    (),
                    {
                        "access_token": "access",
                        "refresh_token": "refresh",
                        "expires_in": 3600,
                    },
                )()
                return type(
                    "Result",
                    (),
                    {
                        "subject_id": "11111111-1111-4111-8111-111111111111",
                        "email": "person@example.com",
                        "session": session,
                    },
                )()

            def sign_out_local(self, access_token):
                self.local_signouts.append(access_token)

        class BrokenAuthority:
            def has_registration_receipt(self, user_id):
                raise gateway_module.RegistrationLegalError("unavailable")

        provider = FakeProvider()
        gateway = gateway_module.PublicIdentityGateway(
            provider=provider,
            sync_provider=None,
            registration_legal_authority=BrokenAuthority(),
        )
        with patch.object(gateway_module, "PUBLIC_SITE_ACCOUNT_ENABLED", True):
            response = gateway.handle(
                "POST",
                "/auth/login",
                {
                    "X-OrDaX-Public-Site": "1",
                    "content-type": "application/x-www-form-urlencoded",
                },
                b"email=person%40example.com&password=old-pass",
            )
        self.assertEqual(response.status, 503)
        self.assertEqual(
            self.payload(response)["error"],
            "account-legal-receipt-check-unavailable",
        )
        self.assertEqual(provider.local_signouts, ["access"])
        self.assertFalse(any(key == "Set-Cookie" for key, _ in response.headers))

    def test_existing_password_login_does_not_call_compromised_password_screening(self):
        class FakeProvider:
            def sign_in_with_password(self, email, password):
                session = type(
                    "Session",
                    (),
                    {
                        "access_token": "access",
                        "refresh_token": "refresh",
                        "expires_in": 3600,
                    },
                )()
                return type("Result", (), {"session": session})()

        class MustNotRunChecker:
            def is_compromised(self, password):
                raise AssertionError("login must not screen existing passwords")

        gateway = gateway_module.PublicIdentityGateway(
            provider=FakeProvider(),
            sync_provider=None,
            password_checker=MustNotRunChecker(),
        )
        response = gateway.handle(
            "POST",
            "/auth/login",
            {"content-type": "application/x-www-form-urlencoded"},
            b"email=pessoa%40example.com&password=old-pass",
        )
        self.assertEqual(response.status, 303)
        self.assertEqual(dict(response.headers)["Location"], "/conta/")

    def test_session_is_anonymous_and_contains_no_tokens_without_runtime_config(self):
        response = self.gateway.handle("GET", "/auth/session")
        self.assertEqual(response.status, 200)
        payload = self.payload(response)
        self.assertFalse(payload["authenticated"])
        self.assertEqual(payload["provider"], "unconfigured")
        self.assertFalse(payload["accountCloseEnabled"])
        body = response.body.decode("utf-8").lower()
        for forbidden in ("access_token", "refresh_token", "bearer", "password"):
            self.assertNotIn(forbidden, body)
        self.assertIn(("Cache-Control", "no-store, max-age=0"), response.headers)

    def test_identity_entry_get_routes_are_canonical_same_origin_pages(self):
        cases = (
            ("/auth/login", "/login/"),
            ("/auth/register", "/cadastro/"),
        )
        for path, location in cases:
            with self.subTest(path=path):
                response = self.gateway.handle("GET", path)
                self.assertEqual(response.status, 303)
                self.assertEqual(dict(response.headers)["Location"], location)

    def test_registration_policy_is_read_only_server_projection(self):
        class FakeAuthority:
            def active_policy(self):
                return type(
                    "Policy",
                    (),
                    {
                        "policy_id": "11111111-1111-4111-8111-111111111111",
                        "privacy_version": "2026-10-02",
                        "privacy_effective_date": "2026-10-02",
                        "privacy_sha256": "a" * 64,
                        "privacy_url": "https://ordax.example/privacidade/",
                        "terms_version": "2026-10-02",
                        "terms_effective_date": "2026-10-02",
                        "terms_sha256": "b" * 64,
                        "terms_url": "https://ordax.example/termos/",
                    },
                )()

        gateway = gateway_module.PublicIdentityGateway(
            provider=None,
            sync_provider=None,
            registration_legal_authority=FakeAuthority(),
        )
        response = gateway.handle("GET", "/auth/registration-policy")
        self.assertEqual(response.status, 200)
        payload = self.payload(response)
        self.assertEqual(payload["$schema"], "prototype-ordax.registration-legal-policy/1")
        self.assertTrue(payload["active"])
        self.assertFalse(payload["registrationEnabled"])
        self.assertEqual(payload["privacy"]["version"], "2026-10-02")
        self.assertEqual(payload["privacy"]["url"], "https://ordax.example/privacidade/")
        self.assertEqual(payload["terms"]["sha256"], "b" * 64)

    def test_public_site_may_read_policy_while_account_actions_remain_gated(self):
        class FakeAuthority:
            def active_policy(self):
                return type(
                    "Policy",
                    (),
                    {
                        "policy_id": "11111111-1111-4111-8111-111111111111",
                        "privacy_version": "v1",
                        "privacy_effective_date": "2026-10-02",
                        "privacy_sha256": "a" * 64,
                        "privacy_url": "https://ordax.example/privacidade/",
                        "terms_version": "v1",
                        "terms_effective_date": "2026-10-02",
                        "terms_sha256": "b" * 64,
                        "terms_url": "https://ordax.example/termos/",
                    },
                )()

        gateway = gateway_module.PublicIdentityGateway(
            provider=None,
            sync_provider=None,
            registration_legal_authority=FakeAuthority(),
        )
        marker = {"X-OrdaX-Public-Site": "1"}
        policy = gateway.handle("GET", "/auth/registration-policy", marker)
        self.assertEqual(policy.status, 200)
        self.assertTrue(self.payload(policy)["registrationEnabled"])

        register = gateway.handle(
            "POST",
            "/auth/register",
            {
                "X-OrDaX-Public-Site": "1",
                "content-type": "application/x-www-form-urlencoded",
            },
            b"email=pessoa%40example.com&password=new-password-12&legal_acceptance=accepted",
        )
        self.assertEqual(register.status, 503)
        self.assertEqual(self.payload(register)["error"], "identity-provider-unavailable")

    def test_registration_policy_fails_closed_without_active_policy(self):
        class MissingAuthority:
            def active_policy(self):
                raise gateway_module.RegistrationLegalError("registration-legal-policy-unavailable")

        gateway = gateway_module.PublicIdentityGateway(
            provider=None,
            sync_provider=None,
            registration_legal_authority=MissingAuthority(),
        )
        response = gateway.handle("GET", "/auth/registration-policy")
        self.assertEqual(response.status, 503)
        self.assertEqual(self.payload(response)["error"], "registration-legal-policy-unavailable")

    def test_registration_is_disabled_before_legal_binding_even_with_provider(self):
        class MustNotRunProvider:
            def sign_up_with_password(self, email, password):
                raise AssertionError("registration provider must not run while legal binding is disabled")

        gateway = gateway_module.PublicIdentityGateway(
            provider=MustNotRunProvider(),
            sync_provider=None,
        )
        response = gateway.handle(
            "POST",
            "/auth/register",
            {"content-type": "application/x-www-form-urlencoded"},
            b"email=pessoa%40example.com&password=new-password-12",
        )
        self.assertEqual(response.status, 503)
        self.assertEqual(self.payload(response)["error"], "account-registration-disabled")

    def test_enabled_registration_requires_explicit_legal_acceptance_before_authority(self):
        class MustNotRunProvider:
            def sign_up_with_password(self, *args, **kwargs):
                raise AssertionError("provider must not run without legal acceptance")

        class MustNotRunAuthority:
            def begin_intent(self, email):
                raise AssertionError("legal authority must not run without legal acceptance")

        gateway = gateway_module.PublicIdentityGateway(
            provider=MustNotRunProvider(),
            sync_provider=None,
            registration_legal_authority=MustNotRunAuthority(),
            password_checker=SafePasswordChecker(),
        )
        with patch.object(gateway_module, "ACCOUNT_REGISTRATION_ENABLED", True):
            response = gateway.handle(
                "POST",
                "/auth/register",
                {"content-type": "application/x-www-form-urlencoded"},
                b"email=pessoa%40example.com&password=new-password-12",
            )
        self.assertEqual(response.status, 400)
        self.assertEqual(self.payload(response)["error"], "legal-acceptance-required")

    def test_enabled_registration_fails_closed_without_server_legal_authority(self):
        class MustNotRunProvider:
            def sign_up_with_password(self, *args, **kwargs):
                raise AssertionError("provider must not run without legal authority")

        gateway = gateway_module.PublicIdentityGateway(
            provider=MustNotRunProvider(),
            sync_provider=None,
            registration_legal_authority=None,
            password_checker=SafePasswordChecker(),
        )
        gateway.registration_legal_authority = None
        with patch.object(gateway_module, "ACCOUNT_REGISTRATION_ENABLED", True):
            response = gateway.handle(
                "POST",
                "/auth/register",
                {"content-type": "application/x-www-form-urlencoded"},
                b"email=pessoa%40example.com&password=new-password-12&legal_acceptance=accepted",
            )
        self.assertEqual(response.status, 503)
        self.assertEqual(self.payload(response)["error"], "registration-legal-policy-unavailable")

    def test_enabled_registration_binds_provider_signup_to_server_issued_intent(self):
        class FakeAuthority:
            def __init__(self):
                self.calls = []

            def begin_intent(self, email):
                self.calls.append(email)
                return type(
                    "Intent",
                    (),
                    {"intent_id": "11111111-1111-4111-8111-111111111111"},
                )()

        class FakeProvider:
            def __init__(self):
                self.calls = []

            def sign_up_with_password(self, email, password, *, registration_intent_id=None):
                self.calls.append((email, password, registration_intent_id))
                return type("Result", (), {"session": None})()

        authority = FakeAuthority()
        provider = FakeProvider()
        gateway = gateway_module.PublicIdentityGateway(
            provider=provider,
            sync_provider=None,
            registration_legal_authority=authority,
            password_checker=SafePasswordChecker(),
        )
        with patch.object(gateway_module, "ACCOUNT_REGISTRATION_ENABLED", True):
            response = gateway.handle(
                "POST",
                "/auth/register",
                {"content-type": "application/x-www-form-urlencoded"},
                b"email=pessoa%40example.com&password=new-password-12&legal_acceptance=accepted",
            )
        self.assertEqual(response.status, 303)
        self.assertEqual(dict(response.headers)["Location"], "/login/?cadastro=verifique-email")
        self.assertEqual(authority.calls, ["pessoa@example.com"])
        self.assertEqual(
            provider.calls,
            [
                (
                    "pessoa@example.com",
                    "new-password-12",
                    "11111111-1111-4111-8111-111111111111",
                )
            ],
        )

    def test_credential_login_fails_closed_until_provider_exists(self):
        response = self.gateway.handle(
            "POST",
            "/auth/login",
            {"content-type": "application/x-www-form-urlencoded"},
            b"email=pessoa%40example.com&password=secret",
        )
        self.assertEqual(response.status, 503)
        self.assertEqual(
            self.payload(response)["error"],
            "identity-provider-unavailable",
        )

    def test_logout_is_idempotent_and_clears_local_session_cookies(self):
        response = self.gateway.handle("POST", "/auth/logout")
        self.assertEqual(response.status, 303)
        cookies = [value for key, value in response.headers if key == "Set-Cookie"]
        self.assertEqual(len(cookies), 5)
        self.assertTrue(all("HttpOnly" in value for value in cookies))
        self.assertTrue(all("Max-Age=0" in value for value in cookies))
        self.assertTrue(
            any(
                value.startswith("ordax_recovery_access=;")
                and "Path=/auth/recover" in value
                for value in cookies
            )
        )
        self.assertTrue(
            any(
                value.startswith("ordax_recovery_refresh=;")
                and "Path=/auth/recover" in value
                for value in cookies
            )
        )

    def test_recovery_request_is_disabled_even_if_redirect_were_configured(self):
        class FakeProvider:
            def __init__(self):
                self.calls = []

            def request_password_recovery(self, email, redirect_to):
                self.calls.append((email, redirect_to))

        provider = FakeProvider()
        gateway = gateway_module.PublicIdentityGateway(
            provider=provider,
            sync_provider=None,
        )
        headers = {"content-type": "application/x-www-form-urlencoded"}
        with patch.dict(
            os.environ,
            {"ORDAX_ACCOUNT_RECOVERY_REDIRECT_URL": "https://accounts.ordax.example/auth/recover/verify"},
            clear=False,
        ):
            response = gateway.handle(
                "POST",
                "/auth/recover",
                headers,
                b"email=pessoa%40example.com",
            )
        self.assertEqual(response.status, 503)
        self.assertEqual(self.payload(response)["error"], "account-recovery-disabled")
        self.assertEqual(provider.calls, [])

    def test_enabled_recovery_still_fails_closed_without_redirect_configuration(self):
        class FakeProvider:
            def __init__(self):
                self.calls = []

            def request_password_recovery(self, email, redirect_to):
                self.calls.append((email, redirect_to))

        provider = FakeProvider()
        gateway = gateway_module.PublicIdentityGateway(
            provider=provider,
            sync_provider=None,
        )
        headers = {"content-type": "application/x-www-form-urlencoded"}
        with patch.object(gateway_module, "ACCOUNT_RECOVERY_REQUEST_ENABLED", True), patch.dict(
            os.environ,
            {"ORDAX_ACCOUNT_RECOVERY_REDIRECT_URL": ""},
            clear=False,
        ):
            response = gateway.handle(
                "POST",
                "/auth/recover",
                headers,
                b"email=pessoa%40example.com",
            )
        self.assertEqual(response.status, 503)
        self.assertEqual(self.payload(response)["error"], "account-recovery-unavailable")
        self.assertEqual(provider.calls, [])

    def test_recovery_request_is_generic_and_uses_clean_https_redirect(self):
        class FakeProvider:
            def __init__(self):
                self.calls = []

            def request_password_recovery(self, email, redirect_to):
                self.calls.append((email, redirect_to))

        provider = FakeProvider()
        gateway = gateway_module.PublicIdentityGateway(
            provider=provider,
            sync_provider=None,
        )
        headers = {"content-type": "application/x-www-form-urlencoded"}
        with patch.object(gateway_module, "ACCOUNT_RECOVERY_REQUEST_ENABLED", True), patch.dict(
            os.environ,
            {"ORDAX_ACCOUNT_RECOVERY_REDIRECT_URL": "https://accounts.ordax.example/auth/recover/verify"},
            clear=False,
        ):
            response = gateway.handle(
                "POST",
                "/auth/recover",
                headers,
                b"email=pessoa%40example.com",
            )
        self.assertEqual(response.status, 202)
        payload = self.payload(response)
        self.assertTrue(payload["recoveryRequested"])
        self.assertNotIn("exists", response.body.decode("utf-8").lower())
        self.assertEqual(
            provider.calls,
            [("pessoa@example.com", "https://accounts.ordax.example/auth/recover/verify")],
        )

    def test_recovery_completion_is_disabled_even_with_valid_token_hash(self):
        class FakeProvider:
            def __init__(self):
                self.verify_calls = []

            def verify_recovery_token(self, token_hash):
                self.verify_calls.append(token_hash)
                return type(
                    "Session",
                    (),
                    {
                        "access_token": "recovery-access",
                        "refresh_token": "recovery-refresh",
                        "expires_in": 600,
                    },
                )()

        provider = FakeProvider()
        gateway = gateway_module.PublicIdentityGateway(provider=provider, sync_provider=None)
        response = gateway.handle(
            "GET",
            "/auth/recover/verify?token_hash=" + ("a" * 64) + "&type=recovery",
        )
        self.assertEqual(response.status, 503)
        self.assertEqual(self.payload(response)["error"], "account-recovery-completion-disabled")
        self.assertEqual(provider.verify_calls, [])

    def test_enabled_recovery_completion_uses_short_lived_http_only_marker_and_logs_out(self):
        class FakeProvider:
            def __init__(self):
                self.updated = []
                self.signed_out = []

            def verify_recovery_token(self, token_hash):
                return type(
                    "Session",
                    (),
                    {
                        "access_token": "recovery-access",
                        "refresh_token": "recovery-refresh",
                        "expires_in": 3600,
                    },
                )()

            def get_user(self, access_token):
                if access_token != "recovery-access":
                    raise AssertionError(access_token)
                return ("user-1", "person@example.com")

            def update_password(self, access_token, new_password):
                self.updated.append((access_token, new_password))

            def sign_out(self, access_token):
                self.signed_out.append(access_token)

        provider = FakeProvider()
        gateway = gateway_module.PublicIdentityGateway(
            provider=provider,
            sync_provider=None,
            password_checker=SafePasswordChecker(),
        )
        with patch.object(gateway_module, "ACCOUNT_RECOVERY_COMPLETION_ENABLED", True):
            verify = gateway.handle(
                "GET",
                "/auth/recover/verify?token_hash=" + ("a" * 64) + "&type=recovery",
            )
        self.assertEqual(verify.status, 303)
        self.assertEqual(dict(verify.headers)["Location"], "/recuperar/nova-senha/")
        cookies = [value for key, value in verify.headers if key == "Set-Cookie"]
        self.assertEqual(len(cookies), 5)
        self.assertTrue(
            any(
                value.startswith("ordax_access=;") and "Max-Age=0" in value
                for value in cookies
            )
        )
        self.assertTrue(
            any(
                value.startswith("ordax_refresh=;") and "Max-Age=0" in value
                for value in cookies
            )
        )
        self.assertTrue(
            any(
                value.startswith("ordax_recovery=1;")
                and "Path=/auth/recover" in value
                and "Max-Age=600" in value
                for value in cookies
            )
        )
        self.assertTrue(
            any(
                value.startswith("ordax_recovery_access=recovery-access;")
                and "Path=/auth/recover" in value
                and "Max-Age=600" in value
                for value in cookies
            )
        )
        self.assertTrue(
            any(
                value.startswith("ordax_recovery_refresh=recovery-refresh;")
                and "Path=/auth/recover" in value
                and "Max-Age=600" in value
                for value in cookies
            )
        )
        self.assertTrue(all("HttpOnly" in value for value in cookies))

        headers = {
            "content-type": "application/x-www-form-urlencoded",
            "cookie": (
                "ordax_recovery_access=recovery-access; "
                "ordax_recovery_refresh=recovery-refresh; "
                "ordax_recovery=1"
            ),
        }
        with patch.object(gateway_module, "ACCOUNT_RECOVERY_COMPLETION_ENABLED", True):
            complete = gateway.handle(
                "POST",
                "/auth/recover/complete",
                headers,
                b"password=new-password-12&password_confirmation=new-password-12",
            )
        self.assertEqual(complete.status, 303)
        self.assertEqual(dict(complete.headers)["Location"], "/login/?recuperacao=concluida")
        self.assertEqual(provider.updated, [("recovery-access", "new-password-12")])
        self.assertEqual(provider.signed_out, ["recovery-access"])
        cleared = [value for key, value in complete.headers if key == "Set-Cookie"]
        self.assertEqual(len(cleared), 5)
        self.assertTrue(all("Max-Age=0" in value for value in cleared))

    def test_recovery_only_session_cannot_authenticate_normal_account_routes(self):
        class FakeProvider:
            def get_user(self, access_token):
                if access_token == "recovery-access":
                    return ("user-1", "person@example.com")
                raise gateway_module.SupabaseIdentityError("invalid-token")

        class MustNotExport:
            def export_account(self, access_token):
                raise AssertionError(
                    "recovery-only session must never reach account export"
                )

        gateway = gateway_module.PublicIdentityGateway(
            provider=FakeProvider(),
            sync_provider=None,
            account_provider=MustNotExport(),
        )
        response = gateway.handle(
            "GET",
            "/account/export",
            {
                "cookie": (
                    "ordax_recovery_access=recovery-access; "
                    "ordax_recovery_refresh=recovery-refresh; "
                    "ordax_recovery=1"
                )
            },
        )
        self.assertEqual(response.status, 401)
        self.assertEqual(
            self.payload(response)["error"],
            "authentication-required",
        )

    def test_marked_public_recovery_request_remains_server_gated(self):
        response = self.gateway.handle(
            "POST",
            "/auth/recover",
            {
                "X-OrdaX-Public-Site": "1",
                "content-type": "application/x-www-form-urlencoded",
            },
            b"email=pessoa%40example.com",
        )
        self.assertEqual(response.status, 503)
        self.assertEqual(self.payload(response)["error"], "public-account-access-disabled")

    def test_account_close_is_disabled_before_reauthentication(self):
        class MustNotRunIdentity:
            def get_user(self, access_token):
                raise AssertionError("identity provider must not run while close is disabled")

        class MustNotRunLifecycle:
            def close_account(self, access_token, confirmation):
                raise AssertionError("lifecycle service must not run while close is disabled")

        gateway = gateway_module.PublicIdentityGateway(
            provider=MustNotRunIdentity(),
            sync_provider=None,
            lifecycle_provider=MustNotRunLifecycle(),
        )
        response = gateway.handle(
            "POST",
            "/account/close",
            {"content-type": "application/x-www-form-urlencoded"},
            b"password=secret&confirmation=close-account",
        )
        self.assertEqual(response.status, 503)
        self.assertEqual(self.payload(response)["error"], "account-close-disabled")

    def test_session_projects_account_close_capability_from_server_gate_only(self):
        class FakeIdentity:
            def get_user(self, access_token):
                self.last_token = access_token
                return ("user-1", "person@example.com")

        identity = FakeIdentity()
        gateway = gateway_module.PublicIdentityGateway(
            provider=identity,
            sync_provider=None,
        )
        headers = {"cookie": "ordax_access=existing-access"}

        disabled = gateway.handle("GET", "/auth/session", headers)
        self.assertEqual(disabled.status, 200)
        self.assertFalse(self.payload(disabled)["accountCloseEnabled"])

        with patch.object(gateway_module, "ACCOUNT_CLOSE_ENABLED", True):
            enabled = gateway.handle("GET", "/auth/session", headers)
        self.assertEqual(enabled.status, 200)
        self.assertTrue(self.payload(enabled)["accountCloseEnabled"])
        self.assertEqual(identity.last_token, "existing-access")

    def test_enabled_account_close_requires_confirmation_and_uses_fresh_session(self):
        class FakeIdentity:
            def __init__(self):
                self.login_calls = []

            def get_user(self, access_token):
                self.last_get_user = access_token
                return ("user-1", "person@example.com")

            def sign_in_with_password(self, email, password):
                self.login_calls.append((email, password))
                session = type(
                    "Session",
                    (),
                    {
                        "access_token": "fresh-access",
                        "refresh_token": "fresh-refresh",
                        "expires_in": 3600,
                    },
                )()
                return type("Result", (), {"session": session})()

        class FakeLifecycle:
            def __init__(self):
                self.calls = []

            def close_account(self, access_token, confirmation):
                self.calls.append((access_token, confirmation))

        identity = FakeIdentity()
        lifecycle = FakeLifecycle()
        gateway = gateway_module.PublicIdentityGateway(
            provider=identity,
            sync_provider=None,
            lifecycle_provider=lifecycle,
        )

        with patch.object(gateway_module, "ACCOUNT_CLOSE_ENABLED", True):
            bad = gateway.handle(
                "POST",
                "/account/close",
                {
                    "content-type": "application/x-www-form-urlencoded",
                    "cookie": "ordax_access=existing-access",
                },
                b"password=secret&confirmation=wrong",
            )
        self.assertEqual(bad.status, 400)
        self.assertEqual(identity.login_calls, [])
        self.assertEqual(lifecycle.calls, [])

        with patch.object(gateway_module, "ACCOUNT_CLOSE_ENABLED", True):
            ok = gateway.handle(
                "POST",
                "/account/close",
                {
                    "content-type": "application/x-www-form-urlencoded",
                    "cookie": "ordax_access=existing-access",
                },
                b"password=secret&confirmation=close-account",
            )
        self.assertEqual(ok.status, 303)
        self.assertEqual(dict(ok.headers)["Location"], "/")
        self.assertEqual(identity.login_calls, [("person@example.com", "secret")])
        self.assertEqual(lifecycle.calls, [("fresh-access", "close-account")])
        cleared = [value for key, value in ok.headers if key == "Set-Cookie"]
        self.assertEqual(len(cleared), 5)
        self.assertTrue(all("Max-Age=0" in value for value in cleared))

    def test_account_export_uses_authenticated_user_and_neutral_provider(self):
        class FakeIdentityProvider:
            def get_user(self, access_token):
                self.assert_token = access_token
                return ("user-1", "person@example.com")

        class FakeAccountProvider:
            def __init__(self):
                self.calls = []

            def export_account(self, access_token):
                self.calls.append(access_token)
                return {
                    "$schema": "prototype-ordax.account-export/1",
                    "subject": "user-1",
                    "exported_at": "2026-09-25T00:00:00Z",
                    "account": {},
                    "spaces": [],
                    "memberships": [],
                    "space_profile_packs": [],
                    "entitlements": [],
                    "projects": [],
                    "devices": [],
                    "project_connections": [],
                    "memory_items": [],
                    "sync_objects": [],
                }

        account_provider = FakeAccountProvider()
        gateway = gateway_module.PublicIdentityGateway(
            provider=FakeIdentityProvider(),
            sync_provider=None,
            account_provider=account_provider,
        )
        response = gateway.handle(
            "GET",
            "/account/export",
            {"cookie": "ordax_access=user-access-token"},
        )
        self.assertEqual(response.status, 200)
        self.assertEqual(
            self.payload(response)["$schema"],
            "prototype-ordax.account-export/1",
        )
        self.assertEqual(account_provider.calls, ["user-access-token"])

    def test_sync_routes_fail_closed_without_identity_provider(self):
        for path in ("/sync/snapshot", "/sync/changes", "/sync/objects"):
            with self.subTest(path=path):
                read = self.gateway.handle("GET", path)
                self.assertEqual(read.status, 503)
        write = self.gateway.handle(
            "POST",
            "/sync/mutate",
            {"content-type": "application/json"},
            b"{}",
        )
        self.assertEqual(write.status, 503)

    def test_methods_are_narrow(self):
        cases = (
            ("POST", "/auth/session", "GET"),
            ("PUT", "/auth/login", "GET, POST"),
            ("GET", "/auth/logout", "POST"),
            ("GET", "/auth/recover", "POST"),
            ("POST", "/auth/recover/verify", "GET"),
            ("GET", "/auth/recover/complete", "POST"),
            ("POST", "/sync/snapshot", "GET"),
            ("POST", "/sync/changes", "GET"),
            ("POST", "/sync/objects", "GET"),
            ("GET", "/sync/mutate", "POST"),
            ("POST", "/account/export", "GET"),
            ("POST", "/account/entitlements/memory-cloud", "GET"),
            ("GET", "/account/close", "POST"),
        )
        for method, path, allowed in cases:
            with self.subTest(method=method, path=path):
                response = self.gateway.handle(method, path)
                self.assertEqual(response.status, 405)
                self.assertEqual(dict(response.headers)["Allow"], allowed)

    def test_unknown_gateway_route_is_not_accepted(self):
        for path in ("/auth/admin", "/sync/admin", "/account/admin"):
            with self.subTest(path=path):
                response = self.gateway.handle("GET", path)
                self.assertEqual(response.status, 404)
                self.assertEqual(self.payload(response)["error"], "gateway-route-not-found")

    def test_cross_site_logout_is_rejected(self):
        response = self.gateway.handle(
            "POST",
            "/auth/logout",
            {"Sec-Fetch-Site": "cross-site"},
        )
        self.assertEqual(response.status, 403)
        self.assertEqual(self.payload(response)["error"], "cross-site-request-rejected")


if __name__ == "__main__":
    unittest.main()