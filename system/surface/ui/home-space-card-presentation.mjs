// Native Home presentation of the OS-owned Space selection snapshot.
// The canonical selection port alone authorizes what may be shown. This file
// never reads a stored Space, derives membership or invents an identity grant.
export function projectHomeSpaceCard(selection, translate) {
  if (typeof translate !== "function") {
    throw new TypeError("Home Space presentation requires localization");
  }
  if (selection?.state === "selected" && selection.selectedSpace) {
    return Object.freeze({
      name: selection.selectedSpace.name,
      kind: translate("account.spaces.kind." + selection.selectedSpace.kind),
      status: translate("home.space.stateSelected"),
      state: "ready",
    });
  }
  if (selection?.state === "unselected") {
    return Object.freeze({
      name: translate("home.space.unselected"),
      kind: translate("home.space.unselectedDetail"),
      status: translate("home.space.stateUnselected"),
      state: "partial",
    });
  }
  return Object.freeze({
    name: translate("home.space.unavailable"),
    kind: translate("home.space.unavailableDetail"),
    status: translate("home.space.stateUnavailable"),
    state: "unavailable",
  });
}
