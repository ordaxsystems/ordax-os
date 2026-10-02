from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"
NATIVE_GATEWAY = ROOT / "system" / "surface" / "runtime" / "native_account_gateway.py"
NATIVE_HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
BOUNDARY = ROOT / "system" / "surface" / "runtime" / "native_request_boundary.py"


class NetworkGatewayV2Tests(unittest.TestCase):
    def setUp(self):
        self.edge = EDGE.read_text(encoding="utf-8")
        self.native_gateway = NATIVE_GATEWAY.read_text(encoding="utf-8")
        self.native_host = NATIVE_HOST.read_text(encoding="utf-8")
        self.boundary = BOUNDARY.read_text(encoding="utf-8")

    def test_edge_exposes_only_bounded_message_send_v2_rpc(self):
        self.assertIn('const NETWORK_SEND_PATH = "/network/v2/messages/send";', self.edge)
        self.assertIn('PUBLIC_SITE_NETWORK_ENABLED = false', self.edge)
        self.assertIn('supabase.rpc("ordax_network_send_message_v2"', self.edge)
        self.assertIn('p_space_id: request.space_id', self.edge)
        self.assertIn('p_conversation_id: request.conversation_id', self.edge)
        self.assertIn('p_client_idempotency_key: request.idempotency_key', self.edge)
        self.assertIn('p_body: request.body', self.edge)
        start = self.edge.index("async function sendNetworkMessage")
        end = self.edge.index("Deno.serve", start)
        section = self.edge[start:end]
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", section)
        self.assertNotIn("SUPABASE_SECRET_KEYS", section)
        self.assertNotIn("adminClient()", section)

    def test_edge_revalidates_session_and_rpc_outcome(self):
        start = self.edge.index("async function sendNetworkMessage")
        end = self.edge.index("Deno.serve", start)
        section = self.edge[start:end]
        self.assertIn("authenticated(req)", section)
        self.assertIn("NETWORK_MUTATION_SCHEMA", self.edge)
        self.assertIn("validNetworkOutcomeRow", section)
        self.assertIn("data.length !== 1", section)
        self.assertIn("request.idempotency_key", section)
        self.assertIn('"authentication-required"', section)

    def test_native_route_is_specific_and_uses_existing_session_gateway(self):
        self.assertIn('NETWORK_MESSAGE_SEND_PATH = "/network/v2/messages/send"', self.native_host)
        self.assertIn("self.server.account_gateway.send_network_message(raw)", self.native_host)
        self.assertIn('"/network/v2/messages/send"', self.native_gateway)
        self.assertNotIn("supabase", self.native_gateway.lower())

    def test_account_and_network_paths_share_same_origin_provenance_boundary(self):
        self.assertIn('"/account/"', self.boundary)
        self.assertIn('"/network/"', self.boundary)
        self.assertIn("browser_context_is_trusted", self.boundary)


if __name__ == "__main__":
    unittest.main()
