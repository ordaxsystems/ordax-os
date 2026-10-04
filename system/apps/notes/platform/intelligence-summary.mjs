import {
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  assertIntelligencePort,
} from "../../../contracts/intelligence.mjs";

const MAX_NOTES_INTELLIGENCE_SOURCE_CHARS = 65536;
const MAX_NOTES_INTELLIGENCE_TITLE_CHARS = 512;
const MAX_NOTES_INTELLIGENCE_ID_CHARS = 160;
const MAX_NOTES_INTELLIGENCE_PROVENANCE_CHARS = 512;
const NOTES_CONTEXT_RESERVE_CHARS = 592;
const NOTES_CONTEXT_CONTENT_CHARS = Math.max(
  1,
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS - NOTES_CONTEXT_RESERVE_CHARS,
);

const COPY = Object.freeze({
  "pt-BR": Object.freeze({
    title: "Título",
    content: "Conteúdo",
    truncated: "conteúdo truncado pelo limite de contexto local",
    prompt: "Resuma o documento em português, preservando os fatos principais e sem inventar informações.",
  }),
  "en-US": Object.freeze({
    title: "Title",
    content: "Content",
    truncated: "content truncated by the local context limit",
    prompt: "Summarize the document in English, preserving the main facts and without inventing information.",
  }),
});

function boundedText(value, label, max) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`${label} must be text`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TypeError(`${label} is outside its allowed bounds`);
  }
  return normalized;
}

function notesLocale(locale) {
  return locale === "en-US" ? "en-US" : "pt-BR";
}

function notesContextText(titleValue, textValue, locale) {
  const title = boundedText(
    titleValue,
    "Notes Intelligence title",
    MAX_NOTES_INTELLIGENCE_TITLE_CHARS,
  );
  const text = boundedText(
    textValue,
    "Notes Intelligence text",
    MAX_NOTES_INTELLIGENCE_SOURCE_CHARS,
  );
  const copy = COPY[notesLocale(locale)];
  const prefix = `${copy.title}: ${title}\n\n${copy.content}:\n`;
  const available = Math.max(
    1,
    Math.min(NOTES_CONTEXT_CONTENT_CHARS, INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS - prefix.length),
  );
  const clipped = text.slice(0, available);
  const suffix = text.length > clipped.length ? `\n\n[${copy.truncated}]` : "";
  return (prefix + clipped + suffix).slice(0, INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS);
}

export async function summarizeNoteWithIntelligence(
  portValue,
  {
    id,
    title,
    text,
    provenance,
    locale = "pt-BR",
    maxTokens = 384,
  } = {},
) {
  const port = assertIntelligencePort(portValue);
  const resolvedLocale = notesLocale(locale);
  const noteId = boundedText(id, "Notes Intelligence id", MAX_NOTES_INTELLIGENCE_ID_CHARS);
  const source = boundedText(
    provenance,
    "Notes Intelligence provenance",
    MAX_NOTES_INTELLIGENCE_PROVENANCE_CHARS,
  );

  return port.respond({
    intent: "summarize",
    prompt: COPY[resolvedLocale].prompt,
    context: [{
      id: noteId,
      scope: "document",
      text: notesContextText(title, text, resolvedLocale),
      provenance: source,
    }],
    maxTokens,
  });
}
