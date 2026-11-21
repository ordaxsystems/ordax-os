// Shared keyboard focus trap for the Surface's genuine modal dialogs.
// First Run and the local session lock both make the Surface root inert.
// Keep one implementation, never a second unlock-specific focus algorithm.
const TABBABLE_SELECTOR = "a[href], button, input, select, textarea, summary, [tabindex]";

export function trapModalKeyboardFocus(event, overlay, activeElement) {
  if (event.key !== "Tab") return false;

  const candidates = [...overlay.querySelectorAll(TABBABLE_SELECTOR)]
    .filter(node => node.tabIndex >= 0
      && !node.disabled
      && !node.closest("[hidden], [inert]")
      && node.getClientRects().length > 0);

  // The heading itself can receive programmatic focus (tabindex=-1).
  // Even if all controls become unavailable, Tab must not leave the modal.
  if (candidates.length === 0) {
    event.preventDefault();
    overlay.focus({ preventScroll: true });
    return true;
  }
  const index = candidates.indexOf(activeElement);
  const lastIndex = candidates.length - 1;
  const target = index < 0
    ? (event.shiftKey ? candidates[lastIndex] : candidates[0])
    : event.shiftKey && index === 0
      ? candidates[lastIndex]
      : !event.shiftKey && index === lastIndex
        ? candidates[0]
        : null;
  if (!target) return false; // Native browser traversal within the dialog.
  event.preventDefault();
  target.focus({ preventScroll: true });
  return true;
}

// Preserve the existing First Run import and its OS-owned source contracts.
export const trapFirstRunKeyboardFocus = trapModalKeyboardFocus;
