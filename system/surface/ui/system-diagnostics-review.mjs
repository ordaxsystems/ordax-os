import {
  DIAGNOSTIC_REVIEW_CONTROLLER_SCHEMA,
  DIAGNOSTIC_REVIEW_CONTROLLER_STATE_SCHEMA,
} from "../../services/diagnostics/controller.mjs";
import { assertLocalizationPort } from "../../contracts/localization.mjs";
import { assertSurfaceRenderLifecycle } from "../../contracts/surface-render-lifecycle.mjs";
import { assertPreferenceRuntimePort } from "../../contracts/preference-runtime.mjs";
import { resolveRegionalTimeZone } from "../../services/preferences/regional.mjs";

const CONTROLLER_PHASES = new Set(["idle", "preparing", "ready", "copying", "exporting"]);

const SOURCE_MESSAGE_IDS = Object.freeze({
  surface: "system.diagnostics.review.source.surface",
  update: "system.diagnostics.review.source.update",
  metrics: "system.diagnostics.review.source.metrics",
  history: "system.diagnostics.review.source.history",
  journal: "system.diagnostics.review.source.journal",
});

const SOURCE_STATUS_MESSAGE_IDS = Object.freeze({
  included: "system.diagnostics.review.sourceStatus.included",
  unavailable: "system.diagnostics.review.sourceStatus.unavailable",
  failed: "system.diagnostics.review.sourceStatus.failed",
});

const FAILURE_MESSAGE_IDS = Object.freeze({
  "surface-read-failed": "system.diagnostics.review.failure.surface-read-failed",
  "update-read-failed": "system.diagnostics.review.failure.update-read-failed",
  "metrics-read-failed": "system.diagnostics.review.failure.metrics-read-failed",
  "history-read-failed": "system.diagnostics.review.failure.history-read-failed",
  "journal-read-failed": "system.diagnostics.review.failure.journal-read-failed",
});

const LAST_RESULT_MESSAGE_IDS = Object.freeze({
  "review-prepare-failed": "system.diagnostics.review.result.review-prepare-failed",
  "copy-unavailable": "system.diagnostics.review.result.copy-unavailable",
  "copy-in-progress": "system.diagnostics.review.result.copy-in-progress",
  "copy-failed": "system.diagnostics.review.result.copy-failed",
  "export-unavailable": "system.diagnostics.review.result.export-unavailable",
  "export-in-progress": "system.diagnostics.review.result.export-in-progress",
  "export-failed": "system.diagnostics.review.result.export-failed",
});

const SEVERITY_MESSAGE_IDS = Object.freeze({
  debug: "system.diagnostics.review.severity.debug",
  info: "system.diagnostics.review.severity.info",
  warning: "system.diagnostics.review.severity.warning",
  error: "system.diagnostics.review.severity.error",
  critical: "system.diagnostics.review.severity.critical",
});

const UPDATE_STATUS_MESSAGE_IDS = Object.freeze({
  running: "system.diagnostics.review.update.status.running",
  applied: "system.diagnostics.review.update.status.applied",
  updating: "system.diagnostics.review.update.status.updating",
  "network-error": "system.diagnostics.review.update.status.network-error",
  "remote-error": "system.diagnostics.review.update.status.remote-error",
  "pull-error": "system.diagnostics.review.update.status.pull-error",
  "rolled-back": "system.diagnostics.review.update.status.rolled-back",
  rejected: "system.diagnostics.review.update.status.rejected",
  pinned: "system.diagnostics.review.update.status.pinned",
  disabled: "system.diagnostics.review.update.status.disabled",
  unavailable: "system.diagnostics.review.update.status.unavailable",
});

const UPDATE_PHASE_MESSAGE_IDS = Object.freeze({
  checking: "system.diagnostics.review.update.phase.checking",
  fetching: "system.diagnostics.review.update.phase.fetching",
  validating: "system.diagnostics.review.update.phase.validating",
  activating: "system.diagnostics.review.update.phase.activating",
  "health-wait": "system.diagnostics.review.update.phase.health-wait",
  rollback: "system.diagnostics.review.update.phase.rollback",
  blocked: "system.diagnostics.review.update.phase.blocked",
  error: "system.diagnostics.review.update.phase.error",
  idle: "system.diagnostics.review.update.phase.idle",
});

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value);
  return Object.freeze(value);
}

