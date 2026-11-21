// Presentation-only continuity for one First Run modal. Never retain
// credential values, OS grants, lifecycle results or secondary state stores.
const EXPANDABLE = Object.freeze([
  ".ordax-first-run-keyboard",
  ".ordax-first-run-account-documents",
  ".ordax-first-run-account-detail",
  ".ordax-first-run-terms-document",
  ".ordax-first-run-essentials",
]);

export function captureFirstRunFocus(overlay, focused) {
  if (!focused || !overlay?.contains?.(focused)) return null;
  const attrs = Array.from(focused.attributes ?? []);
  const marker = attrs.find(a => a.name === "data-first-run-action")
    ?? attrs.find(a => a.name.startsWith("data-first-run-"));
  const id = typeof focused.id === "string" && focused.id ? focused.id : null;
  if (!marker && !id) return null;
  const caret = Number.isInteger(focused.selectionStart) && Number.isInteger(focused.selectionEnd)
    ? Object.freeze({start:focused.selectionStart,end:focused.selectionEnd,
        direction:focused.selectionDirection ?? "none"}) : null;
  return Object.freeze({attribute:marker?.name ?? null,value:marker?.value ?? null,
    ssid:focused.dataset?.firstRunSsid ?? null,id,caret});
}

export function restoreFirstRunFocus(overlay, intent) {
  if (!overlay || !intent) return false;
  const matches = intent.attribute
    ? overlay.querySelectorAll("[" + intent.attribute + "]") : overlay.querySelectorAll("[id]");
  let target = null;
  for (const candidate of matches) {
    if (intent.attribute
      ? candidate.getAttribute(intent.attribute) !== intent.value
          || (candidate.dataset?.firstRunSsid ?? null) !== intent.ssid
      : candidate.id !== intent.id) continue;
    if (candidate.disabled || candidate.hidden || candidate.closest?.("[hidden], [inert]")) continue;
    target = candidate;
    break;
  }
  if (!target) {
    // A revoked or removed operation must never get a synthetic focus target.
    (overlay.querySelector("#ordax-first-run-title") ?? overlay).focus?.({preventScroll:true});
    return false;
  }
  target.focus?.({preventScroll:true});
  if (intent.caret && typeof target.setSelectionRange === "function") {
    target.setSelectionRange(intent.caret.start,intent.caret.end,intent.caret.direction);
  }
  return true;
}

export function captureFirstRunReadingState(body) {
  if (!body) return null;
  return Object.freeze({
    scrollTop:Number.isFinite(body.scrollTop) ? body.scrollTop : 0,
    expanded:Object.freeze(EXPANDABLE.filter(sel => body.querySelector(sel)?.open === true)),
  });
}

export function restoreFirstRunReadingState(body, snapshot) {
  if (!body || !snapshot) return;
  for (const selector of snapshot.expanded) {
    const disclosure = body.querySelector(selector);
    if (disclosure) disclosure.open = true;
  }
  body.scrollTop = snapshot.scrollTop;
}
