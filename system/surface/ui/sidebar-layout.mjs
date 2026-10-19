// Structural slots and geometry decisions shared by React and Native presenters.
export const SIDEBAR_LAYOUT = Object.freeze([
  { key: "brand", tag: "div", className: "sidebar-header" },
  { key: "home", tag: "div", className: "sidebar-home-row" },
  { key: "navigation", tag: "nav", className: "os-nav" },
  { key: "account", tag: "div", className: "sidebar-account-slot" },
  { key: "auxiliary", tag: "div", className: "sidebar-auxiliary" },
].map(slot => Object.freeze(slot)));
export function sidebarBrandMarkup() {
  return '<span class="brand"><span class="meridian-brand-symbol" aria-hidden="true"></span><span class="brand-wordmark"><span class="brand-name">OrdaX</span><span class="brand-sub">OS</span></span></span>';
}
export function escapeMarkup(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
export function createSidebarMarkup({ id, label, content }) {
  return `<aside id="${escapeMarkup(id)}" class="ordax-rail ordax-product-sidebar" aria-label="${escapeMarkup(label)}">${SIDEBAR_LAYOUT.map(slot => `<${slot.tag} class="${slot.className}" data-sidebar-slot="${slot.key}">${content[slot.key] ?? ""}</${slot.tag}>`).join("")}</aside>`;
}
export function sidebarIsExpanded(sidebar) { return sidebar.getBoundingClientRect().width > 100; }
const measuredSidebarHeadings = new WeakMap();
export function sidebarItemIsActive(activeWindow, button) {
  if (!activeWindow || !button?.dataset?.sidebarApp || activeWindow.appId !== button.dataset.sidebarApp) return false;
  const target = button.dataset.appTarget;
  return target ? activeWindow.target === target : activeWindow.target === null;
}
export function sidebarNavigationCapacity(nav) {
  const style = nav.ownerDocument.defaultView.getComputedStyle(nav);
  const button = nav.querySelector("button:not([hidden])");
  if (!button) return 0;
  const gap = parseFloat(style.rowGap) || 0;
  const pitch = button.getBoundingClientRect().height + gap;
  if (pitch <= 0) return 0;
  const labels = [...nav.querySelectorAll(".meridian-nav-label")];
  let headingHeight = 0;
  for (const label of labels) {
    const rect = label.getBoundingClientRect();
    const labelStyle = nav.ownerDocument.defaultView.getComputedStyle(label);
    if (rect.height > 0) {
      const firstButton = label.parentElement?.querySelector("button:not([hidden])");
      const followingGap = firstButton ? Math.max(0, firstButton.getBoundingClientRect().top - rect.bottom) : 0;
      const contribution = rect.height + (parseFloat(labelStyle.marginTop) || 0)
        + (parseFloat(labelStyle.marginBottom) || 0) + followingGap;
      measuredSidebarHeadings.set(label, Math.max(contribution, measuredSidebarHeadings.get(label) || 0));
      headingHeight += contribution;
    } else if (label.parentElement?.hidden && labelStyle.display !== "none") {
      // Keep a heading's measured height when its entire group was hidden to
      // make room for the More button. A collapsed icon rail hides labels with
      // CSS while keeping groups visible; that saved space must count again.
      headingHeight += measuredSidebarHeadings.get(label) || 0;
    }
  }
  return Math.max(0, Math.floor((nav.clientHeight - headingHeight + gap) / pitch));
}
export function mountNativeSidebarFit(nav, onResize) {
  const buttons = [...nav.querySelectorAll(".meridian-nav-destination button")];
  const more = nav.querySelector("[data-nav-menu-more]") ?? nav.querySelector("[data-launcher-more]") ?? nav.querySelector("[data-launcher-toggle]");
  function measure() {
    const capacity = sidebarNavigationCapacity(nav);
    const count = buttons.length > capacity ? Math.max(0, capacity - 1) : buttons.length;
    buttons.forEach((button, index) => { button.hidden = index >= count; });
    nav.querySelectorAll("[data-nav-group]").forEach(group => {
      group.hidden = !group.querySelector(".meridian-nav-destination button:not([hidden])");
    });
    more.hidden = count === buttons.length;
    onResize();
  }
  const Observer = nav.ownerDocument.defaultView.ResizeObserver;
  const observer = typeof Observer === "function" ? new Observer(measure) : null;
  observer?.observe(nav); measure();
  return Object.freeze({ destroy() { observer?.disconnect(); } });
}
