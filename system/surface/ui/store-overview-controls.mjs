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
import { STORE_OPERATIONS, storeEntryOpenAvailable, storeEntryVisualState, storeEmptyPresentation } from "./store-entry-presentation.mjs";
import { captureStoreControlFocus, restoreStoreControlFocus } from "./store-control-focus.mjs";
import { captureSectionNavigationScroll, restoreSectionNavigationScroll } from "./section-navigation.mjs";
import { STORE_UPDATE_BATCH_SCHEMA, createStoreUpdateRequestBatch } from "../../services/apps/store-update-request-batch.mjs";
import { listFirstRunDefaultAppIds } from "../../services/apps/first-run-selection.mjs";

const STORE_WINDOW_SELECTOR = '[data-window-id="store"]';
const STORE_EXTENSION_SELECTOR = '[data-app-extension="store-overview"]';
const OPERATIONS = new Set(STORE_OPERATIONS);
const VIEWS = Object.freeze(["discover", "essentials", "installed", "updates", "models"]);
const ESSENTIAL_APP_IDS = new Set(listFirstRunDefaultAppIds());

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

// A request is scoped to the signed lifecycle candidate, not the entire
// Store catalog. Metadata or progress of another app cannot change its ID.
function lifecycleCandidateSignature(entry, operation) {
  return JSON.stringify([
    entry.appId,
    operation,
    entry.state,
    entry.installedVersion,
    operation === "remove" ? null : entry.availableVersion,
    operationAllowed(entry, operation),
    operation === "remove" ? null : entry.artifactIdentityVerified,
    operation === "remove" ? null : entry.provenanceVerified,
  ]);
}

function sameLifecycleCandidate(catalogSnapshot, appId, operation, signature) {
  if (catalogSnapshot.state !== "ready") return false;
  const entry = catalogSnapshot.entries.find((candidate) => candidate.appId === appId);
  return entry !== undefined && operationAllowed(entry, operation)
    && lifecycleCandidateSignature(entry, operation) === signature;
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
    if (view === "essentials" && !ESSENTIAL_APP_IDS.has(entry.appId)) return false;
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
    isPending && pendingRequest?.phase === "requesting"
      ? t("store.action.requesting") : t("store.action." + operation),
    "storeOperation",
    operation,
  );
  button.dataset.storeAppId = entry.appId;
  button.disabled = lifecycleRequests === null || !requestIdentityReady || pendingRequest !== null;
  if (lifecycleRequests === null || !requestIdentityReady) button.title = t("store.action.unavailable");
  target.append(button);
}

function appendOpenAction(documentObject, target, entry, activation, t) {
  if (activation === null || !storeEntryOpenAvailable(entry)) return;
  const label = t("surface.launcher.open", { app: entry.title });
  const button = makeButton(
    documentObject,
    "ordax-store-action",
    label,
    "storeOpenApp",
    entry.appId,
  );
  button.title = label;
  target.append(button);
}

function appMonogram(title) {
  return title.trim().split(/\s+/u).slice(0, 2).map((part) => Array.from(part)[0] ?? "").join("").toLocaleUpperCase();
}

function appendStatus(documentObject, parent, entry, pendingRequest, t) {
  const visual = storeEntryVisualState(entry, pendingRequest);
  const badges = node(documentObject, "div", "ordax-store-statuses");
  const status = node(documentObject, "span", "ordax-store-card-status", t(stateMessageId(visual.state)));
  status.dataset.storeEntryState = visual.state;
  badges.append(status);
  if (visual.updateAvailable) {
    const update = node(documentObject, "span",
      "ordax-store-card-status ordax-store-update-status", t("store.section.updates"));
    update.dataset.storeUpdateAvailable = "true";
    badges.append(update);
  }
  parent.append(badges);
  // Request accepted by OS is not a successful installation or removal.
  if (visual.requestPhase !== null) {
    const message = visual.requestPhase === "accepted"
      ? t("store.request." + visual.requestOperation + ".accepted")
      : t("store.action.requesting");
    const note = node(documentObject, "p", "ordax-store-card-context", message);
    note.dataset.storeRequestPhase = visual.requestPhase;
    parent.append(note);
  }
}

