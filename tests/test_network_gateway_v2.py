import importlib.util
import json
import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "services" / "network-gateway" / "gateway.py"

spec = importlib.util.spec_from_file_location("ordax_network_gateway_v2", MODULE)
gateway_module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = gateway_module
spec.loader.exec_module(gateway_module)

NetworkGatewayV2 = gateway_module.NetworkGatewayV2
NetworkSession = gateway_module.NetworkSession
MutationOutcome = gateway_module.MutationOutcome

USER_ID = "11111111-1111-4111-8111-111111111111"
SPACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
CONVERSATION_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
MESSAGE_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"
IDEMPOTENCY = "message-key-00000001"


def payload(response):
    return json.loads(response.body.decode("utf-8"))


class StaticSessions:
    configured = True

    def __init__(self, context=None):
        self.context = context if context is not None else object()
        self.calls = []

    def resolve(self, cookie_header):
        self.calls.append(cookie_header)
        return NetworkSession(
            authenticated=True,
            user_id=USER_ID,
            authority_context=self.context,
        )


class RecordingAuthority:
    configured = True

    def __init__(self, outcome="applied"):
        self.outcome = outcome
        self.calls = []

    def send_message(self, **kwargs):
        self.calls.append(kwargs)
        if self.outcome == "applied":
            return MutationOutcome(
                outcome="applied",
                code="message-applied",
                resource_id=MESSAGE_ID,
                retry_after_seconds=None,
                idempotency_key=kwargs["idempotency_key"],
            )
        if self.outcome == "idempotent":
            return MutationOutcome(
                outcome="idempotent",
                code="message-idempotent",
                resource_id=MESSAGE_ID,
                retry_after_seconds=None,
                idempotency_key=kwargs["idempotency_key"],
            )
        if self.outcome == "rate_limited":
            return MutationOutcome(
                outcome="rate_limited",
                code="message-rate-limited",
                resource_id=None,
                retry_after_seconds=30,
                idempotency_key=kwargs["idempotency_key"],
            )
        if self.outcome == "invalid":
            return MutationOutcome(
                outcome="invalid",
                code="message-body-invalid",
                resource_id=None,
                retry_after_seconds=None,
                idempotency_key=kwargs["idempotency_key"],
            )
        return MutationOutcome(
            outcome="denied",
            code="message-send-denied",
            resource_id=None,
            retry_after_seconds=None,
            idempotency_key=kwargs["idempotency_key"],
        )


def headers(**overrides):
    value = {
        "Content-Type": "application/json",
        "Cookie": "ordax_access=opaque; ordax_refresh=opaque",
        "Sec-Fetch-Site": "same-origin",
    }
    value.update(overrides)
    return value


def body(**overrides):
    value = {
        "space_id": SPACE_ID,
        "conversation_id": CONVERSATION_ID,
        "idempotency_key": IDEMPOTENCY,
        "body": "  Mensagem segura  ",
    }
    value.update(overrides)
    return json.dumps(value).encode("utf-8")


