import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_SEARCH_PROVIDER,
  BROWSER_SEARCH_PROVIDERS,
  browserSearchProvider,
  resolveBrowserNavigation,
} from "../system/contracts/browser-navigation.mjs";
import {
  BROWSER_SEARCH_PREFERENCES_STORE_SCHEMA,
  defaultBrowserSearchPreferenceRecord,
  validateBrowserSearchPreferenceRecord,
} from "../system/contracts/browser-search-preferences.mjs";
import { createBrowserSearchPreferencesRuntime } from "../system/apps/internet/services/search-preferences.mjs";
import { createNativeBrowserSearchPreferencesStore } from "../system/adapters/native/browser-search-preferences.mjs";

function memoryStore({ saved = false } = {}) {
  let record = defaultBrowserSearchPreferenceRecord();
  return {
    schema: BROWSER_SEARCH_PREFERENCES_STORE_SCHEMA,
    scope: "device",
    load: () => record,
    save(value) { record = validateBrowserSearchPreferenceRecord(value); return saved; },
  };
}

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

test("native search preference survives recreation without saving searches or credentials", () => {
  const windowRef = browserWindow();
  const store = createNativeBrowserSearchPreferencesStore(windowRef);
  const runtime = createBrowserSearchPreferencesRuntime({ store });
  assert.equal(runtime.getSnapshot().providerId, "duckduckgo");
  const notifications = [];
  const unsubscribe = runtime.subscribe(snapshot => notifications.push(snapshot));
  runtime.setProvider("brave");
  assert.deepEqual(runtime.getSnapshot(), { providerId: "brave", persistence: "device" });
  runtime.setProvider("brave");
  assert.equal(notifications.length, 1);
  assert.equal(windowRef.data.size, 1);
  assert.ok(!JSON.stringify([...windowRef.data.values()]).includes("pesquisa & ferramenta"));
  unsubscribe();
  runtime.destroy();
  const restored = createBrowserSearchPreferencesRuntime({
    store: createNativeBrowserSearchPreferencesStore(windowRef),
  });
  assert.equal(restored.getSnapshot().providerId, "brave");
  restored.destroy();
});

test("corrupt settings fail closed to default provider and write failure stays session-scoped", () => {
  const win = browserWindow();
  win.data.set("ordax.native.browser-search-preferences.v1", JSON.stringify({
    schema: "ordax.native.browser-search-preferences-record/1",
    state: { providerId: "unsupported" },
  }));
  const restored = createBrowserSearchPreferencesRuntime({
    store: createNativeBrowserSearchPreferencesStore(win),
  });
  assert.equal(restored.getSnapshot().providerId, "duckduckgo");
  restored.destroy();
  const memory = createBrowserSearchPreferencesRuntime({ store: memoryStore({ saved: false }) });
  memory.setProvider("google");
  assert.deepEqual(memory.getSnapshot(), { providerId: "google", persistence: "session" });
  assert.throws(() => memory.setProvider("untrusted"), TypeError);
  assert.equal(memory.getSnapshot().providerId, "google");
  memory.destroy();
  const fallback = createBrowserSearchPreferencesRuntime();
  fallback.setProvider("bing");
  assert.equal(fallback.getSnapshot().persistence, "session");
  fallback.destroy();
});
