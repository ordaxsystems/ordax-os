from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class NativeBrowserHistoryBoundaryTests(unittest.TestCase):
    def test_native_history_store_is_host_owned_without_product_runtime(self):
        native = (ROOT / "system/composition/native/main.mjs").read_text(encoding="utf-8")
        web = (ROOT / "system/composition/web/main.tsx").read_text(encoding="utf-8")
        adapter = (ROOT / "system/adapters/native/browser-history.mjs").read_text(encoding="utf-8")
        self.assertIn("createNativeBrowserHistoryStore", native)
        self.assertNotIn("createBrowserHistoryRuntime", native)
        self.assertNotIn("createBrowserHistoryBridge", native)
        self.assertNotIn("createNativeBrowserHistoryStore", web)
        self.assertNotIn("createBrowserHistoryRuntime", web)
        self.assertIn("ordax.native.browser-history.v1", adapter)
        self.assertFalse((ROOT / "system/apps/internet/services/history.mjs").exists())

    def test_history_contract_stays_bounded_and_privileged(self):
        contract = (ROOT / "system/contracts/browser-history.mjs").read_text(encoding="utf-8")
        store = (ROOT / "system/contracts/browser-history-store.mjs").read_text(encoding="utf-8")
        self.assertIn('BROWSER_HISTORY_SCHEMA = "ordax.browser-history/1"', contract)
        self.assertIn("MAX_BROWSER_HISTORY_ENTRIES = 512", contract)
        self.assertIn('BROWSER_HISTORY_STORE_SCHEMA = "ordax.browser-history-store/1"', store)
        self.assertNotIn("projectId", contract)

if __name__ == "__main__":
    unittest.main()