function requireControllerState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Diagnostic review UI requires a controller state object");
  }
  if (value.schema !== DIAGNOSTIC_REVIEW_CONTROLLER_STATE_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic review controller state: ${String(value.schema)}`);
  }
  if (!CONTROLLER_PHASES.has(value.phase)) {
    throw new TypeError(`Unsupported diagnostic review controller phase: ${String(value.phase)}`);
  }
  if (typeof value.exportAvailable !== "boolean") {
    throw new TypeError("Diagnostic review controller exportAvailable must be boolean");
  }
  if (typeof value.copyAvailable !== "boolean") {
    throw new TypeError("Diagnostic review controller copyAvailable must be boolean");
  }
  if (
    (value.phase === "ready" || value.phase === "copying" || value.phase === "exporting")
    && !value.document
  ) {
    throw new TypeError("Ready/copying/exporting diagnostic review state requires a prepared document");
  }
  if (value.phase === "preparing" && value.document !== null) {
    throw new TypeError("Preparing diagnostic review state cannot expose a stale document");
  }
  return value;
}

function assertDiagnosticReviewController(controller) {
  if (!controller || typeof controller !== "object") {
    throw new TypeError("Diagnostic review UI requires a controller");
  }
  if (controller.schema !== DIAGNOSTIC_REVIEW_CONTROLLER_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic review controller: ${String(controller.schema)}`);
  }
  for (const method of [
    "getSnapshot",
    "subscribe",
    "prepare",
    "copyPreparedSummary",
    "exportPrepared",
  ]) {
    if (typeof controller[method] !== "function") {
      throw new TypeError(`Diagnostic review controller must implement ${method}()`);
    }
  }
  requireControllerState(controller.getSnapshot());
  return controller;
}

function displayLocale(localization) {
  return localization.getLocale() === "en-US" ? "en-US" : "pt-BR";
}

