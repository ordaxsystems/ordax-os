import { validateAppIntelligenceManifest } from "../../contracts/app-intelligence-manifest.mjs";
import { assertApplicationIntelligenceAwarenessPort } from "../../contracts/application-intelligence-awareness.mjs";
import { INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS } from "../../contracts/intelligence.mjs";

export const APPLICATION_SEMANTIC_ROUTER_SCHEMA = "ordax.application-semantic-router/1";

const MAX_MATCHED_APPS = 3;
const MAX_PROMPT_TOKENS = 64;
const DETAIL_CONTEXT_BUDGET = Math.min(7600, INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS);
const STOP_TOKENS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em",
  "eu", "me", "meu", "minha", "no", "nos", "o", "os", "para", "por", "que", "se", "um", "uma",
  "abra", "abrir", "mostre", "mostrar", "use", "usar", "va", "ir",
  "and", "for", "from", "in", "of", "on", "the", "to", "with", "open", "show", "use",
]);

function normalizedText(value) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError("Application semantic routing text must be a string");
  }
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(value) {
  const normalized = normalizedText(value);
  if (!normalized) return [];
  const result = [];
  const seen = new Set();
  for (const token of normalized.split(" ")) {
    if (token.length < 2 || STOP_TOKENS.has(token) || seen.has(token)) continue;
    seen.add(token);
    result.push(token);
    if (result.length >= MAX_PROMPT_TOKENS) break;
  }
  return result;
}

function semanticProjection(manifest) {
  return {
    instructions: [...manifest.instructions],
    intents: manifest.intents.map((intent) => ({
      id: intent.id,
      description: intent.description,
      effect: intent.effect,
      confirmation: intent.confirmation,
      parameters: intent.parameters.map((parameter) => ({
        name: parameter.name,
        type: parameter.type,
        required: parameter.required,
      })),
      examples: [...intent.examples],
    })),
  };
}

function detailContextItem(descriptor, manifest) {
  const text = JSON.stringify({
    application: {
      appId: descriptor.appId,
      title: descriptor.title,
      sourceClass: descriptor.sourceClass,
      platform: descriptor.platform,
    },
    semantics: semanticProjection(manifest),
    authority: "none",
    toolExecution: false,
  });
  if (text.length > DETAIL_CONTEXT_BUDGET) {
    throw new TypeError(`Application semantic detail exceeded context budget: ${descriptor.appId}`);
  }
  return Object.freeze({
    id: `ordax-application-detail:${descriptor.appId}`,
    scope: "system",
    text,
    provenance: `ordax-application-semantic-router:${descriptor.appId}`,
  });
}

function addPosting(postings, token, appId, weight) {
  if (!token || STOP_TOKENS.has(token)) return;
  const byApp = postings.get(token) ?? new Map();
  byApp.set(appId, Math.min(24, (byApp.get(appId) ?? 0) + weight));
  postings.set(token, byApp);
}

function addText(postings, value, appId, weight) {
  for (const token of tokens(value)) addPosting(postings, token, appId, weight);
}

function addManifest(postings, descriptor, manifest) {
  addText(postings, descriptor.appId, descriptor.appId, 10);
  addText(postings, descriptor.title, descriptor.appId, 10);
  for (const intent of manifest.intents) {
    const intentSuffix = intent.id.startsWith(`${descriptor.appId}.`)
      ? intent.id.slice(descriptor.appId.length + 1).replaceAll(".", " ")
      : intent.id.replaceAll(".", " ");
    addText(postings, intentSuffix, descriptor.appId, 7);
    addText(postings, intent.description, descriptor.appId, 4);
    for (const example of intent.examples) addText(postings, example, descriptor.appId, 6);
  }
}

