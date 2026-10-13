from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "system" / "contracts" / "network-transport-v2.mjs"
ADAPTER = ROOT / "system" / "adapters" / "web" / "network-transport-v2.mjs"
SEND = ROOT / "system" / "services" / "professional-network" / "send.mjs"
DRAFT = ROOT / "system" / "services" / "professional-network" / "draft.mjs"
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB = ROOT / "system" / "composition" / "web" / "main.tsx"


class NetworkTransportV2BoundaryTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def test_transport_is_same_origin_and_never_calls_supabase_directly(self):
        adapter = self.text(ADAPTER)
        self.assertIn('credentials: "same-origin"', adapter)
        self.assertIn('redirect: "error"', adapter)
        self.assertIn('"/network/v2/messages/send"', adapter)
        self.assertNotIn("supabase.co", adapter)
        self.assertNotIn("/rest/v1/", adapter)
        self.assertNotIn("/rpc/", adapter)

    def test_transport_requires_structured_v2_outcomes(self):
        contract = self.text(CONTRACT)
        self.assertIn("validateNetworkMutationOutcome", contract)
        self.assertIn('outcome.operation !== "message-send"', contract)
        self.assertIn("idempotency key mismatch", contract)

    def test_send_runtime_clears_only_the_exact_successful_draft_revision(self):
        send = self.text(SEND)
        draft = self.text(DRAFT)
        self.assertIn('outcome.outcome === "applied"', send)
        self.assertIn('outcome.outcome === "idempotent"', send)
        self.assertIn("draft.clear(bound.revision)", send)
        self.assertIn("revision: draftRevision", draft)
        self.assertIn("draftRevision !== expectedRevision", draft)

    def test_transport_is_not_activated_before_backend_rollout(self):
        native = self.text(NATIVE)
        web = self.text(WEB)
        self.assertNotIn("createWebNetworkTransportV2", native)
        self.assertNotIn("createWebNetworkTransportV2", web)
        self.assertNotIn("network-transport-v2.mjs", native)
        self.assertNotIn("network-transport-v2.mjs", web)


if __name__ == "__main__":
    unittest.main()
