// Single browser-storage discovery boundary for optional Web state stores.
// This validates method availability only. Each store still owns its schema,
// key, scope, persistence semantics and failure policy; no shared cache.
export function resolveWebLocalStorage(windowRef = globalThis.window) {
  try {
    const storage = windowRef?.localStorage;
    if (
      storage &&
      typeof storage.getItem === "function" &&
      typeof storage.setItem === "function"
    ) {
      return storage;
    }
  } catch {
    // Private browsing or host policy can deny access even to the property.
  }
  return null;
}