function appendCard(documentObject, grid, entry, lifecycleRequests, pendingRequest, t, requestIdentityReady, activation) {
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
  appendStatus(documentObject, footer, entry, pendingRequest, t);
  if (entry.state === "blocked" && entry.blockedReason !== null) {
    const reason = node(documentObject, "p", "ordax-store-card-warning",
      t("store.details.blocked") + " " + entry.blockedReason);
    footer.append(reason);
  }
  const details = makeButton(documentObject, "ordax-store-details-link", t("store.details.open"), "storeDetails", entry.appId);
  details.setAttribute("aria-label", t("store.details.openFor", { title: entry.title }));
  footer.append(details);
  const actions = node(documentObject, "div", "ordax-store-actions");
  appendOpenAction(documentObject, actions, entry, activation, t);
  appendAction(documentObject, actions, entry, "install", lifecycleRequests, pendingRequest, t, requestIdentityReady);
  appendAction(documentObject, actions, entry, "update", lifecycleRequests, pendingRequest, t, requestIdentityReady);
  footer.append(actions);
  card.append(top, footer);
  grid.append(card);
}

function appendDetail(documentObject, target, entry, lifecycleRequests, pendingRequest, removalConfirmationAppId, t, requestIdentityReady, activation) {
  const back = makeButton(documentObject, "ordax-store-back", t("store.details.back"), "storeBack", "true");
  const panel = node(documentObject, "section", "ordax-store-detail");
  panel.dataset.storeDetailAppId = entry.appId;
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
  appendStatus(documentObject, state, entry, pendingRequest, t);
  const actions = node(documentObject, "div", "ordax-store-actions");
  appendOpenAction(documentObject, actions, entry, activation, t);
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
  resolveSlot = null,
) {
  if (resolveSlot !== null && typeof resolveSlot !== "function") throw new TypeError("Store slot resolver must be a function");
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
  // Snapshot identity is presentation-only. Request identity is tied to each
  // signed candidate, not to unrelated global catalog revision changes.
  let catalogFingerprint = JSON.stringify(snapshot);
  let mountedSlot = null;
  let pendingRequest = null;
  let requestMessageId = null;
  let requestReason = null;
  let requestOrdinal = 0;
  // Ephemeral idempotency receipts, not another inventory or authority.
  // Reserve the ID before delegation: any catalog emission during an
  // unresolved request must preserve it if this candidate is unchanged.
  // Bounded by the OS catalog (<=256 app IDs, 3 operations each).
  const uncertainRequestIds = new Map();
  // An accepted lifecycle REQUEST is not an installed application. Keep the
  // receipt per app until the authoritative catalog changes that candidate,
  // without blocking unrelated apps while the OS works asynchronously.
  const acceptedRequests = new Map();
  let activeView = VIEWS.includes(lifecycle.getAppTarget("store"))
    ? lifecycle.getAppTarget("store") : "discover";
  let searchQuery = "";
  let selectedAppId = null;
  let removalConfirmationAppId = null;
  const requestSessionId = createStoreRequestSessionId();
  const updateAll = lifecycleRequests === null || requestSessionId === null ? null
    : createStoreUpdateRequestBatch({
      catalogPort: catalog,
      lifecycleRequestPort: lifecycleRequests,
      requestIdFactory: (appId) => {
        requestOrdinal += 1;
        return "store:update:" + appId + ":" + requestSessionId + ":" + requestOrdinal;
      },
    });
  let batchInFlight = false;
  let batchReport = null;
  let batchPresentationGeneration = 0;
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
    if (snapshot.state !== "ready") return;
    for (const [appId, receipt] of acceptedRequests) {
      if (!sameLifecycleCandidate(snapshot, appId,
        receipt.operation, receipt.candidateSignature)) acceptedRequests.delete(appId);
    }
  };

  // Batch and individual updates share no host-level receipt registry.
  // Until the OS batch supports candidate exclusions, fail closed on bulk
  // submission when an individually accepted update could be sent twice.
  // Other applications retain their individual lifecycle actions.
  const hasAcceptedUpdateRequest = () => snapshot.state === "ready"
    && Array.from(acceptedRequests).some(([appId, receipt]) =>
      receipt.operation === "update"
      && sameLifecycleCandidate(snapshot, appId, "update", receipt.candidateSignature));

  // Import only genuine accepted outcomes from the OS-owned batch.
  // A receipt never means that the installed version or app grants changed.
  const recordBatchAcceptedUpdates = (report) => {
    if (report?.schema !== STORE_UPDATE_BATCH_SCHEMA || report.authority !== "none"
      || !Array.isArray(report.outcomes) || report.outcomes.length > 256
      || snapshot.state !== "ready") return;
    for (const outcome of report.outcomes) {
      if (outcome?.state !== "accepted" || typeof outcome.requestId !== "string") continue;
      const entry = snapshot.entries.find((candidate) =>
        candidate.appId === outcome.appId
        && candidate.state === "installed" && candidate.updatable
        && candidate.artifactIdentityVerified && candidate.provenanceVerified
        && candidate.installedVersion === outcome.fromVersion
        && candidate.availableVersion === outcome.toVersion);
      if (!entry) continue;
      acceptedRequests.set(entry.appId, Object.freeze({
        appId: entry.appId, operation: "update",
        candidateSignature: lifecycleCandidateSignature(entry, "update"),
        requestId: outcome.requestId, phase: "accepted",
      }));
    }
    reconcileAcceptedRequest();
  };

  const requestForEntry = (entry) => {
    // Preserve the Host contract: Update All is a global in-flight lock,
    // while accepted individual requests are scoped to their own app.
    const inFlight = batchInFlight ? { appId: "", operation: "update" } : pendingRequest;
    return inFlight ?? acceptedRequests.get(entry.appId) ?? null;
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
    if (empty) {
      const presentation = storeEmptyPresentation(snapshot.entries.length, filtered.length, activeView, searchQuery);
      empty.hidden = presentation === null;
      if (presentation) {
        empty.dataset.storeEmptyReason = presentation.reason;
        const title = empty.querySelector("[data-store-empty-title]");
        const description = empty.querySelector("[data-store-empty-description]");
        if (title) title.textContent = t(presentation.titleId);
        if (description) description.textContent = t(presentation.descriptionId);
      }
    }
  };

  const render = () => {
    if (destroyed) return;
    const windowNode = root.querySelector(STORE_WINDOW_SELECTOR);
    const slot = resolveSlot ? resolveSlot() : windowNode?.querySelector(STORE_EXTENSION_SELECTOR) ?? null;
    if (!slot) {
      mountedSlot = null;
      return;
    }
    // The Native window stays mounted while minimized/unfocused. Its catalog
    // is still authoritative, but rebuilding up to 256 cards in the background
    // is wasted work. The next Surface focus render paints the latest snapshot.
    if (windowNode && (windowNode.hidden || windowNode.dataset.active === "false")) {
      mountedSlot = slot;
      return;
    }
    const searchField = slot.contains(slot.ownerDocument.activeElement)
      && slot.ownerDocument.activeElement?.dataset?.storeSearch === "true"
      ? slot.ownerDocument.activeElement : null;
    const searchSelection = searchField && Number.isInteger(searchField.selectionStart)
      && Number.isInteger(searchField.selectionEnd)
      ? { start: searchField.selectionStart, end: searchField.selectionEnd,
          direction: searchField.selectionDirection } : null;
    const previousActiveView = slot.querySelector('[data-store-view][aria-current="page"]')?.dataset.storeView;
    const previousNavigationScroll = captureSectionNavigationScroll(slot);
    const previousControlFocus = captureStoreControlFocus(slot, slot.ownerDocument);
    mountedSlot = slot;
    slot.dataset.ordaxStoreOverviewView = "true";
    slot.dataset.storeState = snapshot.state;
    slot.replaceChildren();

    const documentObject = slot.ownerDocument;
    const layout = node(documentObject, "div", "ordax-store-layout");
    const sidebar = node(documentObject, "aside", "ordax-store-sidebar");
    sidebar.append(node(documentObject, "div", "ordax-store-sidebar-title", t("store.title")));
    const nav = node(documentObject, "nav", "ordax-store-nav ordax-section-navigation");
    nav.setAttribute("aria-label", t("store.navigation.label"));
    for (const view of VIEWS) {
      const button = makeButton(documentObject, "ordax-store-nav-item ordax-section-navigation-item", t("store.navigation." + view), "storeView", view);
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
    // Keep actionable Store feedback near its controls, not below up to
    // 256 app cards. Request acceptance never means an OS installation.
    if (requestMessageId !== null) {
      const messageText = t(requestMessageId) + (
        requestReason === null ? "" : " " + t("store.request.reason", { reason: requestReason })
      );
      const message = node(documentObject, "p", "ordax-store-request-status", messageText);
      message.dataset.storeRequestMessage = "true";
      message.dataset.storeFeedbackState = /\.(rejected|failed)$/.test(requestMessageId)
        ? "attention" : "information";
      message.setAttribute("role", "status");
      message.setAttribute("aria-live", "polite");
      message.setAttribute("aria-atomic", "true");
      main.append(message);
    }
    if (activeView === "updates" && snapshot.state === "ready") {
      const explanation = node(documentObject, "p", "ordax-store-detail-note",
        t("store.updateAll.explanation"));
      main.append(explanation);
      if (batchInFlight || batchReport !== null) {
        const report = batchReport;
        const state = batchInFlight ? "queued" : report?.state ?? "failed";
        const status = node(documentObject, "p", "ordax-store-request-status",
          t("store.updateAll.status." + state, {
            accepted: String(report?.acceptedRequests ?? 0),
            rejected: String(report?.rejectedRequests ?? 0),
            skipped: String(report?.skippedRequests ?? 0),
          }));
        status.dataset.storeUpdateAllStatus = state;
        status.dataset.storeFeedbackState = ["catalog-unavailable", "failed"].includes(state)
          ? "attention" : "information";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.setAttribute("aria-atomic", "true");
        main.append(status);
      }
    }
    // The catalog is authoritative, but some hosts intentionally cannot
    // delegate lifecycle requests. Explain disabled buttons in plain view.
    if (snapshot.state === "ready" && activeView !== "models"
        && (lifecycleRequests === null || requestSessionId === null)) {
      const unavailable = node(documentObject, "p", "ordax-store-action-unavailable",
        t("store.action.unavailable"));
      unavailable.dataset.storeFeedbackState = "attention";
      unavailable.setAttribute("role", "status");
      main.append(unavailable);
    }

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
      empty.dataset.storeEmptyReason = "catalog-unavailable";
      empty.setAttribute("role", "status");
      empty.append(
        node(documentObject, "span", "ordax-store-empty-symbol", "◇"),
        node(documentObject, "strong", "ordax-store-empty-title", t("store.status.unavailable")),
        node(documentObject, "p", "ordax-store-empty-copy", t("store.status.unavailableDetail")),
      );
      main.append(empty);
    } else {
      const selectedEntry = snapshot.entries.find((entry) => entry.appId === selectedAppId);
      if (selectedEntry) {
        appendDetail(documentObject, main, selectedEntry, lifecycleRequests,
          requestForEntry(selectedEntry),
          removalConfirmationAppId, t, requestSessionId !== null, activation);
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
        count.setAttribute("role", "status");
        count.setAttribute("aria-live", "polite");
        count.setAttribute("aria-atomic", "true");
        listHeader.append(titles, count);
        if (activeView === "updates") {
          const updateActions = node(documentObject, "div", "ordax-store-actions");
          const action = makeButton(documentObject, "ordax-store-action",
            t(batchInFlight ? "store.updateAll.requesting" : "store.updateAll.action"),
            "storeUpdateAll", "true");
          action.disabled = updateAll === null || batchInFlight || pendingRequest !== null
            || hasAcceptedUpdateRequest()
            || !snapshot.entries.some((entry) => entry.updatable
              && entry.state === "installed"
              && entry.artifactIdentityVerified && entry.provenanceVerified);
          if (hasAcceptedUpdateRequest()) {
            action.dataset.storeUpdateAllBlocked = "accepted-individual-update";
            action.title = t("store.request.update.accepted");
          }
          updateActions.append(action);
          if (batchInFlight) {
            const cancel = makeButton(documentObject, "ordax-store-action ordax-store-action-secondary",
              t("store.updateAll.cancel"), "storeCancelUpdateAll", "true");
            updateActions.append(cancel);
          }
          listHeader.append(updateActions);
        }
        const grid = node(documentObject, "div", "ordax-store-grid");
        for (const entry of sortStoreEntries(snapshot.entries, localization.getLocale())) {
          appendCard(documentObject, grid, entry, lifecycleRequests,
            requestForEntry(entry),
            t, requestSessionId !== null, activation);
        }
        const filterEmpty = node(documentObject, "div", "ordax-store-filter-empty");
        filterEmpty.dataset.storeFilterEmpty = "true";
        filterEmpty.setAttribute("role", "status");
        const emptyTitle = node(documentObject, "strong", "", t("store.empty.filtered"));
        emptyTitle.dataset.storeEmptyTitle = "true";
        const emptyDescription = node(documentObject, "p", "", t("store.empty.filteredDescription"));
        emptyDescription.dataset.storeEmptyDescription = "true";
        filterEmpty.append(emptyTitle, emptyDescription);
        listing.append(listHeader, grid, filterEmpty);
        main.append(listing);
      }
    }

    const security = node(documentObject, "p", "ordax-store-security", t("store.security.note"));
    security.dataset.storeAuthority = "none";
    main.append(security);
    layout.append(sidebar, main);
    slot.append(layout);
    restoreSectionNavigationScroll(slot, previousNavigationScroll, previousActiveView === activeView);
    refreshResults();
    if (searchField) {
      const restored = slot.querySelector("[data-store-search]");
      restored?.focus?.({ preventScroll: true });
      if (restored && searchSelection && typeof restored.setSelectionRange === "function") {
        restored.setSelectionRange(searchSelection.start, searchSelection.end, searchSelection.direction);
      }
    } else if (previousControlFocus && !restoreStoreControlFocus(slot, previousControlFocus)) {
      // An OS catalog transition may remove or disable the focused action.
      // Move focus to a stable, visible destination rather than losing it.
      const fallback = slot.querySelector("[data-store-back]")
        ?? slot.querySelector('[data-store-view][aria-current="page"]');
      fallback?.focus?.({ preventScroll: true });
    }
  };

  const onInput = (event) => {
    const input = event.target.closest?.("[data-store-search]");
    if (!input || !mountedSlot?.contains(input)) return;
    searchQuery = input.value.slice(0, 160);
    refreshResults();
  };

  const onClick = (event) => {
    if (!mountedSlot) return;
    const openApp = event.target.closest?.("[data-store-open-app]");
    if (openApp && mountedSlot.contains(openApp) && activation !== null) {
      const appId = openApp.dataset.storeOpenApp;
      const entry = snapshot.state === "ready"
        ? snapshot.entries.find((candidate) => candidate.appId === appId)
        : null;
      if (!entry || !storeEntryOpenAvailable(entry)) return;
      activation.publish({ appId, target: null });
      return;
    }
    const cancelUpdateAll = event.target.closest?.("[data-store-cancel-update-all]");
    if (cancelUpdateAll && mountedSlot.contains(cancelUpdateAll) && batchInFlight) {
      updateAll?.cancelPending();
      return;
    }
    const submitUpdateAll = event.target.closest?.("[data-store-update-all]");
    if (submitUpdateAll && mountedSlot.contains(submitUpdateAll)
      && activeView === "updates" && selectedAppId === null
      && !batchInFlight && pendingRequest === null && updateAll !== null
      && snapshot.state === "ready" && !hasAcceptedUpdateRequest()
      && snapshot.entries.some((entry) => entry.state === "installed"
        && entry.updatable && entry.artifactIdentityVerified && entry.provenanceVerified)) {
      batchInFlight = true;
      batchReport = null;
      const generation = ++batchPresentationGeneration;
      render();
      void updateAll.submitAvailableUpdates().then((report) => {
        if (destroyed) return;
        batchInFlight = false;
        // Even when the user navigated away and the visible batch report was
        // discarded, already forwarded requests must not become repeatable.
        recordBatchAcceptedUpdates(report);
        if (generation === batchPresentationGeneration) batchReport = report;
        render();
      }, () => {
        if (destroyed) return;
        batchInFlight = false;
        if (generation === batchPresentationGeneration) {
          batchReport = { state: "failed" };
        }
        render();
      });
      return;
    }
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
      if (viewButton.dataset.storeView !== "updates") {
        updateAll?.cancelPending();
        batchPresentationGeneration += 1;
        batchReport = null;
      }
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
      focusStoreCatalogReturn(previousAppId);
      return;
    }

    const button = event.target.closest?.("[data-store-operation][data-store-app-id]");
    if (!button || !mountedSlot.contains(button) || lifecycleRequests === null || requestSessionId === null || pendingRequest !== null || batchInFlight) return;
    const appId = button.dataset.storeAppId;
    const operation = button.dataset.storeOperation;
    if (!OPERATIONS.has(operation)) return;
    const entry = snapshot.entries.find((candidate) => candidate.appId === appId);
    if (!entry || !operationAllowed(entry, operation)
        || acceptedRequests.has(appId)) return;
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
    const retryScope = JSON.stringify([appId, operation]);
    const candidateSignature = lifecycleCandidateSignature(entry, operation);
    const receipt = uncertainRequestIds.get(retryScope);
    const retainedRequestId = receipt?.candidateSignature === candidateSignature ? receipt.requestId : null;
    if (retainedRequestId === null) requestOrdinal += 1;
    const request = validateAppLifecycleRequest({
      schema: APP_LIFECYCLE_REQUEST_SCHEMA,
      requestId: retainedRequestId ?? "store:" + operation + ":" + appId + ":" + requestSessionId + ":" + requestOrdinal,
      appId,
      operation,
      source: "store",
      authority: "none",
    });
    uncertainRequestIds.set(retryScope, Object.freeze({
      appId, operation, candidateSignature, requestId: request.requestId,
    }));
    pendingRequest = Object.freeze({
      appId,
      operation,
      candidateSignature,
      requestId: request.requestId,
      phase: "requesting",
    });
    const isCurrentRequest = () => !destroyed
      && pendingRequest?.requestId === request.requestId
      && pendingRequest?.candidateSignature === candidateSignature
      && sameLifecycleCandidate(snapshot, appId, operation, candidateSignature);
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
        // Only a validated, request-correlated acceptance or rejection ends
        // the uncertain retry. Request acceptance is not installation success.
        if (uncertainRequestIds.get(retryScope)?.requestId === request.requestId) {
          uncertainRequestIds.delete(retryScope);
        }
        requestMessageId = "store.request." + operation + "." + result.state;
        requestReason = result.state === "rejected" ? result.reason : null;
        if (result.state === "accepted") {
          acceptedRequests.set(appId, Object.freeze({
            appId, operation, candidateSignature,
            requestId: request.requestId, phase: "accepted",
          }));
          reconcileAcceptedRequest();
        }
        pendingRequest = null;
        render();
      })
      .catch(() => {
        if (!isCurrentRequest()) return;
        // No authoritative outcome arrived; keep the pre-delegation receipt.
        pendingRequest = null;
        requestMessageId = "store.request." + operation + ".failed";
        requestReason = null;
        render();
      });
  };

  const focusStoreCatalogReturn = (appId) => {
    if (!mountedSlot) return;
    const previous = Array.from(mountedSlot.querySelectorAll("[data-store-details]"))
      .find(button => button.dataset.storeDetails === appId
        && !button.disabled && !button.hidden && !button.closest("[hidden]"));
    const fallback = mountedSlot.querySelector("[data-store-search]")
      ?? mountedSlot.querySelector('[data-store-view][aria-current="page"]');
    // A catalog update can remove or filter the original details button.
    // Never send keyboard focus into a hidden or detached card.
    (previous ?? fallback)?.focus?.({ preventScroll: true });
  };

  const handleStoreCatalogKeyboard = (event) => {
    if (!mountedSlot?.contains(event.target) || selectedAppId !== null
      || snapshot.state !== "ready" || activeView === "models") return false;
    const search = mountedSlot.querySelector("[data-store-search]");
    const detailButton = event.target.closest?.("[data-store-details]");
    const inSearch = event.target === search;
    if (!inSearch && !detailButton) return false;
    const options = Array.from(mountedSlot.querySelectorAll("[data-store-details]"))
      .filter(button => !button.disabled && !button.hidden && !button.closest("[hidden]"));
    if (options.length === 0) return false;
    if (inSearch && event.key === "Enter") {
      event.preventDefault();
      options[0].click();
      return true;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
    // Keep Home/End as native caret movement in the search field.
    if (inSearch && (event.key === "Home" || event.key === "End")) return false;
    const current = options.indexOf(detailButton);
    const index = event.key === "Home" ? 0
      : event.key === "End" ? options.length - 1
      : event.key === "ArrowUp"
        ? current < 0 ? options.length - 1 : (current - 1 + options.length) % options.length
        : current < 0 ? 0 : (current + 1) % options.length;
    event.preventDefault();
    options[index].focus({ preventScroll: true });
    return true;
  };

  const onKeyDown = (event) => {
    if (handleStoreCatalogKeyboard(event)) return;
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
      focusStoreCatalogReturn(previousAppId);
      event.preventDefault();
    }
  };

  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", onKeyDown);
  const unsubscribeCatalog = catalog.subscribe((next) => {
    const verified = validateAppStoreCatalogSnapshot(next);
    const fingerprint = JSON.stringify(verified);
    // Replayed catalog observations do not change cards or lifecycle receipts.
    if (fingerprint === catalogFingerprint) return;
    catalogFingerprint = fingerprint;
    // Unrelated app updates must not cancel or reidentify another app's
    // in-flight request. The canonical OS projection is checked per target.
    if (verified.state === "ready") {
      for (const [scope, receipt] of uncertainRequestIds) {
        if (!sameLifecycleCandidate(verified, receipt.appId,
          receipt.operation, receipt.candidateSignature)) {
          uncertainRequestIds.delete(scope);
        }
      }
    }
    if (pendingRequest !== null && !sameLifecycleCandidate(verified,
      pendingRequest.appId, pendingRequest.operation, pendingRequest.candidateSignature)) {
      pendingRequest = null;
      requestMessageId = null;
      requestReason = null;
    }
    if (removalConfirmationAppId !== null
      && !verified.entries.some((entry) =>
        entry.appId === removalConfirmationAppId && entry.removable)) {
      removalConfirmationAppId = null;
    }
    if (verified.state !== "ready") {
      // Fail closed without interpreting temporary catalog unavailability
      // as proof that any delegated lifecycle request was rejected.
      removalConfirmationAppId = null;
      updateAll?.cancelPending();
      batchPresentationGeneration += 1;
      batchReport = null;
    }
    // Update-all already revalidates each candidate at the OS-owned port;
    // do not cancel its queue when the preceding app advances in the catalog.
    snapshot = verified;
    reconcileAcceptedRequest();
    render();
  });
  const unsubscribeRender = lifecycle.subscribeRender(render);
  const unsubscribeLocalization = localization.subscribe(render);
  const unsubscribeActivation = activation?.subscribe((next) => {
    if (next.appId !== "store" || !VIEWS.includes(next.target)) return;
    if (next.target !== "updates") {
      updateAll?.cancelPending();
      batchPresentationGeneration += 1;
      batchReport = null;
    }
    activeView = next.target;
    selectedAppId = null;
    removalConfirmationAppId = null;
    render();
    if (activeView === "models" && modelReadState === "idle") {
      void refreshModelResources();
    }
  });
  render();
  if (activeView === "models" && modelReadState === "idle") {
    void refreshModelResources();
  }

  return Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true;
      updateAll?.cancelPending();
      batchPresentationGeneration += 1;
      modelReadOrdinal += 1;
      modelReadAbort?.abort();
      modelReadAbort = null;
      unsubscribeCatalog?.();
      unsubscribeActivation?.();
      unsubscribeRender?.();
      unsubscribeLocalization?.();
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("keydown", onKeyDown);
      acceptedRequests.clear();
      mountedSlot = null;
    },
  });
}
