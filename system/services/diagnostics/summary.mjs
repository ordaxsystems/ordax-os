import {
  DIAGNOSTIC_SUMMARY_SCHEMA,
  validateDiagnosticSummary,
} from "../../contracts/diagnostic-copy.mjs";
import {
  resolveDiagnosticSummaryLocale,
  translateDiagnosticSummaryMessage,
} from "../i18n/catalog/diagnostic-summary.mjs";
import { DIAGNOSTIC_REPORT_SCHEMA } from "./report.mjs";
import { DIAGNOSTIC_REVIEW_SCHEMA } from "./review.mjs";
import { redactDiagnosticText } from "./redaction.mjs";

const SOURCE_IDS = Object.freeze(["surface", "update", "metrics", "history", "journal"]);
const SOURCE_ID_SET = new Set(SOURCE_IDS);
const SOURCE_STATUS_SET = new Set(["included", "unavailable", "failed"]);
const FRESHNESS_STATES = new Set(["fresh", "stale", "unknown"]);
const MAX_SUMMARY_EVENTS = 10;

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function safeText(value) {
  return redactDiagnosticText(value === null || value === undefined ? "" : String(value));
}

function safeCode(value, label, { allowEmpty = true } = {}) {
  if (value === "" && allowEmpty) return "";
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(value)) {
    throw new TypeError(`${label} must be a bounded stable code`);
  }
  return value;
}

function safeCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function safeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

function formatBytes(value) {
  const bytes = safeNumber(value, "Diagnostic byte count");
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  const precision = unit >= 3 && amount < 10 ? 1 : 0;
  return `${amount.toFixed(precision)} ${units[unit]}`;
}

