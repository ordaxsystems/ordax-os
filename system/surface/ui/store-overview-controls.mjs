import {
  assertAppStoreCatalogPort,
  validateAppStoreCatalogSnapshot,
} from "../../contracts/app-store.mjs";
import {
  APP_LIFECYCLE_REQUEST_SCHEMA,
  assertAppLifecycleRequestPort,
  validateAppLifecycleRequest,
  validateAppLifecycleRequestResult,
} from "../../contracts/app-lifecycle-request.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

const STORE_WINDOW_SELECTOR = '[data-window-id="store"]';
const STORE_EXTENSION_SELECTOR = '[data-app-extension="store-overview"]';
const OPERATIONS = new Set(["install", "update", "remove"]);

function node(documentObject, tag, className = "", text = undefined) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function stateMessageId(state) {
  return `store.state.${state}`;
}

function operationAllowed(entry, operation) {
  if (operation === "install") return entry.installable;
  if (operation === "update") return entry.updatable;
  if (operation === "remove") return entry.removable;
  return false;
}

function versionSummary(t, entry) {
  if (entry.installedVersion !== null && entry.availableVersion !== null) {
    return t("store.version.update", {
      installedVersion: entry.installedVersion,
      availableVersion: entry.availableVersion,
    });
  }
  if (entry.installedVersion !== null) {
    return t("store.version.installed", { version: entry.installedVersion });
  }
  if (entry.availableVersion !== null) {
    return t("store.version.available", { version: entry.availableVersion });
  }
  return t(stateMessageId(entry.state));
}

function appendAction(documentObject, card, entry, operation, lifecycleRequests, pendingRequest, t) {
  if (!operationAllowed(entry, operation)) return;

  const isPending = pendingRequest?.appId === entry.appId
    && pendingRequest?.operation === operation;
  const button = node(
    documentObject,
    "button",
    "ordax-store-action",
    isPending ? t("store.action.requesting") : t(`store.action.${operation}`),
  );
  button.type = "button";
  button.dataset.storeOperation = operation;
  button.dataset.storeAppId = entry.appId;
  button.disabled = lifecycleRequests === null || pendingRequest !== null;
  if (lifecycleRequests === null) {
    button.title = t("store.action.unavailable");
  }
  card.append(button);
}

export function mountStoreOverviewControls(
  root,
  catalogPort,
  surfaceLifecycle,
  lifecycleRequestPort = null,
) {
  const catalog = assertAppStoreCatalogPort(catalogPort);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const lifecycleRequests = lifecycleRequestPort === null
    ? null
    : assertAppLifecycleRequestPort(lifecycleRequestPort);

  let snapshot = validateAppStoreCatalogSnapshot(catalog.getSnapshot());
  let mountedSlot = null;
  let pendingRequest = null;
  let requestMessageId = null;
  let requestOrdinal = 0;
  const requestSessionId = globalThis.crypto?.randomUUID?.().replaceAll("-", "")
    ?? `s${Date.now().toString(36)}`;
  let destroyed = false;

  const render = () => {
    if (destroyed) return;
    const windowNode = root.querySelector(STORE_WINDOW_SELECTOR);
    const slot = windowNode?.querySelector(STORE_EXTENSION_SELECTOR) ?? null;
    if (!slot) {
      mountedSlot = null;
      return;
    }
    mountedSlot = slot;
    slot.dataset.ordaxStoreOverviewView = "true";
    slot.dataset.storeState = snapshot.state;
    slot.replaceChildren();

    const documentObject = slot.ownerDocument;
    const header = node(documentObject, "header", "ordax-store-header");
    const copy = node(documentObject, "div", "ordax-store-heading");
    copy.append(
      node(documentObject, "span", "ordax-section-kicker", t("store.title")),
      node(documentObject, "h2", "ordax-store-title", t("store.subtitle")),
    );
    header.append(copy);
    slot.append(header);

    if (snapshot.state !== "ready") {
      const empty = node(documentObject, "section", "ordax-store-empty");
      empty.append(
        node(documentObject, "strong", "ordax-store-empty-title", t("store.status.unavailable")),
        node(documentObject, "p", "ordax-store-empty-copy", t("store.status.unavailableDetail")),
      );
      slot.append(empty);
    } else {
      const grid = node(documentObject, "div", "ordax-store-grid");
      for (const entry of snapshot.entries) {
        const card = node(documentObject, "article", "ordax-store-card");
        card.dataset.storeAppId = entry.appId;
        card.dataset.storeEntryState = entry.state;

        const title = node(documentObject, "h3", "ordax-store-card-title", entry.title);
        const meta = node(documentObject, "p", "ordax-store-card-meta", versionSummary(t, entry));
        const status = node(
          documentObject,
          "span",
          "ordax-store-card-status",
          t(stateMessageId(entry.state)),
        );
        card.append(title, meta, status);

        appendAction(documentObject, card, entry, "install", lifecycleRequests, pendingRequest, t);
        appendAction(documentObject, card, entry, "update", lifecycleRequests, pendingRequest, t);
        appendAction(documentObject, card, entry, "remove", lifecycleRequests, pendingRequest, t);

        grid.append(card);
      }
      slot.append(grid);
    }

    const security = node(documentObject, "p", "ordax-store-security", t("store.security.note"));
    security.dataset.storeAuthority = "none";
    slot.append(security);

    if (requestMessageId !== null) {
      const message = node(documentObject, "p", "ordax-store-request-status", t(requestMessageId));
      message.setAttribute("role", "status");
      slot.append(message);
    }
  };

  const onClick = (event) => {
    const button = event.target.closest?.("[data-store-operation][data-store-app-id]");
    if (!button || !mountedSlot?.contains(button) || lifecycleRequests === null || pendingRequest !== null) {
      return;
    }

    const appId = button.dataset.storeAppId;
    const operation = button.dataset.storeOperation;
    if (!OPERATIONS.has(operation)) return;

    const entry = snapshot.entries.find((candidate) => candidate.appId === appId);
    if (!entry || !operationAllowed(entry, operation)) return;

    pendingRequest = Object.freeze({ appId, operation });
    requestMessageId = null;
    render();

    requestOrdinal += 1;
    const request = validateAppLifecycleRequest({
      schema: APP_LIFECYCLE_REQUEST_SCHEMA,
      requestId: `store:${operation}:${appId}:${requestSessionId}:${requestOrdinal}`,
      appId,
      operation,
      source: "store",
      authority: "none",
    });

    void Promise.resolve(lifecycleRequests.requestLifecycle(request))
      .then((rawResult) => {
        const result = validateAppLifecycleRequestResult(rawResult);
        if (
          result.appId !== appId
          || result.operation !== operation
          || result.source !== request.source
          || result.requestId !== request.requestId
        ) {
          throw new TypeError("App Store lifecycle response identity mismatch");
        }
        requestMessageId = `store.request.${operation}.${result.state}`;
      })
      .catch(() => {
        requestMessageId = `store.request.${operation}.failed`;
      })
      .finally(() => {
        pendingRequest = null;
        render();
      });
  };

  root.addEventListener("click", onClick);
  const unsubscribeCatalog = catalog.subscribe((next) => {
    snapshot = validateAppStoreCatalogSnapshot(next);
    render();
  });
  const unsubscribeRender = lifecycle.subscribeRender(render);
  const unsubscribeLocalization = localization.subscribe(render);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeCatalog?.();
      unsubscribeRender?.();
      unsubscribeLocalization?.();
      root.removeEventListener("click", onClick);
      mountedSlot = null;
    },
  });
}
