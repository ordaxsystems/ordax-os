import { assertIntelligencePort } from "../../contracts/intelligence.mjs";
import { validateSurfaceSnapshot } from "../../contracts/surface-host.mjs";
import { validateSystemMetricsSnapshot } from "../../contracts/system-metrics.mjs";

const MAX_DOCUMENT_CONTEXT_CHARS = 7600;

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

function documentContextText(title, text) {
  const cleanTitle = bounded(title, "Intelligence document title", 1024).slice(0, 512);
  const cleanText = bounded(text, "Intelligence document text", 65536);
  const prefix = `Título: ${cleanTitle}\n\nConteúdo:\n`;
  const available = Math.max(1, MAX_DOCUMENT_CONTEXT_CHARS - prefix.length);
  const clipped = cleanText.slice(0, available);
  const suffix = cleanText.length > clipped.length
    ? "\n\n[conteúdo truncado pelo limite de contexto local]"
    : "";
  return (prefix + clipped + suffix).slice(0, 8192);
}

export function createDocumentIntelligenceContext({
  id,
  title,
  text,
  provenance,
} = {}) {
  const documentId = bounded(id, "Intelligence document id", 160);
  const source = bounded(provenance, "Intelligence document provenance", 512);
  return Object.freeze([Object.freeze({
    id: documentId,
    scope: "document",
    text: documentContextText(title, text),
    provenance: source,
  })]);
}

export async function summarizeDocumentWithIntelligence(
  portValue,
  {
    id,
    title,
    text,
    provenance,
    prompt = "Resuma o documento em português, preservando os fatos principais e sem inventar informações.",
    maxTokens = 384,
  } = {},
) {
  const port = assertIntelligencePort(portValue);
  return port.respond({
    intent: "summarize",
    prompt,
    context: createDocumentIntelligenceContext({ id, title, text, provenance }),
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
    maxTokens = 384,
  } = {},
) {
  const port = assertIntelligencePort(portValue);
  return port.respond({
    intent: "diagnose",
    prompt:
      "Explique o estado observado do dispositivo em linguagem simples. "
      + "Diferencie fatos observados de limitações da leitura. "
      + "Não prescreva operações destrutivas nem afirme saúde além dos dados fornecidos.",
    context: [{
      id: "system-local-snapshot",
      scope: "system",
      text: systemContext(surface, metrics),
      provenance: "ordax-system-local-snapshot",
    }],
    maxTokens,
  });
}
