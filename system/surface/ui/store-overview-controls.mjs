import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import {
  assertStoreLifecyclePort,
  validateStoreLifecycleSnapshot,
} from "../../contracts/store-lifecycle.mjs";
import {
  listFirstPartyAppDeliveryPolicies,
  projectFirstPartyAppDelivery,
} from "../../services/apps/delivery-policy.mjs";

const STORE_WINDOW_SELECTOR = '[data-window-id="store"]';
const STORE_EXTENSION_SELECTOR = '[data-app-extension="store-overview"]';

const STATE_MESSAGE_IDS = Object.freeze({
  installed: "store.state.installed",
  available: "store.state.available",
  installing: "store.state.installing",
  staged: "store.state.staged",
  blocked: "store.state.blocked",
  "failed-retained": "store.state.failed-retained",
  "not-catalogued": "store.state.not-catalogued",
});

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function blockedObservation() {
  return {
    installed: false,
    catalogued: true,
    transition: "idle",
    blockedReason: "store-lifecycle-unavailable",
    failedRetained: false,
  };
}

export function mountStoreOverviewControls(root, surfaceLifecycle, storeLifecycle = null) {
  if (!(root instanceof Element)) {
    throw new TypeError("Store overview controls require a Surface root Element");
  }
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const storePort = storeLifecycle === null ? null : assertStoreLifecyclePort(storeLifecycle);
  const t = lifecycle.localization.translate;
  const documentObject = root.ownerDocument;
  let snapshot = storePort === null ? null : validateStoreLifecycleSnapshot(storePort.getSnapshot());
  let mountedSlot = null;
  let pendingAppId = null;
  let requestFailed = false;
  let destroyed = false;

  const policies = listFirstPartyAppDeliveryPolicies().filter(
    (policy) => policy.deliveryClass !== "structural",
  );

  const observationFor = (appId) => {
    if (storePort === null) return blockedObservation();
    const entry = snapshot.observations.find((candidate) => candidate.appId === appId);
    return entry?.observation ?? {
      installed: false,
      catalogued: false,
      transition: "idle",
      blockedReason: null,
      failedRetained: false,
    };
  };

  const render = () => {
    if (destroyed) return;
    const slot = root.querySelector(`${STORE_WINDOW_SELECTOR} ${STORE_EXTENSION_SELECTOR}`);
    if (!slot) {
      mountedSlot = null;
      return;
    }
    mountedSlot = slot;
    slot.dataset.ordaxStoreOverviewView = "";
    slot.replaceChildren();

    const header = node(documentObject, "header", "ordax-store-header");
    header.append(
      node(documentObject, "h2", "ordax-store-title", t("store.heading")),
      node(documentObject, "p", "ordax-store-intro", t("store.intro")),
    );
    slot.append(header);

    if (storePort === null) {
      slot.append(node(documentObject, "p", "ordax-store-notice", t("store.lifecycle.unavailable")));
    }
    if (requestFailed) {
      slot.append(node(documentObject, "p", "ordax-store-error", t("store.request.failed")));
    }

    const grid = node(documentObject, "div", "ordax-store-grid");
    for (const policy of policies) {
      const projection = projectFirstPartyAppDelivery(policy.appId, observationFor(policy.appId));
      const card = node(documentObject, "article", "ordax-store-card");
      card.dataset.storeAppId = policy.appId;
      card.dataset.storeState = projection.state;

      const copy = node(documentObject, "div", "ordax-store-card-copy");
      copy.append(
        node(documentObject, "h3", "ordax-store-card-title", t(`app.${policy.appId}.title`)),
        node(documentObject, "p", "ordax-store-card-description", t(`app.${policy.appId}.description`)),
        node(
          documentObject,
          "span",
          "ordax-store-card-state",
          t(STATE_MESSAGE_IDS[projection.state] ?? "store.state.blocked"),
        ),
      );

      const button = node(documentObject, "button", "ordax-store-action");
      button.type = "button";
      button.dataset.storeInstall = policy.appId;
      const pending = pendingAppId === policy.appId;
      if (pending) {
        button.textContent = t("store.action.pending");
        button.disabled = true;
      } else if (projection.launchable) {
        button.textContent = t("store.action.installed");
        button.disabled = true;
      } else if (projection.installable && storePort !== null) {
        button.textContent = t("store.action.install");
        button.disabled = false;
      } else {
        button.textContent = t("store.action.unavailable");
        button.disabled = true;
      }

      card.append(copy, button);
      grid.append(card);
    }
    slot.append(grid);
  };

  const onClick = (event) => {
    const button = event.target.closest?.("[data-store-install]");
    if (!button || !mountedSlot?.contains(button) || button.disabled || storePort === null) return;
    const appId = button.dataset.storeInstall;
    pendingAppId = appId;
    requestFailed = false;
    render();
    Promise.resolve(storePort.requestInstall(appId))
      .catch(() => {
        requestFailed = true;
      })
      .finally(() => {
        if (destroyed || pendingAppId !== appId) return;
        pendingAppId = null;
        snapshot = validateStoreLifecycleSnapshot(storePort.getSnapshot());
        render();
      });
  };

  root.addEventListener("click", onClick);
  const unsubscribeRender = lifecycle.subscribeRender(render);
  const unsubscribeStore = storePort?.subscribe((next) => {
    snapshot = validateStoreLifecycleSnapshot(next);
    render();
  });
  render();

  return Object.freeze({
    destroy() {
      destroyed = true;
      unsubscribeRender?.();
      unsubscribeStore?.();
      root.removeEventListener("click", onClick);
      mountedSlot = null;
    },
  });
}