class NetworkGatewayV2Tests(unittest.TestCase):
    def test_default_gateway_is_fail_closed_and_exposes_no_secret(self):
        gateway = NetworkGatewayV2()
        status = gateway.handle("GET", "/network/v2/status")
        self.assertEqual(status.status, 200)
        value = payload(status)
        self.assertFalse(value["identity_configured"])
        self.assertFalse(value["authority_configured"])
        self.assertFalse(value["message_send_enabled"])
        serialized = json.dumps(value).lower()
        self.assertNotIn("token", serialized)
        self.assertNotIn("secret", serialized)

        response = gateway.handle(
            "POST",
            "/network/v2/messages/send",
            headers(),
            body(),
        )
        self.assertEqual(response.status, 401)
        self.assertEqual(payload(response)["error"], "authentication-required")

    def test_cross_site_rejected_before_session_and_authority(self):
        sessions = StaticSessions()
        authority = RecordingAuthority()
        gateway = NetworkGatewayV2(sessions=sessions, authority=authority)

        response = gateway.handle(
            "POST",
            "/network/v2/messages/send",
            headers(**{"Sec-Fetch-Site": "cross-site"}),
            body(),
        )

        self.assertEqual(response.status, 403)
        self.assertEqual(sessions.calls, [])
        self.assertEqual(authority.calls, [])

    def test_origin_host_mismatch_is_rejected_before_session(self):
        sessions = StaticSessions()
        authority = RecordingAuthority()
        gateway = NetworkGatewayV2(sessions=sessions, authority=authority)
        response = gateway.handle(
            "POST",
            "/network/v2/messages/send",
            headers(**{
                "Origin": "https://other.example",
                "X-Forwarded-Host": "ordax.example",
            }),
            body(),
        )
        self.assertEqual(response.status, 403)
        self.assertEqual(sessions.calls, [])
        self.assertEqual(authority.calls, [])

    def test_request_accepts_exact_bounded_values_and_never_client_identity(self):
        context = object()
        sessions = StaticSessions(context)
        authority = RecordingAuthority()
        gateway = NetworkGatewayV2(sessions=sessions, authority=authority)

        response = gateway.handle(
            "POST",
            "/network/v2/messages/send",
            headers(),
            body(),
        )

        self.assertEqual(response.status, 200)
        self.assertEqual(len(authority.calls), 1)
        call = authority.calls[0]
        self.assertIs(call["session"].authority_context, context)
        self.assertEqual(call["session"].user_id, USER_ID)
        self.assertEqual(call["sender_space_id"], SPACE_ID)
        self.assertEqual(call["conversation_id"], CONVERSATION_ID)
        self.assertEqual(call["idempotency_key"], IDEMPOTENCY)
        self.assertEqual(call["body"], "Mensagem segura")

        hostile = json.loads(body().decode("utf-8"))
        hostile["user_id"] = "22222222-2222-4222-8222-222222222222"
        rejected = gateway.handle(
            "POST",
            "/network/v2/messages/send",
            headers(),
            json.dumps(hostile).encode("utf-8"),
        )
        self.assertEqual(rejected.status, 400)
        self.assertEqual(len(authority.calls), 1)

    def test_invalid_plain_text_and_idempotency_fail_before_authority(self):
        authority = RecordingAuthority()
        gateway = NetworkGatewayV2(sessions=StaticSessions(), authority=authority)

        for request_body in (
            body(idempotency_key="short"),
            body(body="antes\u0001depois"),
            body(body="   "),
            body(body="x" * 4001),
        ):
            with self.subTest(request_body=request_body[:40]):
                response = gateway.handle(
                    "POST",
                    "/network/v2/messages/send",
                    headers(),
                    request_body,
                )
                self.assertEqual(response.status, 400)
        self.assertEqual(authority.calls, [])

    def test_canonical_mutation_rejections_are_http_success_with_v2_outcome(self):
        for outcome_name in ("applied", "idempotent", "rate_limited", "denied", "invalid"):
            with self.subTest(outcome=outcome_name):
                gateway = NetworkGatewayV2(
                    sessions=StaticSessions(),
                    authority=RecordingAuthority(outcome_name),
                )
                response = gateway.handle(
                    "POST",
                    "/network/v2/messages/send",
                    headers(),
                    body(),
                )
                self.assertEqual(response.status, 200)
                value = payload(response)
                self.assertEqual(
                    value["schema"],
                    "prototype-ordax.network-mutation-outcome/2",
                )
                self.assertEqual(value["outcome"], outcome_name)
                self.assertEqual(value["operation"], "message-send")
                self.assertEqual(value["idempotency_key"], IDEMPOTENCY)
                if outcome_name == "rate_limited":
                    self.assertEqual(value["retry_after_seconds"], 30)

    def test_invalid_authority_outcome_fails_closed_without_context_leak(self):
        class BadAuthority(RecordingAuthority):
            def send_message(self, **kwargs):
                self.calls.append(kwargs)
                return MutationOutcome(
                    outcome="applied",
                    code="message-applied",
                    resource_id=None,
                    retry_after_seconds=None,
                    idempotency_key="different-key-00000001",
                )

        secret_context = {"access_token": "TOP-SECRET"}
        gateway = NetworkGatewayV2(
            sessions=StaticSessions(secret_context),
            authority=BadAuthority(),
        )
        response = gateway.handle(
            "POST",
            "/network/v2/messages/send",
            headers(),
            body(),
        )
        self.assertEqual(response.status, 502)
        self.assertEqual(payload(response)["error"], "invalid-network-outcome")
        self.assertNotIn("TOP-SECRET", response.body.decode("utf-8"))

    def test_machine_readable_contract_keeps_rollout_disabled(self):
        contract = json.loads(
            (ROOT / "docs" / "contracts" / "network-gateway-v2.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertFalse(contract["authority"]["default_enabled"])
        self.assertFalse(contract["authority"]["supabase_adapter_implemented"])
        self.assertFalse(contract["rollout"]["live_endpoint_enabled"])
        self.assertFalse(contract["rollout"]["live_supabase_migration_applied"])
        self.assertTrue(contract["rollout"]["requires_official_generated_migration"])
        self.assertTrue(contract["authority"]["authenticated_user_context_required_for_future_supabase_adapter"])

        foundation = json.loads(
            (ROOT / "docs" / "contracts" / "network-foundation.json").read_text(
                encoding="utf-8"
            )
        )
        state = foundation["implementation_state"]
        self.assertTrue(state["surface_app_source"])
        self.assertTrue(state["client_transport_v2_source"])
        self.assertTrue(state["provider_neutral_gateway_v2_source"])
        self.assertFalse(state["supabase_gateway_adapter"])
        self.assertFalse(state["generated_v2_migration"])
        self.assertFalse(state["live_network_endpoint"])
        self.assertFalse(state["production_rollout"])

    def test_provider_neutral_core_contains_no_supabase_or_privileged_key(self):
        source = MODULE.read_text(encoding="utf-8").lower()
        self.assertNotIn("supabase", source)
        self.assertNotIn("service_role", source)
        self.assertNotIn("sb_secret_", source)
        self.assertNotIn("/rest/v1/", source)
        self.assertNotIn("/rpc/", source)


if __name__ == "__main__":
    unittest.main()
