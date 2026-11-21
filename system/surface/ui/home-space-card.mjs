import {
  assertSpaceSelectionPort,
  validateSpaceSelectionSnapshot,
} from "../../contracts/space-selection.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { projectHomeSpaceCard } from "./home-space-card-presentation.mjs";

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
  let destroyed = false;

  const render = () => {
    if (destroyed) return;
    // Always re-read the current OS snapshot. Subscription notifications can
    // arrive after a logout, account switch or a newer catalog reconciliation;
    // their payload must not resurrect an earlier selected Space on Home.
    const selection = selectionPort === null
      ? null : validateSpaceSelectionSnapshot(selectionPort.getSnapshot());
    const presentation = projectHomeSpaceCard(selection, localization.translate);
    elements.name.textContent = presentation.name;
    elements.kind.textContent = presentation.kind;
    elements.state.textContent = presentation.status;
    elements.state.dataset.state = presentation.state;
  };

  const unsubscribeSelection = selectionPort?.subscribe(() => {
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
