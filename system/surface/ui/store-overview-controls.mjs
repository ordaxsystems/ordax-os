import {
  assertAppStoreCatalogPort,
  validateAppStoreCatalogSnapshot,
} from "../../contracts/app-store.mjs";
import {
  APP_INSTALL_REQUEST_SCHEMA,
  assertAppInstallRequestPort,
  validateAppInstallRequest,
  validateAppInstallRequestResult,
} from "../../contracts/app-install-request.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";

const STORE_WINDOW_SELECTOR = '[data-window-id="store"]';
const STORE_EXTENSION_SELECTOR = '[data-app-extension="store-overview"]';

function node(documentObject, tag, className = "", text = undefined) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function stateMessageId(state) {
  return `store.state.${state}`;
}

export function mountStoreOverviewControls(
  root,
  catalogPort,
  surfaceLifecycle,
  installRequestPort = null,
) {
  const catalog = assertAppStoreCatalogPort(catalogPort);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const installRequests = installRequestPort === null
    ? null
    : assertAppInstallRequestPort(installRequestPort);

  let snapshot = validateAppStoreCatalogSnapshot(catalog.getSnapshot());
  let mountedSlot = null;
  let pendingAppId = null;
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
        const meta = node(
          documentObject,
          "p",
          "ordax-store-card-meta",
          entry.version ? t("store.version", { version: entry.version }) : t(stateMessageId(entry.state)),
        );
        const status = node(documentObject, "span", "ordax-store-card-status", t(stateMessageId(entry.state)));
        card.append(title, meta, status);

        if (!entry.installed) {
          const button = node(
            documentObject,
            "button",
            "ordax-store-install",
            pendingAppId === entry.appId ? t("store.action.requesting") : t("store.action.install"),
          );
          button.type = "button";
          button.dataset.storeInstall = entry.appId;
          const canRequest = entry.installable
            && entry.artifactIdentityVerified
            && entry.provenanceVerified
            && installRequests !== null
            && pendingAppId === null;
          button.disabled = !canRequest;
          if (!canRequest && pendingAppId !== entry.appId) {
            button.title = t("store.action.unavailable");
          }
          card.append(button);
        }

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
    const button = event.target.closest?.("[data-store-install]");
    if (!button || !mountedSlot?.contains(button) || installRequests === null || pendingAppId !== null) {
      return;
    }
    const appId = button.dataset.storeInstall;
    const entry = snapshot.entries.find((candidate) => candidate.appId === appId);
    if (
      !entry
      || !entry.installable
      || !entry.artifactIdentityVerified
      || !entry.provenanceVerified
    ) {
      return;
    }

    pendingAppId = appId;
    requestMessageId = null;
    render();

    requestOrdinal += 1;
    const request = validateAppInstallRequest({
      schema: APP_INSTALL_REQUEST_SCHEMA,
      requestId: `store:${appId}:${requestSessionId}:${requestOrdinal}`,
      appId,
      source: "store",
      authority: "none",
    });

    void Promise.resolve(installRequests.requestInstall(request))
      .then((rawResult) => {
        const result = validateAppInstallRequestResult(rawResult);
        if (result.appId !== appId || result.requestId !== request.requestId) {
          throw new TypeError("App Store lifecycle response identity mismatch");
        }
        requestMessageId = result.state === "accepted"
          ? "store.request.accepted"
          : "store.request.rejected";
      })
      .catch(() => {
        requestMessageId = "store.request.failed";
      })
      .finally(() => {
        pendingAppId = null;
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
