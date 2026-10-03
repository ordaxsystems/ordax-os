import {
  DIAGNOSTIC_SUMMARY_SCHEMA,
  validateDiagnosticSummary,
} from "../../contracts/diagnostic-copy.mjs";
import { DIAGNOSTIC_REPORT_SCHEMA } from "./report.mjs";
import { DIAGNOSTIC_REVIEW_SCHEMA } from "./review.mjs";
import { redactDiagnosticText } from "./redaction.mjs";

const SOURCE_IDS = Object.freeze(["surface", "update", "metrics", "history", "journal"]);
const SOURCE_ID_SET = new Set(SOURCE_IDS);
const SOURCE_STATUS_SET = new Set(["included", "unavailable", "failed"]);
const FRESHNESS_STATES = new Set(["fresh", "stale", "unknown"]);
const SUMMARY_LOCALES = new Set(["pt-BR", "en-US"]);
const MAX_SUMMARY_EVENTS = 10;

const SUMMARY_COPY = Object.freeze({
  "pt-BR": Object.freeze({
    sourceLabels: Object.freeze({
      surface: "Surface",
      update: "Atualização",
      metrics: "Métricas",
      history: "Histórico",
      journal: "Registro diagnóstico",
    }),
    sourceStatusLabels: Object.freeze({
      included: "incluída",
      unavailable: "indisponível",
      failed: "falha na leitura",
    }),
    updateUnavailable: "Atualização: indisponível nesta revisão.",
    notReported: "não informado",
    freshnessUnavailable: "Atualidade da observação: indisponível.",
    freshnessFresh: "Atualidade da observação: recente.",
    metricsUnavailable: "Métricas: indisponíveis nesta revisão.",
    historyUnavailable: "Histórico: indisponível nesta revisão.",
    journalUnavailable: "Registro diagnóstico: indisponível nesta revisão.",
    journalUnavailableCaveat: "A ausência do registro não comprova ausência de problemas.",
    journalEmpty: "Nenhum evento está retido nesta revisão; isso não é um atestado geral de saúde.",
    unknownTime: "horário desconhecido",
    title: "OrdaX — resumo sanitizado de diagnóstico",
    scope: "Escopo: revisão local explícita",
    sourcesHeading: "Fontes da revisão:",
    unknown: "desconhecida",
    none: "nenhuma",
    footer: "Resumo gerado somente a partir da revisão estruturada e sanitizada. O JSON bruto do documento não é usado como fonte desta cópia.",
  }),
  "en-US": Object.freeze({
    sourceLabels: Object.freeze({
      surface: "Surface",
      update: "Update",
      metrics: "Metrics",
      history: "History",
      journal: "Diagnostic log",
    }),
    sourceStatusLabels: Object.freeze({
      included: "included",
      unavailable: "unavailable",
      failed: "read failed",
    }),
    updateUnavailable: "Update: unavailable in this review.",
    notReported: "not reported",
    freshnessUnavailable: "Observation freshness: unavailable.",
    freshnessFresh: "Observation freshness: fresh.",
    metricsUnavailable: "Metrics: unavailable in this review.",
    historyUnavailable: "History: unavailable in this review.",
    journalUnavailable: "Diagnostic log: unavailable in this review.",
    journalUnavailableCaveat: "The absence of the log does not prove the absence of problems.",
    journalEmpty: "No events are retained in this review; this is not a general statement of system health.",
    unknownTime: "unknown time",
    title: "OrdaX — sanitized diagnostic summary",
    scope: "Scope: explicit local review",
    sourcesHeading: "Review sources:",
    unknown: "unknown",
    none: "none",
    footer: "Summary generated only from the structured, sanitized review. The document's raw JSON is not used as a source for this copy.",
  }),
});

function resolveSummaryLocale(locale) {
  return SUMMARY_LOCALES.has(locale) ? locale : "pt-BR";
}

function summaryCopy(locale) {
  return SUMMARY_COPY[resolveSummaryLocale(locale)];
}

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

function sourceLines(review, copy) {
  const byId = new Map(review.manifest.sources.map((entry) => [entry.id, entry]));
  return SOURCE_IDS.map((sourceId) => {
    const entry = byId.get(sourceId);
    const suffix = entry.failureCode ? ` (${safeCode(entry.failureCode, "failureCode")})` : "";
    return `- ${copy.sourceLabels[sourceId]}: ${copy.sourceStatusLabels[entry.status]}${suffix}`;
  });
}

