const SOURCE_LOCALE = "pt-BR";
const ENGLISH_LOCALE = "en-US";

const SOURCE = Object.freeze({
  "diagnostic.summary.title": "OrdaX — resumo sanitizado de diagnóstico",
  "diagnostic.summary.generated": "Gerado: {value}",
  "diagnostic.summary.scope": "Escopo: revisão local explícita",
  "diagnostic.summary.sources": "Fontes da revisão:",
  "diagnostic.summary.source.surface": "Surface",
  "diagnostic.summary.source.update": "Atualização",
  "diagnostic.summary.source.metrics": "Métricas",
  "diagnostic.summary.source.history": "Histórico",
  "diagnostic.summary.source.journal": "Registro diagnóstico",
  "diagnostic.summary.status.included": "incluída",
  "diagnostic.summary.status.unavailable": "indisponível",
  "diagnostic.summary.status.failed": "falha na leitura",
  "diagnostic.summary.connectivity": "Conectividade observada: {value}",
  "diagnostic.summary.capabilities": "Capacidades declaradas: {value}",
  "diagnostic.summary.unknown": "desconhecida",
  "diagnostic.summary.none": "nenhuma",
  "diagnostic.summary.update.unavailable": "Atualização: indisponível nesta revisão.",
  "diagnostic.summary.update.line": "Atualização: entrega {delivery} · estado {status} · fase {phase} · aplicação {applyMode}",
  "diagnostic.summary.update.sha": "SHA observado: {value}",
  "diagnostic.summary.update.runtimeSurfaceSha": "Surface em execução: {value}",
  "diagnostic.summary.update.targetSha": "SHA alvo: {value}",
  "diagnostic.summary.update.checkedAt": "Observação do atualizador: {value}",
  "diagnostic.summary.update.lastError": "Último diagnóstico do atualizador: {value}",
  "diagnostic.summary.notReported": "não informado",
  "diagnostic.summary.freshness.unavailable": "Atualidade da observação: indisponível.",
  "diagnostic.summary.freshness.fresh": "Atualidade da observação: recente.",
  "diagnostic.summary.freshness.stale": "Atualidade da observação: antiga{age}. Isso não prova falha do supervisor.",
  "diagnostic.summary.freshness.unknown": "Atualidade da observação: desconhecida{reason}.",
  "diagnostic.summary.metrics.unavailable": "Métricas: indisponíveis nesta revisão.",
  "diagnostic.summary.metrics.uptime": "Tempo ligado: {value}s",
  "diagnostic.summary.metrics.memory": "Memória: {used} em uso de {total}",
  "diagnostic.summary.metrics.storage": "Espaço do usuário: {free} livre de {total}",
  "diagnostic.summary.history.unavailable": "Histórico: indisponível nesta revisão.",
  "diagnostic.summary.history.line": "Histórico: {deliveries} entregas · {applications} aplicações locais.",
  "diagnostic.summary.journal.unavailable": "Registro diagnóstico: indisponível nesta revisão.",
  "diagnostic.summary.journal.unavailableCaveat": "A ausência do registro não comprova ausência de problemas.",
  "diagnostic.summary.journal.line": "Registro diagnóstico: {count} eventos retidos de até {limit}.",
  "diagnostic.summary.journal.persistence": "Persistência: {persistence} · escopo configurado {scope}{error}.",
  "diagnostic.summary.journal.empty": "Nenhum evento está retido nesta revisão; isso não é um atestado geral de saúde.",
  "diagnostic.summary.journal.recent": "Eventos recentes (até {limit}):",
  "diagnostic.summary.journal.unknownTime": "horário desconhecido",
  "diagnostic.summary.journal.correlation": "correlação",
  "diagnostic.summary.footer": "Resumo gerado somente a partir da revisão estruturada e sanitizada. O JSON bruto do documento não é usado como fonte desta cópia."
});

