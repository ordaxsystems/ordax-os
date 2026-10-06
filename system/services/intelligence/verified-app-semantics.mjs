import { validateAppIntelligenceManifest } from "../../contracts/app-intelligence-manifest.mjs";
import { validateApplicationActionManifest } from "../../contracts/application-action-manifest.mjs";
import {
  COMPONENT_MANIFEST_SCHEMA,
  defineComponentManifest,
  validateComponentId,
} from "../../contracts/component-manifest.mjs";
import {
  validateComponentSlotResolution,
  validateComponentSlotSourceCommit,
} from "../../contracts/component-slot-source.mjs";
import { assertVerifiedComponentPackageSource } from "../../contracts/verified-component-package-source.mjs";

const MAX_APP_MANIFESTS = 32;
const EXTERNAL_FIRST_PARTY_OWNER = "washingtonmsdj/ordax-apps";
export const EXTERNAL_FIRST_PARTY_SEMANTIC_APP_IDS = Object.freeze(["notes", "studio"]);

function validateAppIds(value) {
  if (!Array.isArray(value) || value.length > MAX_APP_MANIFESTS) {
    throw new TypeError("Verified app semantics appIds must be a bounded array");
  }
  const ids = value.map(validateComponentId);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Verified app semantics appIds must be unique");
  }
  return ids;
}

