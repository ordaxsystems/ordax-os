// Preserve keyboard focus through catalog-driven Store repainting. This
// module never reads catalog identity, lifecycle authority or app inventory.
const CONTROL_KEYS = Object.freeze([
  "storeView", "storeDetails", "storeBack", "storeConfirmRemove",
  "storeCancelRemove", "storeUpdateAll", "storeCancelUpdateAll",
  "storeModelsRefresh", "storeModelSystemUpdates",
]);

function identityForButton(button) {
  if (!button || button.tagName?.toLowerCase() !== "button") return null;
  for (const key of CONTROL_KEYS) {
    if (Object.hasOwn(button.dataset ?? {}, key)) {
      return Object.freeze({ key, value: button.dataset[key] });
    }
  }
  const { storeOperation, storeAppId } = button.dataset ?? {};
  return storeOperation && storeAppId
    ? Object.freeze({ key: "storeOperation", value: storeOperation, appId: storeAppId })
    : null;
}

export function captureStoreControlFocus(slot, documentObject) {
  const active = documentObject?.activeElement;
  return active && slot?.contains?.(active) ? identityForButton(active) : null;
}

export function restoreStoreControlFocus(slot, intent) {
  if (!slot || !intent) return false;
  for (const button of slot.querySelectorAll("button")) {
    const current = identityForButton(button);
    if (!current || current.key !== intent.key || current.value !== intent.value
      || (current.appId ?? null) !== (intent.appId ?? null)
      || button.disabled || button.hidden || button.closest?.("[hidden]")) continue;
    button.focus({ preventScroll: true });
    return true;
  }
  return false;
}
