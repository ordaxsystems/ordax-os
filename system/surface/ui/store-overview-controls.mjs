import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { listStoreCatalogEntries } from "../../services/apps/store-catalog.mjs";

const STORE_EXTENSION_SELECTOR = '[data-app-extension="store-overview"]';

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function mountStoreOverviewControls(root, surfaceLifecycle) {
  if (!(root instanceof Element)) {
    throw new TypeError("Store overview controls require a Surface root Element");
  }
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const t = lifecycle.localization.translate;
  const documentObject = root.ownerDocument;
  let destroyed = false;
  let mountedSlot = null;

  const render = () => {
    if (destroyed) return;
    const slot = root.querySelector(STORE_EXTENSION_SELECTOR);
    if (!slot) {
      mountedSlot = null;
      return;
    }
    mountedSlot = slot;
    slot.dataset.ordaxStoreOverviewView = "";
    slot.dataset.storeMode = "catalog-only";
    slot.replaceChildren();

    const header = node(documentObject, "header", "ordax-store-header");
    header.append(
      node(documentObject, "p", "ordax-eyebrow", t("store.eyebrow")),
      node(documentObject, "h2", "ordax-store-title", t("store.title")),
      node(documentObject, "p", "ordax-store-subtitle", t("store.subtitle")),
    );

    const state = node(documentObject, "div", "ordax-store-state");
    state.dataset.state = "blocked";
    state.append(
      node(documentObject, "strong", null, t("store.readonly")),
      node(documentObject, "p", null, t("store.blocked")),
    );

    const grid = node(documentObject, "div", "ordax-store-grid");
    for (const entry of listStoreCatalogEntries()) {
      const card = node(documentObject, "article", "ordax-store-card");
      card.dataset.storeAppId = entry.appId;
      card.dataset.storeInstallAction = entry.installAction;
      card.dataset.authority = entry.authority;

      const heading = node(
        documentObject,
        "h3",
        "ordax-store-card-title",
        t(`store.product.${entry.appId}.title`),
      );
      const description = node(
        documentObject,
        "p",
        "ordax-store-card-description",
        t(`store.product.${entry.appId}.description`),
      );
      const meta = node(
        documentObject,
        "span",
        "ordax-store-card-meta",
        t("store.delivery.on-demand"),
      );
      const action = node(
        documentObject,
        "button",
        "ordax-store-card-action",
        t("store.action.unavailable"),
      );
      action.type = "button";
      action.disabled = true;
      action.dataset.storeAction = "unavailable";

      card.append(heading, description, meta, action);
      grid.append(card);
    }

    const authority = node(documentObject, "p", "ordax-store-authority", t("store.authority"));
    authority.dataset.authority = "none";

    slot.append(header, state, grid, authority);
  };

  const unsubscribeRender = lifecycle.subscribeRender(render);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeRender?.();
      if (mountedSlot) {
        delete mountedSlot.dataset.ordaxStoreOverviewView;
        delete mountedSlot.dataset.storeMode;
      }
      mountedSlot = null;
    },
  });
}