async function readJsonResponse(response, label) {
  if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
    throw new TypeError(`${label} response is invalid`);
  }
  if (!response.ok) {
    throw new Error(`${label} unavailable: HTTP ${response.status}`);
  }
  if (typeof response.json !== "function") {
    throw new TypeError(`${label} response must implement json()`);
  }
  const value = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} payload must be an object`);
  }
  return value;
}

function validateCurrentMetadata(value, expectedAppId) {
  if (value.componentId !== expectedAppId || value.state !== "current") {
    throw new TypeError("Verified app semantics metadata identity mismatch");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError("Verified app semantics metadata revision is invalid");
  }
  if (value.source === "absent" || value.source === "bundled") {
    if (
      value.version !== null
      || value.sourceCommit !== null
      || value.entrypoint !== null
    ) {
      throw new TypeError("Verified app semantics non-slot metadata is inconsistent");
    }
    return Object.freeze({
      componentId: expectedAppId,
      state: "current",
      source: value.source,
      revision: value.revision,
      version: null,
      sourceCommit: null,
      entrypoint: null,
      pendingHealth: null,
    });
  }
  return validateComponentSlotResolution(value);
}

async function readVerifiedPackageJson({
  appId,
  metadata,
  path,
  packageSource,
  fetchImpl,
  label,
}) {
  const url = packageSource.fileUrl({
    componentId: appId,
    state: "current",
    resolution: metadata,
    path,
  });
  return readJsonResponse(
    await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
    }),
    label,
  );
}


async function readOptionalVerifiedPackageJson({
  appId,
  metadata,
  path,
  packageSource,
  fetchImpl,
  label,
}) {
  const url = packageSource.fileUrl({
    componentId: appId,
    state: "current",
    resolution: metadata,
    path,
  });
  const response = await fetchImpl(url, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
  });
  if (response?.status === 404) return null;
  return readJsonResponse(response, label);
}

function validateExternalAppComponent(value, appId, metadata) {
  if (value?.schema !== COMPONENT_MANIFEST_SCHEMA) {
    throw new TypeError(`Verified external app schema drifted for ${appId}`);
  }
  const component = defineComponentManifest(value);
  if (
    component.id !== appId
    || component.version !== metadata.version
    || component.kind !== "app"
    || component.releaseMode !== "component-slot"
    || component.owner !== EXTERNAL_FIRST_PARTY_OWNER
  ) {
    throw new TypeError(`Verified external app identity drifted for ${appId}`);
  }
  if (
    metadata.entrypoint !== `system/apps/${appId}/src/runtime.mjs`
    && !metadata.entrypoint.startsWith(`system/apps/${appId}/`)
  ) {
    throw new TypeError(`Verified external app entrypoint escaped app ownership: ${appId}`);
  }
  return component;
}

function validateActionIntentBindings(intelligenceManifest, actionManifest) {
  const intents = new Map(
    intelligenceManifest.intents.map((intent) => [intent.id, intent]),
  );
  for (const capability of actionManifest.capabilities) {
    const intent = intents.get(capability.actionId);
    if (!intent) {
      throw new TypeError(
        `Verified Application Action has no matching Intelligence intent: ${capability.actionId}`,
      );
    }
    const intentParameters = new Map(
      intent.parameters.map((parameter) => [parameter.name, parameter]),
    );
    if (
      intentParameters.size !== capability.parameters.length
      || capability.parameters.some((parameter) => !intentParameters.has(parameter.id))
    ) {
      throw new TypeError(
        `Verified Application Action parameters drifted from Intelligence intent: ${capability.actionId}`,
      );
    }
    for (const parameter of capability.parameters) {
      const intentParameter = intentParameters.get(parameter.id);
      if (intentParameter.required !== parameter.required) {
        throw new TypeError(
          `Verified Application Action required flag drifted from Intelligence intent: ${capability.actionId}/${parameter.id}`,
        );
      }
      const compatible = (
        (intentParameter.type === "string"
          && ["string", "enum", "uri", "resource-grant-id"].includes(parameter.type))
        || intentParameter.type === parameter.type
      );
      if (!compatible) {
        throw new TypeError(
          `Verified Application Action parameter type drifted from Intelligence intent: ${capability.actionId}/${parameter.id}`,
        );
      }
    }

    const riskRank = {
      "read-only": 0,
      "local-change": 1,
      "external-effect": 2,
      privileged: 3,
    };
    const minimumRisk = {
      none: 0,
      read: 0,
      write: 1,
      "external-write": 2,
      destructive: 1,
    }[intent.effect];
    if (riskRank[capability.riskClass] < minimumRisk) {
      throw new TypeError(
        `Verified Application Action risk is weaker than Intelligence intent: ${capability.actionId}`,
      );
    }

    const confirmationRank = { none: 0, "policy-gated": 1, always: 2 };
    const minimumConfirmation = {
      none: 0,
      policy: 1,
      explicit: 2,
    }[intent.confirmation];
    if (confirmationRank[capability.confirmation] < minimumConfirmation) {
      throw new TypeError(
        `Verified Application Action confirmation is weaker than Intelligence intent: ${capability.actionId}`,
      );
    }
    if (intent.effect === "destructive" && capability.confirmation !== "always") {
      throw new TypeError(
        `Verified destructive Application Action must always confirm: ${capability.actionId}`,
      );
    }
  }
  return actionManifest;
}

export async function loadVerifiedFirstPartyApplicationSemantics({
  appIds = [],
  source,
  fetchImpl,
} = {}) {
  const ids = validateAppIds(appIds);
  const packageSource = assertVerifiedComponentPackageSource(source);
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Verified app semantics requires fetchImpl()");
  }

  const entries = [];
  for (const appId of ids) {
    const metadata = validateCurrentMetadata(
      await readJsonResponse(
        await fetchImpl(packageSource.metadataUrl(appId, "current"), {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
        }),
        `Verified app semantics metadata for ${appId}`,
      ),
      appId,
    );

    if (metadata.source !== "slot") {
      continue;
    }

    const component = validateExternalAppComponent(
      await readVerifiedPackageJson({
        appId,
        metadata,
        path: `system/apps/${appId}/app.json`,
        packageSource,
        fetchImpl,
        label: `Verified app component manifest for ${appId}`,
      }),
      appId,
      metadata,
    );

    const intelligenceManifest = validateAppIntelligenceManifest(
      await readVerifiedPackageJson({
        appId,
        metadata,
        path: `system/apps/${appId}/ai/manifest.json`,
        packageSource,
        fetchImpl,
        label: `Verified app intelligence manifest for ${appId}`,
      }),
      {
        appId: component.id,
        appVersion: component.version,
      },
    );

    const rawActionManifest = await readOptionalVerifiedPackageJson({
      appId,
      metadata,
      path: `system/apps/${appId}/actions/manifest.json`,
      packageSource,
      fetchImpl,
      label: `Verified app Application Action manifest for ${appId}`,
    });
    const actionManifest = rawActionManifest === null
      ? null
      : validateActionIntentBindings(
          intelligenceManifest,
          validateApplicationActionManifest(rawActionManifest, {
            appId: component.id,
            appVersion: component.version,
          }),
        );

    entries.push(Object.freeze({
      application: Object.freeze({
        id: component.id,
        title: component.title,
        component,
      }),
      intelligenceManifest,
      actionManifest,
      sourceCommit: metadata.sourceCommit,
      revision: metadata.revision,
    }));
  }
  return Object.freeze(entries);
}

function validateVerifiedOverlayEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("Verified app semantics overlay entry is invalid");
  }
  const app = entry.application;
  if (!app || typeof app !== "object" || Array.isArray(app)) {
    throw new TypeError("Verified app semantics overlay application is invalid");
  }
  const id = validateComponentId(app.id);
  if (!EXTERNAL_FIRST_PARTY_SEMANTIC_APP_IDS.includes(id)) {
    throw new TypeError(`Verified app semantics overlay app is not an allowed external first-party app: ${id}`);
  }
  const component = defineComponentManifest(app.component);
  if (
    component.id !== id
    || component.title !== app.title
    || component.kind !== "app"
    || component.releaseMode !== "component-slot"
    || component.owner !== EXTERNAL_FIRST_PARTY_OWNER
  ) {
    throw new TypeError(`Verified app semantics overlay identity drifted for ${id}`);
  }
  const intelligenceManifest = validateAppIntelligenceManifest(entry.intelligenceManifest, {
    appId: component.id,
    appVersion: component.version,
  });
  const actionManifest = entry.actionManifest === null
    ? null
    : validateActionIntentBindings(
        intelligenceManifest,
        validateApplicationActionManifest(entry.actionManifest, {
          appId: component.id,
          appVersion: component.version,
        }),
      );
  const sourceCommit = validateComponentSlotSourceCommit(entry.sourceCommit);
  if (!Number.isSafeInteger(entry.revision) || entry.revision < 0) {
    throw new TypeError(`Verified app semantics overlay revision is invalid for ${id}`);
  }
  return Object.freeze({
    application: Object.freeze({
      id: component.id,
      title: component.title,
      component,
    }),
    intelligenceManifest,
    actionManifest,
    sourceCommit,
    revision: entry.revision,
  });
}

export function overlayVerifiedFirstPartyApplications(baseApplications = [], verifiedEntries = []) {
  if (!Array.isArray(baseApplications) || !Array.isArray(verifiedEntries)) {
    throw new TypeError("Verified app semantics overlay requires arrays");
  }
  const verifiedById = new Map();
  for (const entry of verifiedEntries) {
    const verified = validateVerifiedOverlayEntry(entry);
    const app = verified.application;
    if (verifiedById.has(app.id)) {
      throw new TypeError(`Verified app semantics overlay duplicates app: ${app.id}`);
    }
    verifiedById.set(app.id, app);
  }

  const result = [];
  const seen = new Set();
  for (const app of baseApplications) {
    if (!app || typeof app !== "object" || Array.isArray(app)) {
      throw new TypeError("Verified app semantics base application is invalid");
    }
    const id = validateComponentId(app.id);
    if (seen.has(id)) {
      throw new TypeError(`Verified app semantics base catalog duplicates app: ${id}`);
    }
    seen.add(id);
    result.push(verifiedById.get(id) ?? app);
  }
  for (const [id, app] of verifiedById) {
    if (!seen.has(id)) {
      result.push(app);
      seen.add(id);
    }
  }
  return Object.freeze(result);
}

export async function loadVerifiedFirstPartyIntelligenceManifests(options = {}) {
  const entries = await loadVerifiedFirstPartyApplicationSemantics(options);
  return Object.freeze(entries.map((entry) => entry.intelligenceManifest));
}


export async function loadVerifiedFirstPartyApplicationActionManifests(options = {}) {
  const entries = await loadVerifiedFirstPartyApplicationSemantics(options);
  return Object.freeze(entries.flatMap((entry) => entry.actionManifest === null ? [] : [entry.actionManifest]));
}
