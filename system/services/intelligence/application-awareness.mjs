import {
  APPLICATION_INTELLIGENCE_AWARENESS_PORT_SCHEMA,
  APPLICATION_INTELLIGENCE_AWARENESS_SCHEMA,
  assertApplicationIntelligenceAwarenessPort,
  validateApplicationIntelligenceAwareness,
} from "../../contracts/application-intelligence-awareness.mjs";
import { validateAppIntelligenceManifest } from "../../contracts/app-intelligence-manifest.mjs";
import { defineComponentManifest } from "../../contracts/component-manifest.mjs";
import { validateInstalledApplication } from "../../contracts/installed-application.mjs";
import { INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS } from "../../contracts/intelligence.mjs";

const MAX_AWARE_APPLICATIONS = 128;
const MAX_SEMANTIC_MANIFESTS = 128;
const CONTEXT_BUDGET = Math.min(7600, INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS);

function firstPartyComponent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("First-party application awareness source must be an app object");
  }
  const component = defineComponentManifest(value.component);
  if (component.kind !== "app" || component.id !== value.id || component.title !== value.title) {
    throw new TypeError("First-party application awareness source does not match its component identity");
  }
  return component;
}

function firstPartyAwareness(component) {
  return validateApplicationIntelligenceAwareness({
    schema: APPLICATION_INTELLIGENCE_AWARENESS_SCHEMA,
    appId: component.id,
    title: component.title,
    sourceClass: "first-party",
    platform: "ordax",
    publisher: "OrdaX",
    payloadSha256: null,
    compatibilityManaged: false,
    nativeTrust: true,
    knownActionIds: [],
    actionExecutionAuthorized: false,
    modelToolExecutionAuthorized: false,
    provenance: `ordax-first-party-component:${component.id}@${component.version}`,
  });
}

function installedAwareness(value) {
  const app = validateInstalledApplication(value);
  return validateApplicationIntelligenceAwareness({
    schema: APPLICATION_INTELLIGENCE_AWARENESS_SCHEMA,
    appId: app.id,
    title: app.title,
    sourceClass: "installed",
    platform: app.origin.platform,
    publisher: app.origin.publisher,
    payloadSha256: app.origin.payloadSha256,
    compatibilityManaged: true,
    nativeTrust: false,
    knownActionIds: [],
    actionExecutionAuthorized: false,
    modelToolExecutionAuthorized: false,
    provenance: `ordax-installed-application:${app.id}:${app.origin.payloadSha256}`,
  });
}

function exactReference(value) {
  if (typeof value !== "string" || value.includes("\0") || value.length > 240) {
    throw new TypeError("Application Intelligence reference is invalid");
  }
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (!normalized) throw new TypeError("Application Intelligence reference is empty");
  return normalized;
}

function semanticProjection(manifest) {
  if (!manifest) return null;
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

function contextProjection(descriptor, semanticsByAppId) {
  return {
    appId: descriptor.appId,
    title: descriptor.title,
    sourceClass: descriptor.sourceClass,
    platform: descriptor.platform,
    publisher: descriptor.publisher,
    compatibilityManaged: descriptor.compatibilityManaged,
    knownActionIds: [...descriptor.knownActionIds],
    semantics: semanticProjection(semanticsByAppId.get(descriptor.appId) ?? null),
    actionExecutionAuthorized: false,
    modelToolExecutionAuthorized: false,
  };
}

function applicationContextItem(descriptors, semanticsByAppId) {
  const applications = [];
  let omitted = 0;
  for (const descriptor of descriptors) {
    const candidate = contextProjection(descriptor, semanticsByAppId);
    const next = JSON.stringify({
      applications: [...applications, candidate],
      omitted: Math.max(0, descriptors.length - applications.length - 1),
      authority: "none",
      toolExecution: false,
    });
    if (next.length > CONTEXT_BUDGET) {
      omitted = descriptors.length - applications.length;
      break;
    }
    applications.push(candidate);
  }
  const text = JSON.stringify({
    applications,
    omitted,
    authority: "none",
    toolExecution: false,
  });
  if (text.length > CONTEXT_BUDGET) {
    throw new TypeError("Application Intelligence context exceeded its bounded projection");
  }
  return Object.freeze({
    id: "ordax-application-catalog",
    scope: "system",
    text,
    provenance: "ordax-application-intelligence-awareness",
  });
}

function semanticManifestMap(manifests, firstPartyComponents) {
  if (!Array.isArray(manifests) || manifests.length > MAX_SEMANTIC_MANIFESTS) {
    throw new TypeError("Application Intelligence semantic manifests must be a bounded array");
  }
  const components = new Map(firstPartyComponents.map((component) => [component.id, component]));
  const result = new Map();
  for (const candidate of manifests) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TypeError("Application Intelligence semantic manifest must be an object");
    }
    const component = components.get(candidate.appId);
    if (!component) {
      throw new TypeError(`Application Intelligence semantic manifest has no first-party app: ${candidate.appId ?? "unknown"}`);
    }
    if (result.has(component.id)) {
      throw new TypeError(`Application Intelligence semantic manifest is duplicated: ${component.id}`);
    }
    const manifest = validateAppIntelligenceManifest(candidate, {
      appId: component.id,
      appVersion: component.version,
    });
    result.set(component.id, manifest);
  }
  return result;
}

export function createApplicationIntelligenceAwareness({
  firstPartyApplications = [],
  installedApplications = [],
  firstPartyIntelligenceManifests = [],
} = {}) {
  if (!Array.isArray(firstPartyApplications) || !Array.isArray(installedApplications)) {
    throw new TypeError("Application Intelligence awareness sources must be arrays");
  }
  if (firstPartyApplications.length + installedApplications.length > MAX_AWARE_APPLICATIONS) {
    throw new TypeError("Application Intelligence awareness catalog is outside bounds");
  }

  const firstPartyComponents = firstPartyApplications.map(firstPartyComponent);
  const semanticsByAppId = semanticManifestMap(
    firstPartyIntelligenceManifests,
    firstPartyComponents,
  );
  const descriptors = Object.freeze([
    ...firstPartyComponents.map(firstPartyAwareness),
    ...installedApplications.map(installedAwareness),
  ]);
  const byId = new Map();
  const byTitle = new Map();
  for (const descriptor of descriptors) {
    if (byId.has(descriptor.appId)) {
      throw new TypeError(`Application Intelligence app id collision: ${descriptor.appId}`);
    }
    byId.set(descriptor.appId, descriptor);
    const titleKey = descriptor.title.toLocaleLowerCase("en-US");
    const titleMatches = byTitle.get(titleKey) ?? [];
    titleMatches.push(descriptor);
    byTitle.set(titleKey, titleMatches);
  }

  const compiledContextItem = applicationContextItem(descriptors, semanticsByAppId);

  const port = {
    schema: APPLICATION_INTELLIGENCE_AWARENESS_PORT_SCHEMA,
    list() {
      return descriptors;
    },
    get(appId) {
      return byId.get(appId) ?? null;
    },
    resolveExact(reference) {
      const key = exactReference(reference);
      const byStableId = byId.get(key) ?? null;
      if (byStableId) return byStableId;
      const matches = byTitle.get(key) ?? [];
      return matches.length === 1 ? matches[0] : null;
    },
    contextItem() {
      return compiledContextItem;
    },
  };

  assertApplicationIntelligenceAwarenessPort(port);
  return Object.freeze(port);
}
