from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"
ACCOUNT_MEMORY_COMPOSITION = ROOT / "system" / "composition" / "native" / "account-memory.mjs"
ACCOUNT_MEMORY_FOUNDATION = ROOT / "system" / "composition" / "native" / "account-memory-foundation.mjs"
ACCOUNT_SYNC_COMPOSITION = ROOT / "system" / "composition" / "native" / "account-sync.mjs"
WORKFLOW = ROOT / ".github" / "workflows" / "intelligence-foundation.yml"
INTELLIGENCE_CONTRACT = ROOT / "docs" / "contracts" / "intelligence.json"


class NativeMemoryIntegrationTests(unittest.TestCase):
    def test_native_host_wires_memory_endpoint_without_cors_or_generic_authority(self):
        host = HOST.read_text(encoding="utf-8")

        self.assertIn('MEMORY_PATH = "/__ordax/native/intelligence-memory"', host)
        self.assertIn("MAX_MEMORY_REQUEST_BODY_BYTES", host)
        self.assertIn("MemoryEndpointRequestError", host)
        self.assertIn("read_memory_endpoint()", host)
        self.assertIn("write_memory_endpoint(", host)
        self.assertIn("MEMORY_PATH, FILES_PATH", host)
        self.assertNotIn("Access-Control-Allow-Origin", host)

    def test_native_composition_probes_memory_fail_soft_and_keeps_memory_authorization_in_composition(self):
        composition = COMPOSITION.read_text(encoding="utf-8")

        self.assertIn("createNativeMemoryStore", composition)
        self.assertIn("createMemoryRuntime", composition)
        self.assertIn("createMemoryMutationPort", composition)
        self.assertIn("createNativeAccountMemoryFoundation", composition)
        self.assertIn("const memoryMutations = memory === null", composition)
        self.assertIn("protectedAccountMutations,", composition)
        self.assertIn('"OrdaX native Intelligence memory persistence unavailable"', composition)
        self.assertIn("memoryStore,", composition)
        self.assertIn("createMemoryRuntime({ store: memoryStore })", composition)
        self.assertIn("createIntelligenceRuntime({ inferencePort: localAi })", composition)
        self.assertNotIn("createIntelligenceRuntime({ inferencePort: localAi, memory", composition)
        self.assertIn("createIdentityBoundMemoryIntelligence", composition)
        self.assertIn("intelligencePort: consumerIntelligence", composition)
        self.assertIn("memoryPort: memory", composition)
        self.assertIn("spaceSelectionPort: spaceSelection", composition)

    def test_native_composition_mounts_user_review_and_selected_space_memory_bridge(self):
        composition = COMPOSITION.read_text(encoding="utf-8")

        self.assertIn("createMemoryReviewSession", composition)
        self.assertIn("createMemoryReviewViewModel", composition)
        self.assertIn("memoryPort: memory", composition)
        self.assertIn("mutationPort: memoryMutations", composition)
        self.assertIn("identitySessionPort: identitySession", composition)
        self.assertIn("memoryReview,", composition)
        self.assertIn("memoryReview?.dispose()", composition)
        self.assertIn("memoryReviewSession?.dispose()", composition)
        self.assertNotIn("memoryPort: memory,\n    inferencePort", composition)
        self.assertNotIn("memoryReview,\n      intelligence", composition)
        self.assertIn("const selectedSpaceIntelligence = memory === null", composition)
        self.assertIn("intelligence: selectedSpaceIntelligence", composition)
        self.assertIn("{ mutationPort: memoryMutations }", composition)
        self.assertIn("recoverProtectedAccountMemory", composition)
        self.assertIn("refreshAuthorization: true", composition)
        self.assertIn("unsubscribeAccountMemoryRecovery()", composition)
        self.assertIn("accountMemoryFoundation?.destroy()", composition)

        account_memory = ACCOUNT_MEMORY_COMPOSITION.read_text(encoding="utf-8")
        foundation = ACCOUNT_MEMORY_FOUNDATION.read_text(encoding="utf-8")
        self.assertIn('publicCloudMemoryEnabled: false', account_memory)
        self.assertIn("const ensureHealthy = () => {", foundation)
        self.assertIn("const protectedMutations = Object.freeze({", foundation)
        self.assertIn('"recovery-required"', foundation)
        self.assertNotIn("createWebSyncTransport", account_memory)
        self.assertNotIn("createWebSyncTransport", foundation)

    def test_native_live_memory_sync_uses_canonical_foundation_without_public_promotion(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        account_sync = ACCOUNT_SYNC_COMPOSITION.read_text(encoding="utf-8")
        start = composition.index("const accountSync = createNativeAccountSyncRuntime({")
        end = composition.index("\n  });", start) + len("\n  });")
        account_sync_block = composition[start:end]

        self.assertIn("accountMemoryFoundation,", account_sync_block)
        self.assertIn("transport: syncTransport", account_sync_block)
        self.assertNotIn("memorySync:", account_sync_block)
        self.assertIn("memorySyncFromFoundation(accountMemoryFoundation)", account_sync)
        self.assertIn("memorySync,", account_sync)
        self.assertIn("publicCloudMemoryEnabled: false", account_sync)
        self.assertIn("publicCloudMemoryEnabled: false", ACCOUNT_MEMORY_COMPOSITION.read_text(encoding="utf-8"))

    def test_native_memory_context_contract_matches_identity_bound_runtime(self):
        import json

        composition = COMPOSITION.read_text(encoding="utf-8")
        contract = json.loads(INTELLIGENCE_CONTRACT.read_text(encoding="utf-8"))

        self.assertTrue(contract["context"]["ordinary_request_injects_memory"])
        self.assertTrue(
            contract["context"]["ordinary_request_memory_injection_requires_composition_authorization"]
        )
        self.assertEqual(
            contract["context"]["ordinary_request_memory_injection_native_scopes"],
            ["device", "account", "space"],
        )
        self.assertFalse(contract["context"]["project_or_session_memory_inferred"])
        self.assertFalse(contract["context"]["restricted_memory_injected"])
        self.assertTrue(contract["mvp_policy"]["automatic_memory_injection_enabled"])
        self.assertEqual(
            contract["mvp_policy"]["automatic_memory_injection_authority"],
            "trusted-native-composition-only",
        )

        self.assertIn("createIdentityBoundMemoryIntelligence", composition)
        self.assertIn("identitySessionPort: identitySession", composition)
        self.assertIn("spaceSelectionPort: spaceSelection", composition)

    def test_intelligence_workflow_covers_host_composition_and_integration_regression(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("'system/surface/runtime/native_host_server.py'", workflow)
        self.assertIn("'system/composition/native/main.mjs'", workflow)
        self.assertIn("'tests/test_native_memory_integration.py'", workflow)
        self.assertIn("python -m unittest tests.test_native_memory_integration -v", workflow)


if __name__ == "__main__":
    unittest.main()
