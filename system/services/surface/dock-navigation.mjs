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

/**
 * Let a desktop wheel scroll an overflowing horizontal dock. Trackpads keep
 * their native horizontal delta; vertical mouse wheels are mapped to the
 * dock only while it can consume movement, so the page can still scroll at
 * either edge.
 * @param {any} event
 * @param {HTMLElement | null} dock
 */
export function scrollDockFromWheel(event, dock) {
  if (!dock) return false;
  const maxScroll = Math.max(0, dock.scrollWidth - dock.clientWidth);
  if (maxScroll <= 1) return false;

  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!Number.isFinite(delta) || delta === 0) return false;
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? dock.clientWidth : 1;
  const current = dock.scrollLeft;
  const next = Math.min(maxScroll, Math.max(0, current + delta * unit));
  if (Math.abs(next - current) < 0.5) return false;

  event.preventDefault();
  dock.scrollLeft = next;
  return true;
}

/**
 * Move focus spatially through desktop shortcuts without opening an app.
 * The DOM layout is authoritative, so columns can adapt to each host's canvas.
 * @param {any} event
 * @param {Element | null} container
 * @param {string} selector
 */
export function moveDesktopShortcutFocus(event, container, selector) {
  if (!container || event.altKey || event.ctrlKey || event.metaKey
    || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return false;

  const items = [...container.querySelectorAll(selector)].filter((item) => (
    !item.disabled && !item.hidden && item.getClientRects().length > 0
  ));
  const current = event.target?.closest?.(selector);
  const index = items.indexOf(current);
  if (index < 0 || items.length === 0) return false;

  let next;
  if (event.key === "Home") next = items[0];
  else if (event.key === "End") next = items[items.length - 1];
  else {
    const bounds = current.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const directions = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const [directionX, directionY] = directions[event.key];
    const candidates = items.filter((item) => item !== current).map((item) => {
      const rect = item.getBoundingClientRect();
      const deltaX = rect.left + rect.width / 2 - centerX;
      const deltaY = rect.top + rect.height / 2 - centerY;
      const primary = deltaX * directionX + deltaY * directionY;
      const perpendicular = Math.abs(deltaX * directionY - deltaY * directionX);
      return { item, primary, perpendicular };
    }).filter((candidate) => candidate.primary > 0)
      .sort((left, right) => (left.primary + left.perpendicular * 1.5)
        - (right.primary + right.perpendicular * 1.5));
    next = candidates[0]?.item;
  }

  if (!next) return false;
  event.preventDefault();
  next.focus({ preventScroll: true });
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}