function assertRouter(port) {
  if (!port || typeof port !== "object" || port.schema !== APPLICATION_SEMANTIC_ROUTER_SCHEMA) {
    throw new TypeError("Compatible Application semantic router is required");
  }
  for (const method of ["select", "contextItemsForPrompt"]) {
    if (typeof port[method] !== "function") {
      throw new TypeError(`Application semantic router must implement ${method}()`);
    }
  }
  if (port.route !== undefined && typeof port.route !== "function") {
    throw new TypeError("Application semantic router route must be a function when provided");
  }
  for (const forbidden of ["execute", "invoke", "run", "launch", "grant", "authorize"]) {
    if (typeof port[forbidden] === "function") {
      throw new TypeError(`Application semantic router must not expose ${forbidden}()`);
    }
  }
  return port;
}

export function createApplicationSemanticRouter({
  awareness,
  manifests = [],
  maxMatchedApps = MAX_MATCHED_APPS,
} = {}) {
  const appAwareness = assertApplicationIntelligenceAwarenessPort(awareness);
  if (!Array.isArray(manifests) || manifests.length > 128) {
    throw new TypeError("Application semantic router manifests must be a bounded array");
  }
  if (!Number.isSafeInteger(maxMatchedApps) || maxMatchedApps < 1 || maxMatchedApps > 8) {
    throw new TypeError("Application semantic router match limit is invalid");
  }

  const descriptors = new Map(appAwareness.list().map((descriptor) => [descriptor.appId, descriptor]));
  const detailByAppId = new Map();
  const normalizedTitleByAppId = new Map();
  const postings = new Map();

  for (const raw of manifests) {
    const manifest = validateAppIntelligenceManifest(raw);
    const descriptor = descriptors.get(manifest.appId);
    if (!descriptor || descriptor.sourceClass !== "first-party") {
      throw new TypeError(`Application semantic router references unknown first-party app: ${manifest.appId}`);
    }
    if (detailByAppId.has(manifest.appId)) {
      throw new TypeError(`Application semantic router manifest is duplicated: ${manifest.appId}`);
    }
    detailByAppId.set(manifest.appId, detailContextItem(descriptor, manifest));
    normalizedTitleByAppId.set(manifest.appId, normalizedText(descriptor.title));
    addManifest(postings, descriptor, manifest);
  }

  const computeSelection = (prompt) => {
    const normalizedPrompt = normalizedText(prompt);
    if (!normalizedPrompt) return Object.freeze([]);
    const scores = new Map();
    const paddedPrompt = ` ${normalizedPrompt} `;

    for (const [appId, title] of normalizedTitleByAppId) {
      if (title && paddedPrompt.includes(` ${title} `)) {
        scores.set(appId, (scores.get(appId) ?? 0) + 20);
      }
    }
    for (const token of tokens(normalizedPrompt)) {
      const byApp = postings.get(token);
      if (!byApp) continue;
      for (const [appId, weight] of byApp) {
        scores.set(appId, (scores.get(appId) ?? 0) + weight);
      }
    }

    const selected = [...scores]
      .filter(([, score]) => score >= 4)
      .sort(([leftId, leftScore], [rightId, rightScore]) => (
        rightScore - leftScore || leftId.localeCompare(rightId)
      ))
      .slice(0, maxMatchedApps)
      .map(([appId, score]) => Object.freeze({ appId, score }));
    return Object.freeze(selected);
  };

  const route = (prompt) => {
    const selection = computeSelection(prompt);
    const contextItems = Object.freeze(
      selection
        .map(({ appId }) => detailByAppId.get(appId))
        .filter(Boolean),
    );
    return Object.freeze({ selection, contextItems });
  };

  const port = Object.freeze({
    schema: APPLICATION_SEMANTIC_ROUTER_SCHEMA,
    route,
    select(prompt) {
      return route(prompt).selection;
    },
    contextItemsForPrompt(prompt) {
      return route(prompt).contextItems;
    },
  });
  return Object.freeze(assertRouter(port));
}

export function assertApplicationSemanticRouter(port) {
  return assertRouter(port);
}
