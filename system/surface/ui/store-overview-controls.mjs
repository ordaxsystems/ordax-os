import {
  assertAppStoreCatalogPort,
  validateAppStoreCatalogSnapshot,
} from "../../contracts/app-store.mjs";
import {
  APP_LIFECYCLE_REQUEST_SCHEMA,
  assertAppLifecycleRequestPort,
  validateAppLifecycleRequest,
  validateAppLifecycleRequestResultForRequest,
} from "../../contracts/app-lifecycle-request.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { assertSystemMetricsPort } from "../../contracts/system-metrics.mjs";
import { assertAppActivationPort } from "../../contracts/app-activation.mjs";
import { appendStoreLocalAiModels } from "./store-model-catalog.mjs";

const STORE_WINDOW_SELECTOR = '[data-window-id="store"]';
const STORE_EXTENSION_SELECTOR = '[data-app-extension="store-overview"]';
const OPERATIONS = new Set(["install", "update", "remove"]);
const VIEWS = Object.freeze(["discover", "installed", "updates", "models"]);

function node(documentObject, tag, className = "", content = undefined) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = content;
  return element;
}

function makeButton(documentObject, className, text, datasetKey, datasetValue) {
  const button = node(documentObject, "button", className, text);
  button.type = "button";
  button.dataset[datasetKey] = datasetValue;
  return button;
}