function validateReviewDocument(document) {
  const root = asObject(document, "Diagnostic review document");
  const review = asObject(root.review, "Diagnostic review");
  if (review.schema !== DIAGNOSTIC_REVIEW_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic review schema: ${String(review.schema)}`);
  }
  if (
    typeof review.generatedAt !== "string"
    || review.generatedAt.length === 0
    || review.generatedAt.length > 64
    || Number.isNaN(Date.parse(review.generatedAt))
  ) {
    throw new TypeError("Diagnostic review generatedAt must be a bounded valid timestamp");
  }
  if (review.scope !== "explicit-local-review") {
    throw new TypeError("Diagnostic review scope must be explicit-local-review");
  }

  const manifest = asObject(review.manifest, "Diagnostic review manifest");
  if (!Array.isArray(manifest.sources) || manifest.sources.length !== SOURCE_IDS.length) {
    throw new TypeError("Diagnostic review source manifest must contain every canonical source");
  }
  const sourceEntries = new Map();
  for (const entryValue of manifest.sources) {
    const entry = asObject(entryValue, "Diagnostic review source");
    if (!SOURCE_ID_SET.has(entry.id) || sourceEntries.has(entry.id)) {
      throw new TypeError("Diagnostic review source manifest contains an invalid or duplicate source");
    }
    if (!SOURCE_STATUS_SET.has(entry.status)) {
      throw new TypeError("Diagnostic review source has an unsupported status");
    }
    const failureCode = safeCode(entry.failureCode ?? "", "Diagnostic review source failureCode");
    if ((entry.status === "failed") !== (failureCode.length > 0)) {
      throw new TypeError("Diagnostic review source failureCode must match failed status");
    }
    sourceEntries.set(entry.id, entry);
  }

  const observations = asObject(review.observations, "Diagnostic review observations");
  if (observations.updateFreshness !== null) {
    const freshness = asObject(observations.updateFreshness, "Diagnostic update freshness");
    if (!FRESHNESS_STATES.has(freshness.state)) {
      throw new TypeError("Diagnostic update freshness has an unsupported state");
    }
  }

  const report = asObject(review.report, "Diagnostic report");
  if (report.schema !== DIAGNOSTIC_REPORT_SCHEMA) {
    throw new TypeError(`Unsupported diagnostic report schema: ${String(report.schema)}`);
  }
  if (report.generatedAt !== review.generatedAt) {
    throw new TypeError("Diagnostic review and report timestamps must match");
  }

  for (const [sourceId, reportField] of [
    ["update", "update"],
    ["metrics", "metrics"],
    ["history", "history"],
    ["journal", "journal"],
  ]) {
    const included = sourceEntries.get(sourceId).status === "included";
    const hasReportValue = report[reportField] !== null && report[reportField] !== undefined;
    if (included !== hasReportValue) {
      throw new TypeError(`Diagnostic review source ${sourceId} contradicts report content`);
    }
  }
  if (report.update === null && observations.updateFreshness !== null) {
    throw new TypeError("Diagnostic update freshness requires an included update observation");
  }

  return review;
}

function sourceLines(review, t) {
  const byId = new Map(review.manifest.sources.map((entry) => [entry.id, entry]));
  return SOURCE_IDS.map((sourceId) => {
    const entry = byId.get(sourceId);
    const suffix = entry.failureCode ? ` (${safeCode(entry.failureCode, "failureCode")})` : "";
    return `- ${t(`diagnostic.summary.source.${sourceId}`)}: ${t(`diagnostic.summary.status.${entry.status}`)}${suffix}`;
  });
}

function updateLines(review, locale, t) {
  const report = review.report;
  if (report.update === null) return [t("diagnostic.summary.update.unavailable")];

  const update = asObject(report.update, "Diagnostic report update");
  const lines = [
    t("diagnostic.summary.update.line", {
      delivery: safeText(update.deliveryNumber),
      status: safeText(update.status),
      phase: safeText(update.phase),
      applyMode: safeText(update.applyMode),
    }),
    t("diagnostic.summary.update.sha", {
      value: safeText(update.sourceSha) || t("diagnostic.summary.notReported"),
    }),
  ];
  if (update.runtimeSurfaceSha) {
    lines.push(t("diagnostic.summary.update.runtimeSurfaceSha", { value: safeText(update.runtimeSurfaceSha) }));
  }
  if (update.targetSha) {
    lines.push(t("diagnostic.summary.update.targetSha", { value: safeText(update.targetSha) }));
  }
  if (update.checkedAt) {
    lines.push(t("diagnostic.summary.update.checkedAt", { value: safeText(update.checkedAt) }));
  }
  if (update.lastError) {
    lines.push(t("diagnostic.summary.update.lastError", { value: safeText(update.lastError) }));
  }

  const freshness = review.observations.updateFreshness;
  if (freshness === null) {
    lines.push(t("diagnostic.summary.freshness.unavailable"));
  } else if (freshness.state === "fresh") {
    lines.push(t("diagnostic.summary.freshness.fresh"));
  } else if (freshness.state === "stale") {
    const age = Number.isFinite(freshness.ageSeconds) && freshness.ageSeconds >= 0
      ? locale === "en-US"
        ? ` (${Math.round(freshness.ageSeconds)}s old)`
        : ` (${Math.round(freshness.ageSeconds)}s de idade)`
      : "";
    lines.push(t("diagnostic.summary.freshness.stale", { age }));
  } else {
    const reason = freshness.reason ? ` (${safeText(freshness.reason)})` : "";
    lines.push(t("diagnostic.summary.freshness.unknown", { reason }));
  }
  return lines;
}

function metricLines(report, t) {
  if (report.metrics === null) return [t("diagnostic.summary.metrics.unavailable")];
  const metrics = asObject(report.metrics, "Diagnostic report metrics");
  const memoryTotal = safeNumber(metrics.memoryTotalBytes, "memoryTotalBytes");
  const memoryAvailable = safeNumber(metrics.memoryAvailableBytes, "memoryAvailableBytes");
  const storageTotal = safeNumber(metrics.userStorageTotalBytes, "userStorageTotalBytes");
  const storageFree = safeNumber(metrics.userStorageFreeBytes, "userStorageFreeBytes");
  const uptime = safeNumber(metrics.uptimeSeconds, "uptimeSeconds");
  if (memoryAvailable > memoryTotal || storageFree > storageTotal) {
    throw new TypeError("Diagnostic metrics contain impossible available/free values");
  }
  return [
    t("diagnostic.summary.metrics.uptime", { value: Math.round(uptime) }),
    t("diagnostic.summary.metrics.memory", {
      used: formatBytes(memoryTotal - memoryAvailable),
      total: formatBytes(memoryTotal),
    }),
    t("diagnostic.summary.metrics.storage", {
      free: formatBytes(storageFree),
      total: formatBytes(storageTotal),
    }),
  ];
}

function historyLines(report, t) {
  if (report.history === null) return [t("diagnostic.summary.history.unavailable")];
  const history = asObject(report.history, "Diagnostic report history");
  return [t("diagnostic.summary.history.line", {
    deliveries: safeCount(history.releaseCount, "releaseCount"),
    applications: safeCount(history.applicationCount, "applicationCount"),
  })];
}

function journalLines(report, t) {
  if (report.journal === null) {
    return [
      t("diagnostic.summary.journal.unavailable"),
      t("diagnostic.summary.journal.unavailableCaveat"),
    ];
  }

  const journal = asObject(report.journal, "Diagnostic report journal");
  const eventCount = safeCount(journal.eventCount, "eventCount");
  const retentionLimit = safeCount(journal.retentionLimit, "retentionLimit");
  const scope = safeCode(journal.configuredStoreScope, "configuredStoreScope", { allowEmpty: false });
  const persistence = safeCode(journal.persistenceStatus, "persistenceStatus", { allowEmpty: false });
  const errorCode = safeCode(journal.persistenceErrorCode ?? "", "persistenceErrorCode");
  if (
    !Array.isArray(journal.events)
    || journal.events.length > retentionLimit
    || journal.events.length !== eventCount
  ) {
    throw new TypeError("Diagnostic journal events must match eventCount and retentionLimit");
  }

  const lines = [
    t("diagnostic.summary.journal.line", { count: eventCount, limit: retentionLimit }),
    t("diagnostic.summary.journal.persistence", {
      persistence,
      scope,
      error: errorCode ? ` · ${errorCode}` : "",
    }),
  ];
  if (eventCount === 0) {
    lines.push(t("diagnostic.summary.journal.empty"));
    return lines;
  }

  lines.push(t("diagnostic.summary.journal.recent", { limit: MAX_SUMMARY_EVENTS }));
  for (const eventValue of journal.events.slice(-MAX_SUMMARY_EVENTS)) {
    const event = asObject(eventValue, "Diagnostic journal event");
    const occurredAt = safeText(event.occurredAt) || t("diagnostic.summary.journal.unknownTime");
    const severity = safeText(event.severity) || "unknown";
    const component = safeText(event.component) || "unknown";
    const eventCode = safeText(event.eventCode) || "unknown";
    const message = safeText(event.message);
    const correlation = safeText(event.correlationKey);
    lines.push(
      `- ${occurredAt} · ${severity} · ${component} · ${eventCode}${message ? ` · ${message}` : ""}${correlation ? ` · ${t("diagnostic.summary.journal.correlation")} ${correlation}` : ""}`,
    );
  }
  return lines;
}

export function createDiagnosticReviewSummary(document, { locale = "pt-BR" } = {}) {
  const resolvedLocale = resolveDiagnosticSummaryLocale(locale);
  const t = (messageId, values = {}) => translateDiagnosticSummaryMessage(
    resolvedLocale,
    messageId,
    values,
  );
  const review = validateReviewDocument(document);
  const report = review.report;
  const surface = asObject(report.surface, "Diagnostic report surface");
  if (!Array.isArray(surface.capabilityIds) || surface.capabilityIds.length > 128) {
    throw new TypeError("Diagnostic Surface capabilityIds must be a bounded array");
  }

  const lines = [
    t("diagnostic.summary.title"),
    t("diagnostic.summary.generated", { value: review.generatedAt }),
    t("diagnostic.summary.scope"),
    "",
    t("diagnostic.summary.sources"),
    ...sourceLines(review, t),
    "",
    t("diagnostic.summary.connectivity", {
      value: safeText(surface.connectivity) || t("diagnostic.summary.unknown"),
    }),
    t("diagnostic.summary.capabilities", {
      value: surface.capabilityIds.length === 0
        ? t("diagnostic.summary.none")
        : surface.capabilityIds.map(safeText).join(", "),
    }),
    "",
    ...updateLines(review, resolvedLocale, t),
    "",
    ...metricLines(report, t),
    "",
    ...historyLines(report, t),
    "",
    ...journalLines(report, t),
    "",
    t("diagnostic.summary.footer"),
  ];

  return validateDiagnosticSummary({
    schema: DIAGNOSTIC_SUMMARY_SCHEMA,
    mediaType: "text/plain;charset=utf-8",
    text: `${lines.join("\n")}\n`,
  });
}
