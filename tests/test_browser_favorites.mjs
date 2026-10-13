import assert from "node:assert/strict";
import test from "node:test";
import { validateBrowserFavoritesSnapshot } from "../system/contracts/browser-favorites.mjs";
import { createEmptyBrowserFavoritesStoreState } from "../system/contracts/browser-favorites-store.mjs";
import { createNativeBrowserFavoritesStore } from "../system/adapters/native/browser-favorites.mjs";

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

test("native favorite store survives recreation and rejects corrupt records", () => {
  const windowRef = localStorageWindow();
  const store = createNativeBrowserFavoritesStore(windowRef);
  store.save({
    nextOrdinal: 2,
    favorites: [{
      id: "favorite-1",
      url: "https://example.org/",
      title: "Example",
      createdAt: 1,
      updatedAt: 1,
    }],
  });

  const restored = createNativeBrowserFavoritesStore(windowRef);
  assert.equal(restored.scope, "device");
  assert.equal(restored.load().favorites[0].url, "https://example.org/");

  windowRef.values.set("ordax.native.browser-favorites.v1", "{broken");
  const corrupt = createNativeBrowserFavoritesStore(windowRef);
  assert.deepEqual(corrupt.load(), createEmptyBrowserFavoritesStoreState());
});

test("snapshot validation rejects duplicate favorite URLs", () => {
  assert.throws(
    () => validateBrowserFavoritesSnapshot({
      persistence: "device",
      favorites: [
        {
          id: "favorite-1",
          url: "https://example.org/",
          title: "One",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "favorite-2",
          url: "https://example.org/",
          title: "Two",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    }),
    /only one favorite per URL/,
  );
});
