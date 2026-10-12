// Shared presentation only: names come from each existing localized button.
let nextHintId = 0;
export function mountSidebarHints(host, sidebar) {
  const document = host.ownerDocument;
  const viewport = document.defaultView;
  const hint = document.createElement("div");
  hint.className = "ordax-sidebar-hint";
  hint.id = `ordax-sidebar-hint-${++nextHintId}`;
  hint.setAttribute("role", "tooltip");
  hint.hidden = true;
  host.append(hint);
  let active = null;
  let activeTitle = "";
  let touchFocus = false;
  function hide() {
    if (active) {
      if (!active.hasAttribute("title")) active.setAttribute("title", activeTitle);
      const description = (active.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(id => id && id !== hint.id).join(" ");
      if (description) active.setAttribute("aria-describedby", description);
      else active.removeAttribute("aria-describedby");
    }
    active = null;
    activeTitle = "";
    hint.hidden = true;
  }
  function show(event) {
    if (event.pointerType === "touch" || (event.type === "focusin" && touchFocus)) return;
    if (event.pointerType) touchFocus = false;
    const button = event.target.closest?.("button");
    if (!button || !sidebar.contains(button) || button.disabled || sidebar.getBoundingClientRect().width > 100) return;
    if (button === active) return;
    const title = button.getAttribute("title");
    if (!title) return;
    hide();
    active = button;
    activeTitle = title;
    hint.textContent = title;
    // Suppress the browser's delayed duplicate while the immediate hint is visible.
    button.removeAttribute("title");
    button.setAttribute("aria-describedby", [button.getAttribute("aria-describedby"), hint.id].filter(Boolean).join(" "));
    hint.hidden = false;
    const anchor = button.getBoundingClientRect();
    const rail = sidebar.getBoundingClientRect();
    const size = hint.getBoundingClientRect();
    hint.style.left = `${Math.max(8, Math.min(rail.right + 8, viewport.innerWidth - size.width - 8))}px`;
    hint.style.top = `${Math.max(8, Math.min(anchor.top + (anchor.height - size.height) / 2, viewport.innerHeight - size.height - 8))}px`;
  }
  function leave(event) {
    if (active && !active.contains(event.relatedTarget)) hide();
  }
  function pointerdown(event) { touchFocus = event.pointerType === "touch"; hide(); }
  function keydown(event) { if (event.key === "Tab") touchFocus = false; if (event.key === "Escape") hide(); }
  sidebar.addEventListener("pointerover", show);
  sidebar.addEventListener("focusin", show);
  sidebar.addEventListener("pointerout", leave);
  sidebar.addEventListener("focusout", leave);
  sidebar.addEventListener("pointerdown", pointerdown);
  document.addEventListener("keydown", keydown);
  document.addEventListener("scroll", hide, true);
  viewport.addEventListener("resize", hide);
  return Object.freeze({
    hide,
    destroy() {
      hide();
      sidebar.removeEventListener("pointerover", show);
      sidebar.removeEventListener("focusin", show);
      sidebar.removeEventListener("pointerout", leave);
      sidebar.removeEventListener("focusout", leave);
      sidebar.removeEventListener("pointerdown", pointerdown);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("scroll", hide, true);
      viewport.removeEventListener("resize", hide);
      hint.remove();
    },
  });
}