function stateMessageId(state) {
  return "store.state." + state;
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

export function filterStoreEntries(entries, view = "discover", query = "") {
  if (!VIEWS.includes(view) || typeof query !== "string") {
    throw new TypeError("Invalid Store presentation filter");
  }
  if (view === "models") return [];
  const normalize = (value) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const needle = normalize(query.trim());
  return entries.filter((entry) => {
    if (view === "installed" && entry.installedVersion === null) return false;
    if (view === "updates" && (
      entry.installedVersion === null
      || !(entry.updatable || ["updating", "staged", "failed-retained"].includes(entry.state))
    )) return false;
    return !needle || normalize(entry.title).includes(needle)
      || normalize(entry.appId).includes(needle);
  });
}

export function sortStoreEntries(entries, locale = "pt-BR") {
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  return [...entries].sort((left, right) =>
    collator.compare(left.title, right.title) || left.appId.localeCompare(right.appId));
}

// Client-generated identities support idempotency but never grant authority.
// When the host does not expose secure entropy, lifecycle requests fail closed.
export function createStoreRequestSessionId(cryptoProvider = globalThis.crypto) {
  try {
    if (typeof cryptoProvider?.randomUUID === "function") {
      const uuid = cryptoProvider.randomUUID();
      if (typeof uuid === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(uuid)) {
        return uuid.replaceAll("-", "").toLowerCase();
      }
    }
    if (typeof cryptoProvider?.getRandomValues !== "function") return null;
    const bytes = new Uint8Array(16);
    cryptoProvider.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function appendAction(documentObject, target, entry, operation, lifecycleRequests, pendingRequest, t, requestIdentityReady) {
  if (!operationAllowed(entry, operation)) return;
  const isPending = pendingRequest?.appId === entry.appId
    && pendingRequest?.operation === operation;
  const button = makeButton(
    documentObject,
    "ordax-store-action" + (operation === "remove" ? " ordax-store-action-secondary" : ""),
    isPending ? t("store.action.requesting") : t("store.action." + operation),
    "storeOperation",
    operation,
  );
  button.dataset.storeAppId = entry.appId;
  button.disabled = lifecycleRequests === null || !requestIdentityReady || pendingRequest !== null;
  if (lifecycleRequests === null || !requestIdentityReady) button.title = t("store.action.unavailable");
  target.append(button);
}

function appMonogram(title) {
  return title.trim().split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toLocaleUpperCase();
}

function appendStatus(documentObject, parent, entry, t) {
  const status = node(documentObject, "span", "ordax-store-card-status", t(stateMessageId(entry.state)));
  status.dataset.storeEntryState = entry.state;
  parent.append(status);
}

function appendCard(documentObject, grid, entry, lifecycleRequests, pendingRequest, t, requestIdentityReady) {
  const card = node(documentObject, "article", "ordax-store-card");
  card.dataset.storeAppId = entry.appId;
  card.dataset.storeAppCard = "true";
  card.dataset.storeEntryState = entry.state;

  const top = node(documentObject, "div", "ordax-store-card-top");
  const monogram = node(documentObject, "span", "ordax-store-app-icon", appMonogram(entry.title));
  monogram.setAttribute("aria-hidden", "true");
  const heading = node(documentObject, "div", "ordax-store-card-heading");
  heading.append(
    node(documentObject, "h3", "ordax-store-card-title", entry.title),
    node(documentObject, "p", "ordax-store-card-meta", versionSummary(t, entry)),
  );
  top.append(monogram, heading);
  const footer = node(documentObject, "div", "ordax-store-card-footer");
  appendStatus(documentObject, card, entry, t);
  const details = makeButton(documentObject, "ordax-store-details-link", t("store.details.open"), "storeDetails", entry.appId);
  details.setAttribute("aria-label", t("store.details.openFor", { title: entry.title }));
  footer.append(details);
  const actions = node(documentObject, "div", "ordax-store-actions");
  appendAction(documentObject, actions, entry, "install", lifecycleRequests, pendingRequest, t, requestIdentityReady);
  appendAction(documentObject, actions, entry, "update", lifecycleRequests, pendingRequest, t, requestIdentityReady);
  footer.append(actions);
  card.append(top, footer);
  grid.append(card);
}

function appendDetail(documentObject, target, entry, lifecycleRequests, pendingRequest, removalConfirmationAppId, t, requestIdentityReady) {
  const back = makeButton(documentObject, "ordax-store-back", t("store.details.back"), "storeBack", "true");
  const panel = node(documentObject, "section", "ordax-store-detail");
  const heading = node(documentObject, "header", "ordax-store-detail-header");
  const monogram = node(documentObject, "span", "ordax-store-app-icon ordax-store-app-icon-large", appMonogram(entry.title));
  monogram.setAttribute("aria-hidden", "true");
  const titleGroup = node(documentObject, "div", "ordax-store-detail-heading");
  titleGroup.append(
    node(documentObject, "span", "ordax-store-eyebrow", t("store.details.heading")),
    node(documentObject, "h3", "ordax-store-detail-title", entry.title),
    node(documentObject, "p", "ordax-store-card-meta", versionSummary(t, entry)),
  );
  heading.append(monogram, titleGroup);

  const state = node(documentObject, "div", "ordax-store-detail-state");
  appendStatus(documentObject, state, entry, t);
  const actions = node(documentObject, "div", "ordax-store-actions");
  for (const operation of OPERATIONS) {
    appendAction(documentObject, actions, entry, operation, lifecycleRequests, pendingRequest, t, requestIdentityReady);
  }
  state.append(actions);
  if (removalConfirmationAppId === entry.appId && entry.removable) {
    const confirmation = node(documentObject, "section", "ordax-store-removal-confirmation");
    confirmation.setAttribute("role", "group");
    confirmation.setAttribute("aria-label", t("store.remove.confirmTitle"));
    confirmation.append(
      node(documentObject, "strong", "", t("store.remove.confirmTitle")),
      node(documentObject, "p", "", t("store.remove.confirmDescription")),
    );
    const controls = node(documentObject, "div", "ordax-store-actions");
    const confirmButton = makeButton(
      documentObject, "ordax-store-action ordax-store-action-danger",
      t("store.remove.confirmAction"), "storeConfirmRemove", "true",
    );
    confirmButton.dataset.storeOperation = "remove";
    confirmButton.dataset.storeAppId = entry.appId;
    const cancelButton = makeButton(
      documentObject, "ordax-store-action ordax-store-action-secondary",
      t("store.remove.cancel"), "storeCancelRemove", "true",
    );
    controls.append(confirmButton, cancelButton);
    confirmation.append(controls);
    state.append(confirmation);
  }

  const technical = node(documentObject, "section", "ordax-store-detail-technical");
  technical.append(node(documentObject, "h4", "", t("store.details.technical")));
  const rows = [
    ["store.details.appId", entry.appId],
    ["store.details.installedVersion", entry.installedVersion ?? t("store.details.none")],
    ["store.details.availableVersion", entry.availableVersion ?? t("store.details.none")],
    ["store.details.artifact", entry.availableVersion === null ? t("store.details.notApplicable") : t(entry.artifactIdentityVerified ? "store.details.verified" : "store.details.notVerified")],
    ["store.details.provenance", entry.availableVersion === null ? t("store.details.notApplicable") : t(entry.provenanceVerified ? "store.details.verified" : "store.details.notVerified")],
  ];
  const list = node(documentObject, "dl", "ordax-store-detail-facts");
  for (const [key, value] of rows) {
    const fact = node(documentObject, "div", "ordax-store-detail-fact");
    fact.append(node(documentObject, "dt", "", t(key)), node(documentObject, "dd", "", value));
    list.append(fact);
  }
  technical.append(list);
  const permissions = node(documentObject, "p", "ordax-store-detail-note", t("store.details.permissionNote"));
  technical.append(permissions);
  if (entry.blockedReason !== null) {
    const reason = node(documentObject, "p", "ordax-store-detail-warning", t("store.details.blocked") + " " + entry.blockedReason);
    technical.append(reason);
  }
  panel.append(heading, state, technical);
  target.append(back, panel);
}

export function mountStoreOverviewControls(
  root,
  catalogPort,
  surfaceLifecycle,
  lifecycleRequestPort = null,
  modelHardwareReader = null,
  modelMetricsPort = null,
  appActivationPort = null,
) {
  const catalog = assertAppStoreCatalogPort(catalogPort);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const localization = lifecycle.localization;
  const t = localization.translate;
  const lifecycleRequests = lifecycleRequestPort === null
    ? null
    : assertAppLifecycleRequestPort(lifecycleRequestPort);
  if (modelHardwareReader !== null && typeof modelHardwareReader !== "function") {
    throw new TypeError("Store Local AI hardware reader must be a function");
  }
  const modelMetrics = modelMetricsPort === null ? null : assertSystemMetricsPort(modelMetricsPort);
  const activation = appActivationPort === null ? null : assertAppActivationPort(appActivationPort);

  let snapshot = validateAppStoreCatalogSnapshot(catalog.getSnapshot());
  // These are ephemeral presentation revisions, not a second catalog or
  // persisted inventory. Only semantic snapshot changes invalidate a request.
  let catalogFingerprint = JSON.stringify(snapshot);
  let catalogGeneration = 0;
  let mountedSlot = null;
  let pendingRequest = null;
  let requestMessageId = null;
  let requestReason = null;
  let requestOrdinal = 0;
  let activeView = "discover";
  let searchQuery = "";
  let selectedAppId = null;
  let removalConfirmationAppId = null;
  const requestSessionId = createStoreRequestSessionId();
  let destroyed = false;
  let modelHardware = null;
  let modelMetricsSnapshot = null;
  let modelReadState = "idle";
  let modelReadOrdinal = 0;
  let modelReadAbort = null;

  const refreshModelResources = async () => {
    if (destroyed || modelReadState === "loading") return;
    const ordinal = ++modelReadOrdinal;
    modelReadState = "loading";
    modelHardware = null;
    modelMetricsSnapshot = null;
    render();
    const controller = new AbortController();
    modelReadAbort = controller;
    let deadline = null;
    const timedOut = new Promise((_, reject) => {
      deadline = setTimeout(() => {
        controller.abort();
        reject(new Error("Native model capability read exceeded deadline"));
      }, 5000);
    });
    let hardware, metrics;
    try {
      [hardware, metrics] = await Promise.allSettled([
        Promise.race([
          Promise.resolve().then(() => modelHardwareReader === null
            ? null : modelHardwareReader({ signal: controller.signal })),
          timedOut,
        ]),
        Promise.race([
          Promise.resolve().then(() => modelMetrics === null
            ? null : modelMetrics.read({ signal: controller.signal })),
          timedOut,
        ]),
      ]);
    } finally {
      clearTimeout(deadline);
      if (modelReadAbort === controller) modelReadAbort = null;
    }
    if (destroyed || ordinal !== modelReadOrdinal) return;
    // Fail closed on incomplete readings; do not keep stale values as current.
    modelHardware = hardware.status === "fulfilled" ? hardware.value : null;
    modelMetricsSnapshot = metrics.status === "fulfilled" ? metrics.value : null;
    modelReadState = hardware.status === "rejected" || metrics.status === "rejected"
      ? "error" : "ready";
    render();
  };

  const reconcileAcceptedRequest = () => {
    if (pendingRequest?.phase !== "accepted") return;
    const entry = snapshot.entries.find((candidate) => candidate.appId === pendingRequest.appId);
    if (!entry || !operationAllowed(entry, pendingRequest.operation)) pendingRequest = null;
  };

  const refreshResults = () => {
    if (!mountedSlot || activeView === "models" || snapshot.state !== "ready" || selectedAppId !== null) return;
    const filtered = filterStoreEntries(snapshot.entries, activeView, searchQuery);
    const shownIds = new Set(filtered.map((entry) => entry.appId));
    for (const card of mountedSlot.querySelectorAll("[data-store-app-card]")) {
      card.hidden = !shownIds.has(card.dataset.storeAppId);
    }
    const resultCount = mountedSlot.querySelector("[data-store-results-count]");
    if (resultCount) resultCount.textContent = t("store.results.count", { count: String(filtered.length) });
    const empty = mountedSlot.querySelector("[data-store-filter-empty]");
    if (empty) empty.hidden = filtered.length !== 0;
  };

  const render = () => {
    if (destroyed) return;
    const windowNode = root.querySelector(STORE_WINDOW_SELECTOR);
    const slot = windowNode?.querySelector(STORE_EXTENSION_SELECTOR) ?? null;
    if (!slot) {
      mountedSlot = null;
      return;
    }
    const restoreSearchFocus = slot.contains(slot.ownerDocument.activeElement)
      && slot.ownerDocument.activeElement?.dataset?.storeSearch === "true";
    mountedSlot = slot;
    slot.dataset.ordaxStoreOverviewView = "true";
    slot.dataset.storeState = snapshot.state;
    slot.replaceChildren();

    const documentObject = slot.ownerDocument;
    const layout = node(documentObject, "div", "ordax-store-layout");
    const sidebar = node(documentObject, "aside", "ordax-store-sidebar");
    sidebar.append(node(documentObject, "div", "ordax-store-sidebar-title", t("store.title")));
    const nav = node(documentObject, "nav", "ordax-store-nav");
    nav.setAttribute("aria-label", t("store.navigation.label"));
    for (const view of VIEWS) {
      const button = makeButton(documentObject, "ordax-store-nav-item", t("store.navigation." + view), "storeView", view);
      button.setAttribute("aria-pressed", String(activeView === view));
      if (activeView === view) button.setAttribute("aria-current", "page");
      nav.append(button);
    }
    sidebar.append(nav);
    const main = node(documentObject, "main", "ordax-store-main");
    const header = node(documentObject, "header", "ordax-store-header");
    const copy = node(documentObject, "div", "ordax-store-heading");
    copy.append(
      node(documentObject, "span", "ordax-section-kicker", t("store.title")),
      node(documentObject, "h2", "ordax-store-title", t("store.subtitle")),
    );
    header.append(copy);
    main.append(header);

    if (activeView === "models") {
      appendStoreLocalAiModels(documentObject, main, {
        hardware: modelHardware,
        metrics: modelMetricsSnapshot,
        readState: modelReadState,
        systemUpdatesAvailable: activation !== null,
        t,
        locale: localization.getLocale(),
      });
    } else if (snapshot.state !== "ready") {
      const empty = node(documentObject, "section", "ordax-store-empty");
      empty.append(
        node(documentObject, "span", "ordax-store-empty-symbol", "◇"),
        node(documentObject, "strong", "ordax-store-empty-title", t("store.status.unavailable")),
        node(documentObject, "p", "ordax-store-empty-copy", t("store.status.unavailableDetail")),
      );
      main.append(empty);
    } else {
      const selectedEntry = snapshot.entries.find((entry) => entry.appId === selectedAppId);
      if (selectedEntry) {
        appendDetail(documentObject, main, selectedEntry, lifecycleRequests, pendingRequest, removalConfirmationAppId, t, requestSessionId !== null);
      } else {
        selectedAppId = null;
        const search = node(documentObject, "div", "ordax-store-search");
        const input = node(documentObject, "input", "ordax-store-search-input");
        input.type = "search";
        input.maxLength = 160;
        input.value = searchQuery;
        input.placeholder = t("store.search.placeholder");
        input.setAttribute("aria-label", t("store.search.label"));
        input.dataset.storeSearch = "true";
        search.append(input);
        main.append(search);

        if (activeView === "discover") {
          const hero = node(documentObject, "section", "ordax-store-hero");
          const heroCopy = node(documentObject, "div", "ordax-store-hero-copy");
          heroCopy.append(
            node(documentObject, "span", "ordax-store-eyebrow", t("store.hero.kicker")),
            node(documentObject, "h3", "ordax-store-hero-title", t("store.hero.title")),
            node(documentObject, "p", "ordax-store-hero-description", t("store.hero.description")),
          );
          const art = node(documentObject, "div", "ordax-store-hero-art");
          art.setAttribute("aria-hidden", "true");
          for (let i = 0; i < 3; i += 1) art.append(node(documentObject, "span", "ordax-store-hero-orbit"));
          hero.append(heroCopy, art);
          main.append(hero);
        }

        const listing = node(documentObject, "section", "ordax-store-listing");
        const listHeader = node(documentObject, "div", "ordax-store-list-header");
        const titles = node(documentObject, "div", "ordax-store-list-titles");
        titles.append(
          node(documentObject, "h3", "ordax-store-list-title", t("store.section." + activeView)),
          node(documentObject, "p", "ordax-store-list-description", t("store.section.description." + activeView)),
        );
        const count = node(documentObject, "span", "ordax-store-result-count");
        count.dataset.storeResultsCount = "true";
        listHeader.append(titles, count);
        const grid = node(documentObject, "div", "ordax-store-grid");
        for (const entry of sortStoreEntries(snapshot.entries, localization.getLocale())) {
          appendCard(documentObject, grid, entry, lifecycleRequests, pendingRequest, t, requestSessionId !== null);
        }
        const filterEmpty = node(documentObject, "div", "ordax-store-filter-empty");
        filterEmpty.dataset.storeFilterEmpty = "true";
        filterEmpty.setAttribute("role", "status");
        filterEmpty.append(
          node(documentObject, "strong", "", t("store.empty.filtered")),
          node(documentObject, "p", "", t("store.empty.filteredDescription")),
        );
        listing.append(listHeader, grid, filterEmpty);
        main.append(listing);
      }
    }

    const security = node(documentObject, "p", "ordax-store-security", t("store.security.note"));
    security.dataset.storeAuthority = "none";
    main.append(security);
    if (requestMessageId !== null) {
      const messageText = t(requestMessageId) + (
        requestReason === null ? "" : " " + t("store.request.reason", { reason: requestReason })
      );
      const message = node(documentObject, "p", "ordax-store-request-status", messageText);
      message.setAttribute("role", "status");
      main.append(message);
    }
    layout.append(sidebar, main);
    slot.append(layout);
    refreshResults();
    if (restoreSearchFocus) slot.querySelector("[data-store-search]")?.focus?.();
  };

  const onInput = (event) => {
    const input = event.target.closest?.("[data-store-search]");
    if (!input || !mountedSlot?.contains(input)) return;
    searchQuery = input.value.slice(0, 160);
    refreshResults();
  };

  const onClick = (event) => {
    if (!mountedSlot) return;
    const cancelButton = event.target.closest?.("[data-store-cancel-remove]");
    if (cancelButton && mountedSlot.contains(cancelButton)) {
      removalConfirmationAppId = null;
      render();
      mountedSlot?.querySelector('[data-store-operation="remove"]')?.focus?.();
      return;
    }
    const systemUpdates = event.target.closest?.("[data-store-model-system-updates]");
    if (systemUpdates && mountedSlot.contains(systemUpdates) && activeView === "models"
      && activation !== null) {
      activation.publish({ appId: "system", target: "updates" });
      return;
    }
    const modelRefresh = event.target.closest?.("[data-store-models-refresh]");
    if (modelRefresh && mountedSlot.contains(modelRefresh) && activeView === "models") {
      void refreshModelResources();
      return;
    }
    const viewButton = event.target.closest?.("[data-store-view]");
    if (viewButton && mountedSlot.contains(viewButton) && VIEWS.includes(viewButton.dataset.storeView)) {
      activeView = viewButton.dataset.storeView;
      selectedAppId = null;
      removalConfirmationAppId = null;
      render();
      mountedSlot?.querySelector('[data-store-view="' + activeView + '"]')?.focus?.();
      if (activeView === "models" && modelReadState === "idle") {
        void refreshModelResources();
      }
      return;
    }
    const detailButton = event.target.closest?.("[data-store-details]");
    if (detailButton && mountedSlot.contains(detailButton)) {
      const appId = detailButton.dataset.storeDetails;
      if (!snapshot.entries.some((entry) => entry.appId === appId)) return;
      selectedAppId = appId;
      removalConfirmationAppId = null;
      render();
      mountedSlot?.querySelector("[data-store-back]")?.focus?.();
      return;
    }
    const backButton = event.target.closest?.("[data-store-back]");
    if (backButton && mountedSlot.contains(backButton)) {
      const previousAppId = selectedAppId;
      selectedAppId = null;
      removalConfirmationAppId = null;
      render();
      const priorButton = Array.from(mountedSlot?.querySelectorAll("[data-store-details]") ?? [])
        .find((candidate) => candidate.dataset.storeDetails === previousAppId);
      priorButton?.focus?.();
      return;
    }

    const button = event.target.closest?.("[data-store-operation][data-store-app-id]");
    if (!button || !mountedSlot.contains(button) || lifecycleRequests === null || requestSessionId === null || pendingRequest !== null) return;
    const appId = button.dataset.storeAppId;
    const operation = button.dataset.storeOperation;
    if (!OPERATIONS.has(operation)) return;
    const entry = snapshot.entries.find((candidate) => candidate.appId === appId);
    if (!entry || !operationAllowed(entry, operation)) return;
    if (operation === "remove" && button.dataset.storeConfirmRemove !== "true") {
      removalConfirmationAppId = appId;
      render();
      mountedSlot?.querySelector("[data-store-confirm-remove]")?.focus?.();
      return;
    }
    if (operation === "remove" && removalConfirmationAppId !== appId) return;
    removalConfirmationAppId = null;

    requestMessageId = null;
    requestReason = null;
    requestOrdinal += 1;
    const request = validateAppLifecycleRequest({
      schema: APP_LIFECYCLE_REQUEST_SCHEMA,
      requestId: "store:" + operation + ":" + appId + ":" + requestSessionId + ":" + requestOrdinal,
      appId,
      operation,
      source: "store",
      authority: "none",
    });
    pendingRequest = Object.freeze({
      appId,
      operation,
      requestId: request.requestId,
      phase: "requesting",
    });
    const requestGeneration = catalogGeneration;
    const isCurrentRequest = () => !destroyed
      && catalogGeneration === requestGeneration
      && pendingRequest?.requestId === request.requestId;
    render();

    // Deferred work must never resurrect a request from a replaced signed
    // catalog, another request, or a destroyed Surface instance.
    void Promise.resolve()
      .then(() => {
        if (!isCurrentRequest()) return null;
        return lifecycleRequests.requestLifecycle(request);
      })
      .then((rawResult) => {
        if (!isCurrentRequest()) return;
        const result = validateAppLifecycleRequestResultForRequest(rawResult, request);
        requestMessageId = "store.request." + operation + "." + result.state;
        requestReason = result.state === "rejected" ? result.reason : null;
        if (result.state === "accepted") {
          pendingRequest = Object.freeze({
            appId,
            operation,
            requestId: request.requestId,
            phase: "accepted",
          });
          reconcileAcceptedRequest();
        } else {
          pendingRequest = null;
        }
        render();
      })
      .catch(() => {
        if (!isCurrentRequest()) return;
        pendingRequest = null;
        requestMessageId = "store.request." + operation + ".failed";
        requestReason = null;
        render();
      });
  };

  const onKeyDown = (event) => {
    if (event.key !== "Escape" || !mountedSlot?.contains(event.target)) return;
    if (removalConfirmationAppId !== null) {
      removalConfirmationAppId = null;
      render();
      mountedSlot?.querySelector('[data-store-operation="remove"]')?.focus?.();
      event.preventDefault();
    } else if (selectedAppId !== null) {
      const previousAppId = selectedAppId;
      selectedAppId = null;
      render();
      const priorButton = Array.from(mountedSlot?.querySelectorAll("[data-store-details]") ?? [])
        .find((candidate) => candidate.dataset.storeDetails === previousAppId);
      priorButton?.focus?.();
      event.preventDefault();
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeyDown);
  const unsubscribeCatalog = catalog.subscribe((next) => {
    const verified = validateAppStoreCatalogSnapshot(next);
    const fingerprint = JSON.stringify(verified);
    if (fingerprint !== catalogFingerprint) {
      // Drop stale visual request state before showing the new projection.
      // Platform requests already delegated remain platform-owned.
      catalogFingerprint = fingerprint;
      catalogGeneration += 1;
      pendingRequest = null;
      requestMessageId = null;
      requestReason = null;
      removalConfirmationAppId = null;
    }
    snapshot = verified;
    reconcileAcceptedRequest();
    render();
  });
  const unsubscribeRender = lifecycle.subscribeRender(render);
  const unsubscribeLocalization = localization.subscribe(render);
  render();

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      modelReadOrdinal += 1;
      modelReadAbort?.abort();
      modelReadAbort = null;
      unsubscribeCatalog?.();
      unsubscribeRender?.();
      unsubscribeLocalization?.();
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("keydown", onKeyDown);
      mountedSlot = null;
    },
  });
}
