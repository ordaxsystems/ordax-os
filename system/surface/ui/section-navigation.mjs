// Presentation-only navigation for the Account, Settings and System views.
// Section authority, data ownership and focus remain with each host.
const NAV_SELECTOR = ".ordax-section-navigation";
const ACTIVE_SELECTOR = '.ordax-section-navigation-item[aria-current="page"]';

export function captureSectionNavigationScroll(slot) {
  const rail = slot?.querySelector?.(NAV_SELECTOR);
  return rail && Number.isFinite(rail.scrollLeft) ? rail.scrollLeft : null;
}

export function restoreSectionNavigationScroll(slot, previousScrollLeft, sameSection) {
  const rail = slot?.querySelector?.(NAV_SELECTOR);
  if (!rail) return;
  if (sameSection && Number.isFinite(previousScrollLeft)) {
    // An ordinary data refresh must not reset the user's deliberate scroll.
    rail.scrollLeft = previousScrollLeft;
    return;
  }
  const active = rail.querySelector(ACTIVE_SELECTOR);
  if (!active || rail.clientWidth <= 0 || rail.scrollWidth <= rail.clientWidth) return;
  const bounds = rail.getBoundingClientRect();
  const item = active.getBoundingClientRect();
  if (![bounds.left, bounds.right, item.left, item.right].every(Number.isFinite)) return;
  // Only move the inner rail; scrollIntoView might also move the window body.
  const inset = 8;
  let offset = 0;
  if (item.left < bounds.left + inset) offset = item.left - bounds.left - inset;
  else if (item.right > bounds.right - inset) offset = item.right - bounds.right + inset;
  if (offset !== 0) {
    const maxScroll = rail.scrollWidth - rail.clientWidth;
    rail.scrollLeft = Math.max(0, Math.min(maxScroll, rail.scrollLeft + offset));
  }
}

/** Refocus the active section if a previously focused action was revoked.
 *  The current view still owns navigation, eligibility and action lifecycle. */
export function restoreSectionFocusFallback(slot, priorFocus, target) {
  if (!priorFocus || (target && !target.disabled && !target.hidden
      && !target.closest?.("[hidden]"))) return false;
  const active = slot?.querySelector?.(ACTIVE_SELECTOR);
  if (!active || active.disabled || active.hidden || active.closest?.("[hidden]")) return false;
  active.focus({ preventScroll: true });
  return true;
}