function updateLines(review, locale, copy) {
  const report = review.report;
  if (report.update === null) return [copy.updateUnavailable];

  const update = asObject(report.update, "Diagnostic report update");
  const isEnglish = locale === "en-US";
  const lines = [
    isEnglish
      ? `Update: delivery ${safeText(update.deliveryNumber)} · status ${safeText(update.status)} · phase ${safeText(update.phase)} · apply mode ${safeText(update.applyMode)}`
      : `Atualização: entrega ${safeText(update.deliveryNumber)} · estado ${safeText(update.status)} · fase ${safeText(update.phase)} · aplicação ${safeText(update.applyMode)}`,
    isEnglish
      ? `Observed SHA: ${safeText(update.sourceSha) || copy.notReported}`
      : `SHA observado: ${safeText(update.sourceSha) || copy.notReported}`,
  ];
  if (update.runtimeSurfaceSha) {
    lines.push(isEnglish
      ? `Running Surface: ${safeText(update.runtimeSurfaceSha)}`
      : `Surface em execução: ${safeText(update.runtimeSurfaceSha)}`);
  }
  if (update.targetSha) {
    lines.push(isEnglish
      ? `Target SHA: ${safeText(update.targetSha)}`
      : `SHA alvo: ${safeText(update.targetSha)}`);
  }
  if (update.checkedAt) {
    lines.push(isEnglish
      ? `Updater observation: ${safeText(update.checkedAt)}`
      : `Observação do atualizador: ${safeText(update.checkedAt)}`);
  }
  if (update.lastError) {
    lines.push(isEnglish
      ? `Last updater diagnostic: ${safeText(update.lastError)}`
      : `Último diagnóstico do atualizador: ${safeText(update.lastError)}`);
  }

  const freshness = review.observations.updateFreshness;
  if (freshness === null) {
    lines.push(copy.freshnessUnavailable);
  } else if (freshness.state === "fresh") {
    lines.push(copy.freshnessFresh);
  } else if (freshness.state === "stale") {
    const age = Number.isFinite(freshness.ageSeconds) && freshness.ageSeconds >= 0
      ? isEnglish
        ? ` (${Math.round(freshness.ageSeconds)}s old)`
        : ` (${Math.round(freshness.ageSeconds)}s de idade)`
      : "";
    lines.push(isEnglish
      ? `Observation freshness: stale${age}. This does not prove supervisor failure.`
      : `Atualidade da observação: antiga${age}. Isso não prova falha do supervisor.`);
  } else {
    const reason = freshness.reason ? ` (${safeText(freshness.reason)})` : "";
    lines.push(isEnglish
      ? `Observation freshness: unknown${reason}.`
      : `Atualidade da observação: desconhecida${reason}.`);
  }
  return lines;
}

function metricLines(report, locale, copy) {
  if (report.metrics === null) return [copy.metricsUnavailable];
  const metrics = asObject(report.metrics, "Diagnostic report metrics");
  const memoryTotal = safeNumber(metrics.memoryTotalBytes, "memoryTotalBytes");
  const memoryAvailable = safeNumber(metrics.memoryAvailableBytes, "memoryAvailableBytes");
  const storageTotal = safeNumber(metrics.userStorageTotalBytes, "userStorageTotalBytes");
  const storageFree = safeNumber(metrics.userStorageFreeBytes, "userStorageFreeBytes");
  const uptime = safeNumber(metrics.uptimeSeconds, "uptimeSeconds");
  if (memoryAvailable > memoryTotal || storageFree > storageTotal) {
    throw new TypeError("Diagnostic metrics contain impossible available/free values");
  }
  if (locale === "en-US") {
    return [
      `Uptime: ${Math.round(uptime)}s`,
      `Memory: ${formatBytes(memoryTotal - memoryAvailable)} used of ${formatBytes(memoryTotal)}`,
      `User storage: ${formatBytes(storageFree)} free of ${formatBytes(storageTotal)}`,
    ];
  }
  return [
    `Tempo ligado: ${Math.round(uptime)}s`,
    `Memória: ${formatBytes(memoryTotal - memoryAvailable)} em uso de ${formatBytes(memoryTotal)}`,
    `Espaço do usuário: ${formatBytes(storageFree)} livre de ${formatBytes(storageTotal)}`,
  ];
}

