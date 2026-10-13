import assert from "node:assert/strict";
import test from "node:test";
import { validateBrowserHistorySnapshot } from "../system/contracts/browser-history.mjs";
import { createEmptyBrowserHistoryStoreState } from "../system/contracts/browser-history-store.mjs";
import { createNativeBrowserHistoryStore } from "../system/adapters/native/browser-history.mjs";

function localStorageWindow() {
  const values = new Map();
  return {
    localStorage: {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
    },
    values,
  };
}

test("native history store survives recreation and rejects corrupt records", () => {
  const windowRef = localStorageWindow();
  const store = createNativeBrowserHistoryStore(windowRef);
  store.save({
    nextOrdinal: 2,
    entries: [{
      id: "history-1",
      url: "https://example.org/",
      title: "Example",
      visitedAt: 1,
    }],
  });

  const restored = createNativeBrowserHistoryStore(windowRef);
  assert.equal(restored.scope, "device");
  assert.equal(restored.load().entries[0].url, "https://example.org/");

  windowRef.values.set("ordax.native.browser-history.v1", "{broken");
  const corrupt = createNativeBrowserHistoryStore(windowRef);
  assert.deepEqual(corrupt.load(), createEmptyBrowserHistoryStoreState());
});

test("history snapshot validation requires newest-first stable entries", () => {
  assert.throws(
    () => validateBrowserHistorySnapshot({
      persistence: "device",
      entries: [
        { id: "history-1", url: "https://one.example/", title: "One", visitedAt: 1 },
        { id: "history-2", url: "https://two.example/", title: "Two", visitedAt: 2 },
      ],
    }),
    /newest first/,
  );
});
