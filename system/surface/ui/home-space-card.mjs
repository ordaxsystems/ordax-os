import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

function assertHomeSpaceCard(root) {
  if (!root || typeof root.querySelector !== "function") {
    throw new TypeError("Home Space card requires a Surface root");
  }
  const elements = {
    section: root.querySelector(".ordax-home-current-space"),
    state: root.querySelector("[data-home-space-state]"),
    name: root.querySelector("[data-home-space-name]"),
    kind: root.querySelector("[data-home-space-kind]"),
  };
  if (Object.values(elements).some((element) => !element)) {
    throw new Error("Home Space card requires the canonical card elements");
  }
  return elements;
}

export function mountHomeSpaceCard(rootValue, {
  spaceSelection = null,
  surfaceLifecycle = null,
} = {}) {
  const elements = assertHomeSpaceCard(rootValue);
  const selectionPort = spaceSelection === null ? null : assertSpaceSelectionPort(spaceSelection);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  let selection = selectionPort
    ? validateSpaceSelectionSnapshot(selectionPort.getSnapshot())
    : null;
  let destroyed = false;

  const render = () => {
    if (destroyed) return;
    const translate = localization.translate;
    if (!selectionPort || !selection || selection.state === "unavailable") {
      elements.name.textContent = translate("home.space.unavailable");
      elements.kind.textContent = translate("home.space.unavailableDetail");
      elements.state.textContent = translate("home.space.stateUnavailable");
      elements.state.dataset.state = "unavailable";
      return;
    }
    if (selection.state === "unselected") {
      elements.name.textContent = translate("home.space.unselected");
      elements.kind.textContent = translate("home.space.unselectedDetail");
      elements.state.textContent = translate("home.space.stateUnselected");
      elements.state.dataset.state = "partial";
      return;
    }
    elements.name.textContent = selection.selectedSpace.name;
    elements.kind.textContent = translate("account.spaces.kind." + selection.selectedSpace.kind);
    elements.state.textContent = translate("home.space.stateSelected");
    elements.state.dataset.state = "ready";
  };

  const unsubscribeSelection = selectionPort?.subscribe((snapshot) => {
    selection = validateSpaceSelectionSnapshot(snapshot);
    render();
  });
  const unsubscribeLocalization = localization.subscribe(render);
  render();

  return Object.freeze({
    dispose() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeSelection?.();
      unsubscribeLocalization?.();
    },
  });
}
