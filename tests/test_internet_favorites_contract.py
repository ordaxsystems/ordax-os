from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class NativeBrowserFavoritesBoundaryTests(unittest.TestCase):
    def test_host_owns_device_store_without_bundled_internet_runtime(self):
        native = (ROOT / "system/composition/native/main.mjs").read_text(encoding="utf-8")
        web = (ROOT / "system/composition/web/main.tsx").read_text(encoding="utf-8")
        adapter = (ROOT / "system/adapters/native/browser-favorites.mjs").read_text(encoding="utf-8")
        self.assertIn("createNativeBrowserFavoritesStore", native)
        self.assertNotIn("createBrowserFavoritesRuntime", native)
        self.assertNotIn("createNativeBrowserFavoritesStore", web)
        self.assertIn("ordax.native.browser-favorites.v1", adapter)
        self.assertFalse((ROOT / "system/apps/internet/services/favorites.mjs").exists())

    def test_host_contract_is_bounded_and_project_independent(self):
        contract = (ROOT / "system/contracts/browser-favorites.mjs").read_text(encoding="utf-8")
        store = (ROOT / "system/contracts/browser-favorites-store.mjs").read_text(encoding="utf-8")
        self.assertIn('BROWSER_FAVORITES_SCHEMA = "ordax.browser-favorites/1"', contract)
        self.assertIn("MAX_BROWSER_FAVORITES = 256", contract)
        self.assertIn("BROWSER_FAVORITES_STORE_SCHEMA", store)
        self.assertNotIn("projectId", contract)

if __name__ == "__main__":
    unittest.main()