function historyLines(report, locale, copy) {
  if (report.history === null) return [copy.historyUnavailable];
  const history = asObject(report.history, "Diagnostic report history");
  const releaseCount = safeCount(history.releaseCount, "releaseCount");
  const applicationCount = safeCount(history.applicationCount, "applicationCount");
  return [locale === "en-US"
    ? `History: ${releaseCount} deliveries · ${applicationCount} local applications.`
    : `Histórico: ${releaseCount} entregas · ${applicationCount} aplicações locais.`];
}

function journalLines(report, locale, copy) {
  if (report.journal === null) {
    return [copy.journalUnavailable, copy.journalUnavailableCaveat];
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

  const isEnglish = locale === "en-US";
  const lines = [
    isEnglish
      ? `Diagnostic log: ${eventCount} events retained out of up to ${retentionLimit}.`
      : `Registro diagnóstico: ${eventCount} eventos retidos de até ${retentionLimit}.`,
    isEnglish
      ? `Persistence: ${persistence} · configured scope ${scope}${errorCode ? ` · ${errorCode}` : ""}.`
      : `Persistência: ${persistence} · escopo configurado ${scope}${errorCode ? ` · ${errorCode}` : ""}.`,
  ];
  if (eventCount === 0) {
    lines.push(copy.journalEmpty);
    return lines;
  }

  lines.push(isEnglish
    ? `Recent events (up to ${MAX_SUMMARY_EVENTS}):`
    : `Eventos recentes (até ${MAX_SUMMARY_EVENTS}):`);
  for (const eventValue of journal.events.slice(-MAX_SUMMARY_EVENTS)) {
    const event = asObject(eventValue, "Diagnostic journal event");
    const occurredAt = safeText(event.occurredAt) || copy.unknownTime;
    const severity = safeText(event.severity) || "unknown";
    const component = safeText(event.component) || "unknown";
    const eventCode = safeText(event.eventCode) || "unknown";
    const message = safeText(event.message);
    const correlation = safeText(event.correlationKey);
    lines.push(
      `- ${occurredAt} · ${severity} · ${component} · ${eventCode}${message ? ` · ${message}` : ""}${correlation ? ` · ${isEnglish ? "correlation" : "correlação"} ${correlation}` : ""}`,
    );
  }
  return lines;
}

export function createDiagnosticReviewSummary(document, { locale = "pt-BR" } = {}) {
  const resolvedLocale = resolveSummaryLocale(locale);
  const copy = summaryCopy(resolvedLocale);
  const review = validateReviewDocument(document);
  const report = review.report;
  const surface = asObject(report.surface, "Diagnostic report surface");
  if (!Array.isArray(surface.capabilityIds) || surface.capabilityIds.length > 128) {
    throw new TypeError("Diagnostic Surface capabilityIds must be a bounded array");
  }
  const isEnglish = resolvedLocale === "en-US";

  const lines = [
    copy.title,
    `${isEnglish ? "Generated" : "Gerado"}: ${review.generatedAt}`,
    copy.scope,
    "",
    copy.sourcesHeading,
    ...sourceLines(review, copy),
    "",
    `${isEnglish ? "Observed connectivity" : "Conectividade observada"}: ${safeText(surface.connectivity) || copy.unknown}`,
    `${isEnglish ? "Declared capabilities" : "Capacidades declaradas"}: ${surface.capabilityIds.length === 0 ? copy.none : surface.capabilityIds.map(safeText).join(", ")}`,
    "",
    ...updateLines(review, resolvedLocale, copy),
    "",
    ...metricLines(report, resolvedLocale, copy),
    "",
    ...historyLines(report, resolvedLocale, copy),
    "",
    ...journalLines(report, resolvedLocale, copy),
    "",
    copy.footer,
  ];

  return validateDiagnosticSummary({
    schema: DIAGNOSTIC_SUMMARY_SCHEMA,
    mediaType: "text/plain;charset=utf-8",
    text: `${lines.join("\n")}\n`,
  });
}
