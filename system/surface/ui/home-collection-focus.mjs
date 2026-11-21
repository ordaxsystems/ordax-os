import { restoreTransientActionFocus } from "./focus-recovery.mjs";

// Native Home uses the shared keyboard rule with its stable search control.
// It never selects an unrelated project, notification or recent file.
export function restoreHomeCollectionFocus(homePanel, previouslyFocused, candidate = null) {
  if (!previouslyFocused) return false;
  return restoreTransientActionFocus(
    previouslyFocused, candidate, homePanel?.querySelector?.(".ordax-home-search"));
}
