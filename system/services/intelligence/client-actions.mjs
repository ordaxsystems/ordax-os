import { assertIntelligencePort } from "../../contracts/intelligence.mjs";
import { validateSurfaceSnapshot } from "../../contracts/surface-host.mjs";
import { validateSystemMetricsSnapshot } from "../../contracts/system-metrics.mjs";

const MAX_DOCUMENT_CONTEXT_CHARS = 7600;

const CLIENT_COPY = Object.freeze({
  "pt-BR": Object.freeze({
    documentTitle: "Título",
    documentContent: "Conteúdo",
    documentTruncated: "conteúdo truncado pelo limite de contexto local",
    summarizePrompt: "Resuma o documento em português, preservando os fatos principais e sem inventar informações.",
    diagnosePrompt:
      "Explique o estado observado do dispositivo em linguagem simples. "
      + "Diferencie fatos observados de limitações da leitura. "
      + "Não prescreva operações destrutivas nem afirme saúde além dos dados fornecidos.",
  }),
  "en-US": Object.freeze({
    documentTitle: "Title",
    documentContent: "Content",
    documentTruncated: "content truncated by the local context limit",
    summarizePrompt: "Summarize the document in English, preserving the main facts and without inventing information.",
    diagnosePrompt:
      "Explain the observed device state in plain English. "
      + "Distinguish observed facts from limitations of the available data. "
      + "Do not prescribe destructive operations or claim health beyond the provided observations.",
  }),
});

function clientCopy(locale) {
  return CLIENT_COPY[locale] ?? CLIENT_COPY["pt-BR"];
}

function bounded(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function documentContextText(title, text, locale) {
  const cleanTitle = bounded(title, "Intelligence document title", 512);
  const cleanText = bounded(text, "Intelligence document text", 65536);
  const copy = clientCopy(locale);
  const prefix = `${copy.documentTitle}: ${cleanTitle}\n\n${copy.documentContent}:\n`;
  const available = Math.max(1, MAX_DOCUMENT_CONTEXT_CHARS - prefix.length);
  const clipped = cleanText.slice(0, available);
  const suffix = cleanText.length > clipped.length
    ? `\n\n[${copy.documentTruncated}]`
    : "";
  return (prefix + clipped + suffix).slice(0, 8192);
}

export async function summarizeDocumentWithIntelligence(
  portValue,
  {
    id,
    title,
    text,
    provenance,
    locale = "pt-BR",
    prompt = null,
    maxTokens = 384,
  } = {},
) {
  const port = assertIntelligencePort(portValue);
  const documentId = bounded(id, "Intelligence document id", 160);
  const source = bounded(provenance, "Intelligence document provenance", 512);
  const resolvedPrompt = prompt === null
    ? clientCopy(locale).summarizePrompt
    : bounded(prompt, "Intelligence summary prompt", 2048);
  return port.respond({
    intent: "summarize",
    prompt: resolvedPrompt,
    context: [{
      id: documentId,
      scope: "document",
      text: documentContextText(title, text, locale),
      provenance: source,
    }],
    maxTokens,
  });
}

function systemContext(surfaceValue, metricsValue) {
  const surface = validateSurfaceSnapshot(surfaceValue);
  const payload = {
    connectivity: surface.connectivity,
    capabilityIds: [...surface.capabilityIds].sort(),
  };
  if (metricsValue !== null && metricsValue !== undefined) {
    const metrics = validateSystemMetricsSnapshot(metricsValue);
    payload.metrics = {
      uptimeSeconds: metrics.uptimeSeconds,
      memoryTotalBytes: metrics.memoryTotalBytes,
      memoryAvailableBytes: metrics.memoryAvailableBytes,
      userStorageTotalBytes: metrics.userStorageTotalBytes,
      userStorageFreeBytes: metrics.userStorageFreeBytes,
    };
  }
  return JSON.stringify(payload);
}

export async function explainSystemStateWithIntelligence(
  portValue,
  {
    surface,
    metrics = null,
    locale = "pt-BR",
    maxTokens = 384,
  } = {},
) {
  const port = assertIntelligencePort(portValue);
  return port.respond({
    intent: "diagnose",
    prompt: clientCopy(locale).diagnosePrompt,
    context: [{
      id: "system-local-snapshot",
      scope: "system",
      text: systemContext(surface, metrics),
      provenance: "ordax-system-local-snapshot",
    }],
    maxTokens,
  });
}
