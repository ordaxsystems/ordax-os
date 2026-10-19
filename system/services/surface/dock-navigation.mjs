/**
 * Move keyboard focus through a host-owned dock without activating an app.
 * The host supplies its dock container and optional horizontal reveal logic.
 * @param {any} event
 * @param {Element | null} container
 * @param {string} selector
 * @param {(item: HTMLElement) => void} [reveal]
 */
export function moveDockFocus(event, container, selector, reveal) {
  if (!container || event.altKey || event.ctrlKey || event.metaKey
    || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return false;

  const items = [...container.querySelectorAll(selector)].filter((item) => (
    !item.disabled && !item.hidden && item.getClientRects().length > 0
  ));
  const current = event.target?.closest?.(selector);
  const index = items.indexOf(current);
  if (index < 0 || items.length === 0) return false;

  const nextIndex = event.key === "Home" ? 0
    : event.key === "End" ? items.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
  event.preventDefault();
  const next = items[nextIndex];
  next.focus({ preventScroll: true });
  if (reveal) reveal(next);
  else next.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}
