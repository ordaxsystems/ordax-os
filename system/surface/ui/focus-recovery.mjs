// One presentation-only keyboard recovery rule for transient controls.
// A revoked/removed/disabled target is never replaced by a different action
// based on ordering. The stable fallback is provided by the owning UI.
export function restoreTransientActionFocus(hadFocus, candidate, fallback) {
  if (!hadFocus) return false;
  const usable = (node) => Boolean(node
    && typeof node.focus === "function"
    && !node.disabled && !node.hidden
    && !node.closest?.("[hidden], [inert]"));
  const restored = usable(candidate);
  const target = restored ? candidate : fallback;
  if (!usable(target)) return false;
  target.focus({ preventScroll: true });
  return restored;
}
