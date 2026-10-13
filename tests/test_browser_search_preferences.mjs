import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_SEARCH_PROVIDER,
  BROWSER_SEARCH_PROVIDERS,
  browserSearchProvider,
  resolveBrowserNavigation,
} from "../system/contracts/browser-navigation.mjs";
import {
  defaultBrowserSearchPreferenceRecord,
  validateBrowserSearchPreferenceRecord,
} from "../system/contracts/browser-search-preferences.mjs";
import { createNativeBrowserSearchPreferencesStore } from "../system/adapters/native/browser-search-preferences.mjs";

function browserWindow() {
  const data = new Map();
  const localStorage = {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem(key, value) { data.set(key, String(value)); },
  };
  return { localStorage, data };
}

test("supported providers use one typed registry and preserve query encoding", () => {
  assert.equal(BROWSER_SEARCH_PROVIDER.id, "duckduckgo");
  assert.deepEqual(BROWSER_SEARCH_PROVIDERS.map(p => p.id), [
    "duckduckgo", "brave", "google", "bing",
  ]);
  for (const provider of BROWSER_SEARCH_PROVIDERS) {
    assert.equal(browserSearchProvider(provider.id), provider);
    const nav = resolveBrowserNavigation("pesquisa & ferramenta", { searchProviderId: provider.id });
    const parsed = new URL(nav.url);
    assert.equal(parsed.searchParams.get("q"), "pesquisa & ferramenta");
    assert.equal(parsed.origin, new URL(provider.origin).origin);
  }
  assert.throws(() => browserSearchProvider("custom"), TypeError);
  assert.throws(() => resolveBrowserNavigation("pesquisa", { searchProviderId: "invalid" }), TypeError);
  assert.equal(resolveBrowserNavigation("https://example.org/docs", { searchProviderId: "brave" }).url,
    "https://example.org/docs");
});

test("native preference adapter persists only validated provider records", () => {
  const win = browserWindow();
  const store = createNativeBrowserSearchPreferencesStore(win);
  assert.equal(store.scope, "device");
  assert.deepEqual(store.load(), defaultBrowserSearchPreferenceRecord());
  const next = validateBrowserSearchPreferenceRecord({ providerId: "brave" });
  assert.equal(store.save(next), true);
  assert.deepEqual(createNativeBrowserSearchPreferencesStore(win).load(), next);
  assert.equal(win.data.size, 1);
  assert.throws(() => store.save({ providerId: "untrusted" }), TypeError);
  win.data.set("ordax.native.browser-search-preferences.v1", "{broken");
  assert.deepEqual(createNativeBrowserSearchPreferencesStore(win).load(), defaultBrowserSearchPreferenceRecord());
  const memory = createNativeBrowserSearchPreferencesStore({});
  assert.equal(memory.scope, "session");
  assert.equal(memory.save(next), false);
  assert.deepEqual(memory.load(), next);
});