function formatTimestamp(value, localization, timeZone) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return localization.translate("system.diagnostics.review.time.unknown");
  }
  return new Intl.DateTimeFormat(displayLocale(localization), {
    timeZone,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatBytes(bytes, localization) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = unit >= 3 && value < 10 ? 1 : 0;
  const formatted = new Intl.NumberFormat(displayLocale(localization), {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
  return `${formatted} ${units[unit]}`;
}

function translatedEnum(localization, map, value, fallbackId) {
  const messageId = map[value];
  return messageId
    ? localization.translate(messageId)
    : localization.translate(fallbackId, { value: String(value ?? "") });
}

function sourcePresentation(entry, localization) {
  const t = localization.translate;
  const labelId = SOURCE_MESSAGE_IDS[entry.id];
  const statusId = SOURCE_STATUS_MESSAGE_IDS[entry.status];
  const failureId = entry.failureCode ? FAILURE_MESSAGE_IDS[entry.failureCode] : null;
  return freeze({
    id: entry.id,
    label: labelId ? t(labelId) : entry.id,
    status: entry.status,
    statusLabel: statusId ? t(statusId) : entry.status,
    detail: failureId
      ? t(failureId)
      : entry.failureCode
        ? entry.failureCode
        : entry.status === "unavailable"
          ? t("system.diagnostics.review.sourceDetail.unavailable")
          : t("system.diagnostics.review.sourceDetail.included"),
  });
}

function freshnessPresentation(freshness, localization) {
  const t = localization.translate;
  if (freshness === null || freshness === undefined) {
    return freeze({
      state: "unavailable",
      label: t("system.diagnostics.review.freshness.unavailable"),
      detail: t("system.diagnostics.review.freshness.unavailableDetail"),
    });
  }
  if (freshness.state === "fresh") {
    return freeze({
      state: "fresh",
      label: t("system.diagnostics.review.freshness.fresh"),
      detail: t("system.diagnostics.review.freshness.freshDetail", {
        age: freshness.ageSeconds,
        max: freshness.maxAgeSeconds,
      }),
    });
  }
  if (freshness.state === "stale") {
    return freeze({
      state: "stale",
      label: t("system.diagnostics.review.freshness.stale"),
      detail: t("system.diagnostics.review.freshness.staleDetail", {
        age: freshness.ageSeconds,
        max: freshness.maxAgeSeconds,
      }),
    });
  }
  const reasonId = freshness.reason === "clock-skew"
    ? "system.diagnostics.review.freshness.clockSkew"
    : freshness.reason === "invalid-checked-at"
      ? "system.diagnostics.review.freshness.invalidCheckedAt"
      : "system.diagnostics.review.freshness.insufficient";
  return freeze({
    state: "unknown",
    label: t("system.diagnostics.review.freshness.unknown"),
    detail: t(reasonId),
  });
}

function persistencePresentation(journal, localization) {
  const t = localization.translate;
  if (!journal) {
    return freeze({
      state: "unavailable",
      label: t("system.diagnostics.review.persistence.unavailable"),
      detail: t("system.diagnostics.review.persistence.unavailableDetail"),
    });
  }
  if (journal.persistenceStatus === "degraded") {
    const reasonId = journal.persistenceErrorCode === "load-failed"
      ? "system.diagnostics.review.persistence.loadFailed"
      : "system.diagnostics.review.persistence.writeFailed";
    return freeze({
      state: "degraded",
      label: t("system.diagnostics.review.persistence.degraded"),
      detail: t(reasonId),
    });
  }
  if (journal.persistenceStatus === "session") {
    return freeze({
      state: "session",
      label: t("system.diagnostics.review.persistence.session"),
      detail: t("system.diagnostics.review.persistence.sessionDetail"),
    });
  }
  return freeze({
    state: "device",
    label: t("system.diagnostics.review.persistence.device"),
    detail: t("system.diagnostics.review.persistence.deviceDetail", {
      limit: journal.retentionLimit,
    }),
  });
}

function actionPresentation(snapshot, localization) {
  const t = localization.translate;
  if (snapshot.phase === "preparing") {
    return freeze({ kind: "progress", text: t("system.diagnostics.review.action.preparing") });
  }
  if (snapshot.phase === "copying") {
    return freeze({ kind: "progress", text: t("system.diagnostics.review.action.copying") });
  }
  if (snapshot.phase === "exporting") {
    return freeze({ kind: "progress", text: t("system.diagnostics.review.action.exporting") });
  }
  const last = snapshot.lastResult;
  if (!last) return null;
  if (last.action === "prepare" && last.status === "ready") {
    return freeze({ kind: "success", text: t("system.diagnostics.review.action.prepared") });
  }
  if (last.action === "copy" && last.status === "copied") {
    return freeze({ kind: "success", text: t("system.diagnostics.review.action.copied") });
  }
  if (last.action === "export" && last.status === "saved") {
    return freeze({ kind: "success", text: t("system.diagnostics.review.action.saved") });
  }
  if (last.action === "export" && last.status === "cancelled") {
    return freeze({ kind: "neutral", text: t("system.diagnostics.review.action.cancelled") });
  }
  if (last.code === "review-not-prepared") {
    return freeze({
      kind: "warning",
      text: t(last.action === "copy"
        ? "system.diagnostics.review.action.notPreparedCopy"
        : "system.diagnostics.review.action.notPreparedExport"),
    });
  }
  const messageId = LAST_RESULT_MESSAGE_IDS[last.code];
  return freeze({
    kind: "warning",
    text: t(messageId ?? "system.diagnostics.review.action.defaultFailure"),
  });
}

function eventPresentation(event, localization, timeZone) {
  const messageId = SEVERITY_MESSAGE_IDS[event.severity];
  return freeze({
    severity: event.severity,
    severityLabel: messageId ? localization.translate(messageId) : event.severity,
    occurredAt: formatTimestamp(event.occurredAt, localization, timeZone),
    component: event.component,
    eventCode: event.eventCode,
    correlationKey: event.correlationKey,
    summary: event.message || `${event.status} · ${event.phase}`,
  });
}

export function createDiagnosticReviewPresentation(
  snapshotValue, localizationValue, timeZone = resolveRegionalTimeZone(),
) {
  const snapshot = requireControllerState(snapshotValue);
  const localization = assertLocalizationPort(localizationValue);
  const t = localization.translate;
  const document = snapshot.document;
  const review = document?.review ?? null;
  const report = review?.report ?? null;
  const sources = review
    ? review.manifest.sources.map((entry) => sourcePresentation(entry, localization))
    : [];
  const journal = report?.journal ?? null;
  const events = journal
    ? [...journal.events].reverse().map((event) => eventPresentation(event, localization, timeZone))
    : [];

  const update = report?.update
    ? freeze({
      delivery: report.update.deliveryNumber
        ? t("system.diagnostics.review.update.delivery", { value: report.update.deliveryNumber })
        : t("system.diagnostics.review.update.deliveryUnknown"),
      status: translatedEnum(
        localization,
        UPDATE_STATUS_MESSAGE_IDS,
        report.update.status,
        "system.diagnostics.review.update.status.unknown",
      ),
      phase: translatedEnum(
        localization,
        UPDATE_PHASE_MESSAGE_IDS,
        report.update.phase,
        "system.diagnostics.review.update.phase.unknown",
      ),
      checkedAt: report.update.checkedAt && report.update.checkedAt !== "unknown"
        ? formatTimestamp(report.update.checkedAt, localization, timeZone)
        : t("system.diagnostics.review.update.checkedUnknown"),
      lastError: report.update.lastError || "",
    })
    : null;

  const metrics = report?.metrics
    ? freeze({
      memory: t("system.diagnostics.review.metrics.memory", {
        available: formatBytes(report.metrics.memoryAvailableBytes, localization),
        total: formatBytes(report.metrics.memoryTotalBytes, localization),
      }),
      storage: t("system.diagnostics.review.metrics.storage", {
        free: formatBytes(report.metrics.userStorageFreeBytes, localization),
        total: formatBytes(report.metrics.userStorageTotalBytes, localization),
      }),
      uptimeSeconds: report.metrics.uptimeSeconds,
    })
    : null;

  const history = report?.history
    ? freeze({
      releaseCount: report.history.releaseCount,
      applicationCount: report.history.applicationCount,
    })
    : null;

  return freeze({
    phase: snapshot.phase,
    exportAvailable: snapshot.exportAvailable,
    copyAvailable: snapshot.copyAvailable,
    action: actionPresentation(snapshot, localization),
    prepare: freeze({
      label: t(snapshot.phase === "preparing"
        ? "system.diagnostics.review.button.preparing"
        : "system.diagnostics.review.button.prepare"),
      disabled: snapshot.phase === "preparing"
        || snapshot.phase === "copying"
        || snapshot.phase === "exporting",
    }),
    copy: freeze({
      label: t(snapshot.phase === "copying"
        ? "system.diagnostics.review.button.copying"
        : snapshot.copyAvailable
          ? "system.diagnostics.review.button.copy"
          : "system.diagnostics.review.button.copyUnavailable"),
      disabled: snapshot.phase !== "ready" || !snapshot.copyAvailable,
      visible: document !== null,
    }),
    export: freeze({
      label: t(snapshot.phase === "exporting"
        ? "system.diagnostics.review.button.saving"
        : snapshot.exportAvailable
          ? "system.diagnostics.review.button.save"
          : "system.diagnostics.review.button.saveUnavailable"),
      disabled: snapshot.phase !== "ready" || !snapshot.exportAvailable,
      visible: document !== null,
    }),
    review: review
      ? freeze({
        generatedAt: formatTimestamp(review.generatedAt, localization, timeZone),
        fileName: document.fileName,
        hasFailures: review.manifest.hasFailures,
        sources: freeze(sources),
        freshness: freshnessPresentation(review.observations.updateFreshness, localization),
        update,
        metrics,
        history,
        persistence: persistencePresentation(journal, localization),
        eventCount: journal?.eventCount ?? null,
        events: freeze(events),
      })
      : null,
  });
}

function node(documentObject, tag, className, text) {
  const element = documentObject.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendFact(documentObject, list, label, value) {
  const item = node(documentObject, "div", "ordax-system-fact");
  item.append(
    node(documentObject, "dt", "", label),
    node(documentObject, "dd", "", value),
  );
  list.append(item);
}

function renderReview(documentObject, container, presentation, localization) {
  const t = localization.translate;
  const heading = node(documentObject, "div", "ordax-system-section-heading");
  const headingCopy = node(documentObject, "div");
  headingCopy.append(
    node(documentObject, "span", "ordax-system-section-kicker", t("system.diagnostics.review.kicker")),
    node(documentObject, "h4", "ordax-system-section-title", t("system.diagnostics.review.title")),
  );
  const actions = node(documentObject, "div", "ordax-system-actions");
  const prepare = node(documentObject, "button", "ordax-system-action", presentation.prepare.label);
  prepare.type = "button";
  prepare.dataset.systemDiagnosticsPrepare = "";
  prepare.disabled = presentation.prepare.disabled;
  actions.append(prepare);
  if (presentation.copy.visible) {
    const copyButton = node(documentObject, "button", "ordax-system-action", presentation.copy.label);
    copyButton.type = "button";
    copyButton.dataset.systemDiagnosticsCopy = "";
    copyButton.disabled = presentation.copy.disabled;
    actions.append(copyButton);
  }
  if (presentation.export.visible) {
    const exportButton = node(documentObject, "button", "ordax-system-action", presentation.export.label);
    exportButton.type = "button";
    exportButton.dataset.systemDiagnosticsExport = "";
    exportButton.disabled = presentation.export.disabled;
    actions.append(exportButton);
  }
  heading.append(headingCopy, actions);
  container.append(heading);

  container.append(
    node(documentObject, "p", "ordax-system-section-copy", t("system.diagnostics.review.policy")),
  );

  if (presentation.action) {
    const status = node(
      documentObject,
      "p",
      presentation.action.kind === "warning" ? "ordax-system-warning" : "ordax-system-message",
      presentation.action.text,
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    container.append(status);
  }

  if (!presentation.review) {
    container.append(
      node(documentObject, "p", "ordax-system-placeholder", t("system.diagnostics.review.empty")),
    );
    return;
  }

  const review = presentation.review;
  if (review.hasFailures) {
    container.append(
      node(documentObject, "p", "ordax-system-warning", t("system.diagnostics.review.partial")),
    );
  }

  const metadata = node(documentObject, "dl", "ordax-system-facts");
  appendFact(documentObject, metadata, t("system.diagnostics.review.fact.preparedAt"), review.generatedAt);
  appendFact(documentObject, metadata, t("system.diagnostics.review.fact.file"), review.fileName);
  appendFact(documentObject, metadata, t("system.diagnostics.review.fact.freshness"), review.freshness.label);
  appendFact(documentObject, metadata, t("system.diagnostics.review.fact.persistence"), review.persistence.label);
  container.append(metadata);

  const freshnessDetail = node(
    documentObject,
    "p",
    review.freshness.state === "stale" || review.freshness.state === "unknown"
      ? "ordax-system-warning"
      : "ordax-system-section-copy",
    review.freshness.detail,
  );
  container.append(freshnessDetail);

  container.append(
    node(
      documentObject,
      "p",
      review.persistence.state === "degraded" || review.persistence.state === "session"
        ? "ordax-system-warning"
        : "ordax-system-section-copy",
      review.persistence.detail,
    ),
  );

  const sourceSection = node(documentObject, "div", "ordax-system-history");
  sourceSection.append(
    node(documentObject, "h5", "ordax-system-history-title", t("system.diagnostics.review.sources")),
  );
  for (const source of review.sources) {
    const item = node(documentObject, "article", "ordax-system-history-item");
    item.dataset.state = source.status;
    item.append(
      node(documentObject, "strong", "", `${source.label} · ${source.statusLabel}`),
      node(documentObject, "small", "", source.detail),
    );
    sourceSection.append(item);
  }
  container.append(sourceSection);

  if (review.update) {
    const updateFacts = node(documentObject, "dl", "ordax-system-facts");
    appendFact(documentObject, updateFacts, t("system.diagnostics.review.update.fact.delivery"), review.update.delivery);
    appendFact(documentObject, updateFacts, t("system.diagnostics.review.update.fact.status"), review.update.status);
    appendFact(documentObject, updateFacts, t("system.diagnostics.review.update.fact.phase"), review.update.phase);
    appendFact(documentObject, updateFacts, t("system.diagnostics.review.update.fact.checkedAt"), review.update.checkedAt);
    if (review.update.lastError) {
      appendFact(
        documentObject,
        updateFacts,
        t("system.diagnostics.review.update.fact.lastDiagnostic"),
        review.update.lastError,
      );
    }
    container.append(updateFacts);
  }

  if (review.metrics || review.history) {
    const localFacts = node(documentObject, "dl", "ordax-system-facts");
    if (review.metrics) {
      appendFact(documentObject, localFacts, t("system.diagnostics.review.metrics.fact.memory"), review.metrics.memory);
      appendFact(documentObject, localFacts, t("system.diagnostics.review.metrics.fact.storage"), review.metrics.storage);
    }
    if (review.history) {
      appendFact(
        documentObject,
        localFacts,
        t("system.diagnostics.review.history.fact.deliveries"),
        String(review.history.releaseCount),
      );
      appendFact(
        documentObject,
        localFacts,
        t("system.diagnostics.review.history.fact.applications"),
        String(review.history.applicationCount),
      );
    }
    container.append(localFacts);
  }

  const eventSection = node(documentObject, "div", "ordax-system-history");
  eventSection.append(
    node(documentObject, "h5", "ordax-system-history-title", t("system.diagnostics.review.events")),
  );
  if (review.eventCount === null) {
    eventSection.append(
      node(documentObject, "p", "ordax-system-placeholder", t("system.diagnostics.review.events.unavailable")),
    );
  } else if (review.events.length === 0) {
    eventSection.append(
      node(documentObject, "p", "ordax-system-placeholder", t("system.diagnostics.review.events.empty")),
    );
  } else {
    for (const event of review.events) {
      const item = node(documentObject, "article", "ordax-system-history-item");
      item.dataset.state = event.severity;
      item.append(
        node(documentObject, "strong", "", `${event.severityLabel} · ${event.component}`),
        node(documentObject, "span", "", event.occurredAt),
        node(documentObject, "small", "", event.summary),
        node(documentObject, "small", "", `${event.eventCode} · ${event.correlationKey}`),
      );
      eventSection.append(item);
    }
  }
  container.append(eventSection);
}

export function mountSystemDiagnosticsReview(container, controllerValue, surfaceLifecycle) {
  if (
    !container
    || typeof container !== "object"
    || typeof container.replaceChildren !== "function"
    || typeof container.addEventListener !== "function"
    || !container.ownerDocument
  ) {
    throw new TypeError("System diagnostics review requires a DOM container");
  }
  const controller = assertDiagnosticReviewController(controllerValue);
  const lifecycle = assertSurfaceRenderLifecycle(surfaceLifecycle);
  const preferences = lifecycle.preferences == null
    ? null : assertPreferenceRuntimePort(lifecycle.preferences);
  const localization = lifecycle.localization;
  const documentObject = container.ownerDocument;
  let destroyed = false;

  const render = () => {
    if (destroyed) return;
    // The controller is the authority; delayed events only request a fresh
    // projection and must not resurrect an older prepared diagnostic report.
    const stateValue = controller.getSnapshot();
    const focused = documentObject.activeElement?.dataset?.systemDiagnosticsPrepare !== undefined
      ? "prepare"
      : documentObject.activeElement?.dataset?.systemDiagnosticsCopy !== undefined
        ? "copy"
        : documentObject.activeElement?.dataset?.systemDiagnosticsExport !== undefined
          ? "export"
          : null;
    const presentation = createDiagnosticReviewPresentation(
      stateValue, localization, resolveRegionalTimeZone(preferences?.getSnapshot() ?? {}),
    );
    const section = node(documentObject, "section", "ordax-system-section");
    section.dataset.systemDiagnosticsReview = "";
    renderReview(documentObject, section, presentation, localization);
    container.replaceChildren(section);

    if (focused) {
      const selector = focused === "prepare"
        ? "[data-system-diagnostics-prepare]"
        : focused === "copy"
          ? "[data-system-diagnostics-copy]"
          : "[data-system-diagnostics-export]";
      const target = section.querySelector(selector);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  };

  const click = (event) => {
    if (destroyed) return;
    const target = event.target?.closest?.("button");
    if (!target || !container.contains(target) || target.disabled) return;
    // A button can outlive a state transition until the next render.
    // Recheck the existing presentation gates before any copy/export action.
    const current = createDiagnosticReviewPresentation(
      controller.getSnapshot(), localization,
      resolveRegionalTimeZone(preferences?.getSnapshot() ?? {}),
    );
    if (target.dataset.systemDiagnosticsPrepare !== undefined) {
      if (current.prepare.disabled) { render(); return; }
      void controller.prepare();
    } else if (target.dataset.systemDiagnosticsCopy !== undefined) {
      if (!current.copy.visible || current.copy.disabled) { render(); return; }
      void controller.copyPreparedSummary();
    } else if (target.dataset.systemDiagnosticsExport !== undefined) {
      if (!current.export.visible || current.export.disabled) { render(); return; }
      void controller.exportPrepared();
    }
  };

  container.addEventListener("click", click);
  render();
  const unsubscribeController = controller.subscribe(() => render());
  const rerender = () => {
    if (!destroyed) render();
  };
  const unsubscribeLocalization = localization.subscribe(rerender);
  const unsubscribePreferences = preferences?.subscribe(rerender);

  return Object.freeze({
    dispose() {
      if (destroyed) return;
      destroyed = true;
      unsubscribeController();
      unsubscribeLocalization();
      unsubscribePreferences?.();
      container.removeEventListener("click", click);
      container.replaceChildren();
    },
  });
}
