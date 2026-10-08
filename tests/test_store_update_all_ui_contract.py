"""Source-contract regressions for the authority-free Store Update All UI.

The lifecycle is tested behaviorally in test_store_update_request_batch.mjs.
These assertions guard against wiring a second updater or claiming installation.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "system/surface/ui/store-overview-controls.mjs"
MESSAGES = ROOT / "system/services/i18n/catalog/store.mjs"
DOC = ROOT / "docs/STORE-APP-UPDATE-BATCH.md"
SERVICE = ROOT / "system/services/apps/store-update-request-batch.mjs"


class StoreUpdateAllUIContractTests(unittest.TestCase):
    def test_ui_reuses_existing_authority_free_batch_with_same_request_identity(self):
        ui = UI.read_text(encoding="utf-8")
        self.assertIn('from "../../services/apps/store-update-request-batch.mjs"', ui)
        self.assertIn("createStoreUpdateRequestBatch({", ui)
        self.assertIn("catalogPort: catalog,", ui)
        self.assertIn("lifecycleRequestPort: lifecycleRequests,", ui)
        self.assertIn("const requestSessionId = createStoreRequestSessionId()", ui)
        self.assertIn('return "store:update:" + appId + ":" + requestSessionId + ":" + requestOrdinal', ui)
        self.assertIn('requestSessionId === null ? null', ui)
        self.assertNotIn("createNativeAppLifecycleDelegate", ui)
        self.assertNotIn("installComponent(", ui)

    def test_batch_is_visible_only_in_updates_and_keeps_individual_actions_serial(self):
        ui = UI.read_text(encoding="utf-8")
        self.assertIn('if (activeView === "updates") {', ui)
        self.assertIn('"storeUpdateAll", "true"', ui)
        self.assertIn('"storeCancelUpdateAll", "true"', ui)
        self.assertIn('snapshot.state === "ready"', ui)
        self.assertIn('&& entry.artifactIdentityVerified && entry.provenanceVerified', ui)
        self.assertIn('batchInFlight ? { appId: "", operation: "update" } : pendingRequest', ui)
        self.assertIn("pendingRequest !== null || batchInFlight) return;", ui)
        self.assertIn("batchInFlight = true;", ui)
        self.assertIn("updateAll.submitAvailableUpdates().then(", ui)

    def test_revocation_destroy_and_navigation_cancel_only_pending_work(self):
        ui = UI.read_text(encoding="utf-8")
        self.assertGreaterEqual(ui.count("updateAll?.cancelPending();"), 3)
        self.assertIn("batchPresentationGeneration += 1;", ui)
        self.assertIn('if (destroyed) return;', ui)
        self.assertIn("batchInFlight = false;", ui)
        self.assertIn('store.updateAll.status.', ui)
        service = SERVICE.read_text(encoding="utf-8")
        self.assertIn('operation: "update"', service)
        self.assertIn('authority: "none"', service)
        self.assertIn("A request accepted by the lifecycle is not a completed update", service)

    def test_locales_and_documentation_never_claim_installed_updates(self):
        messages = MESSAGES.read_text(encoding="utf-8")
        self.assertEqual(messages.count('"store.updateAll.action":'), 2)
        for key in (
            "action", "requesting", "cancel", "explanation",
            "status.queued", "status.requests-processed", "status.cancelled",
            "status.no-updates", "status.requests-already-accepted",
            "status.catalog-unavailable", "status.failed",
        ):
            self.assertEqual(messages.count(f'"store.updateAll.{key}":'), 2, key)
        doc = DOC.read_text(encoding="utf-8")
        self.assertIn("não está ativada no MVP publicamente distribuído", doc)
        self.assertIn("não executa instalações", doc)


if __name__ == "__main__":
    unittest.main()