const ENGLISH = Object.freeze({
  "diagnostic.summary.title": "OrdaX — sanitized diagnostic summary",
  "diagnostic.summary.generated": "Generated: {value}",
  "diagnostic.summary.scope": "Scope: explicit local review",
  "diagnostic.summary.sources": "Review sources:",
  "diagnostic.summary.source.surface": "Surface",
  "diagnostic.summary.source.update": "Update",
  "diagnostic.summary.source.metrics": "Metrics",
  "diagnostic.summary.source.history": "History",
  "diagnostic.summary.source.journal": "Diagnostic log",
  "diagnostic.summary.status.included": "included",
  "diagnostic.summary.status.unavailable": "unavailable",
  "diagnostic.summary.status.failed": "read failed",
  "diagnostic.summary.connectivity": "Observed connectivity: {value}",
  "diagnostic.summary.capabilities": "Declared capabilities: {value}",
  "diagnostic.summary.unknown": "unknown",
  "diagnostic.summary.none": "none",
  "diagnostic.summary.update.unavailable": "Update: unavailable in this review.",
  "diagnostic.summary.update.line": "Update: delivery {delivery} · status {status} · phase {phase} · apply mode {applyMode}",
  "diagnostic.summary.update.sha": "Observed SHA: {value}",
  "diagnostic.summary.update.runtimeSurfaceSha": "Running Surface: {value}",
  "diagnostic.summary.update.targetSha": "Target SHA: {value}",
  "diagnostic.summary.update.checkedAt": "Updater observation: {value}",
  "diagnostic.summary.update.lastError": "Last updater diagnostic: {value}",
  "diagnostic.summary.notReported": "not reported",
  "diagnostic.summary.freshness.unavailable": "Observation freshness: unavailable.",
  "diagnostic.summary.freshness.fresh": "Observation freshness: fresh.",
  "diagnostic.summary.freshness.stale": "Observation freshness: stale{age}. This does not prove supervisor failure.",
  "diagnostic.summary.freshness.unknown": "Observation freshness: unknown{reason}.",
  "diagnostic.summary.metrics.unavailable": "Metrics: unavailable in this review.",
  "diagnostic.summary.metrics.uptime": "Uptime: {value}s",
  "diagnostic.summary.metrics.memory": "Memory: {used} used of {total}",
  "diagnostic.summary.metrics.storage": "User storage: {free} free of {total}",
  "diagnostic.summary.history.unavailable": "History: unavailable in this review.",
  "diagnostic.summary.history.line": "History: {deliveries} deliveries · {applications} local applications.",
  "diagnostic.summary.journal.unavailable": "Diagnostic log: unavailable in this review.",
  "diagnostic.summary.journal.unavailableCaveat": "The absence of the log does not prove the absence of problems.",
  "diagnostic.summary.journal.line": "Diagnostic log: {count} events retained out of up to {limit}.",
  "diagnostic.summary.journal.persistence": "Persistence: {persistence} · configured scope {scope}{error}.",
  "diagnostic.summary.journal.empty": "No events are retained in this review; this is not a general statement of system health.",
  "diagnostic.summary.journal.recent": "Recent events (up to {limit}):",
  "diagnostic.summary.journal.unknownTime": "unknown time",
  "diagnostic.summary.journal.correlation": "correlation",
  "diagnostic.summary.footer": "Summary generated only from the structured, sanitized review. The document's raw JSON is not used as a source for this copy."
});

function format(template, values) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_match, key) => String(values[key] ?? ""));
}

export function translateDiagnosticSummaryMessage(locale, messageId, values = {}) {
  if (typeof messageId !== "string" || messageId.length === 0) {
    throw new TypeError("Diagnostic summary message id must be a non-empty string");
  }
  const catalog = locale === ENGLISH_LOCALE ? ENGLISH : SOURCE;
  const template = catalog[messageId] ?? SOURCE[messageId];
  if (typeof template !== "string") {
    throw new TypeError(`Unknown diagnostic summary message id: ${messageId}`);
  }
  return format(template, values);
}

export function resolveDiagnosticSummaryLocale(locale) {
  return locale === ENGLISH_LOCALE ? ENGLISH_LOCALE : SOURCE_LOCALE;
}
