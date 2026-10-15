import {
  SPACE_EXPERIENCE_SCHEMA,
  SPACE_EXPERIENCE_SOURCE_SCHEMA,
  assertSpaceCapabilityProvider,
  validateSpaceCapabilitySnapshot,
} from "../../contracts/space-experience.mjs";
import { validateSpace } from "../../contracts/spaces.mjs";
import {
  SPACE_TYPE_CATALOG,
  getSpaceType,
  getSpaceTypeByProfile,
} from "./type-catalog.mjs";

function resolveDefinition(space) {
  if (space.domain != null && space.subtype != null) {
    return getSpaceType(space.domain, space.subtype);
  }
  return getSpaceTypeByProfile(space.profilePack);
}

function providerMap(providers) {
  if (!Array.isArray(providers) || providers.length > 64) {
    throw new TypeError("Space capability providers must be a bounded array");
  }
  const map = new Map();
  for (const [index, candidate] of providers.entries()) {
    const provider = assertSpaceCapabilityProvider(candidate, `Space capability provider[${index}]`);
    const peers = map.get(provider.capability) ?? [];
    for (const peer of peers) {
      const overlap = provider.spaceTypes.find((typeKey) => peer.spaceTypes.includes(typeKey));
      if (overlap) {
        throw new TypeError(
          `Overlapping Space capability provider ${provider.capability} for ${overlap}`,
        );
      }
    }
    map.set(provider.capability, [...peers, provider]);
  }
  return map;
}

function safeSnapshot(provider, space) {
  try {
    return validateSpaceCapabilitySnapshot(
      provider.getSnapshot(space),
      space.id,
      `Space capability ${provider.capability}`,
    );
  } catch {
    return null;
  }
}

function emptyExperience(space, definition, state) {
  return Object.freeze({
    schema: SPACE_EXPERIENCE_SCHEMA,
    state,
    spaceId: space.id,
    type: definition === null ? null : Object.freeze({
      key: definition.key,
      domain: definition.domain,
      subtype: definition.subtype,
      lifecycle: definition.lifecycle,
    }),
    capabilities: Object.freeze([]),
    navigation: Object.freeze([]),
    widgets: Object.freeze([]),
    spaceCardMetrics: Object.freeze([]),
    auraContext: null,
    resources: definition?.resources ?? Object.freeze([]),
  });
}

export function resolveSpaceType(spaceValue) {
  const space = validateSpace(spaceValue);
  return resolveDefinition(space);
}

export function composeSpaceExperience(spaceValue, providers = []) {
  const space = validateSpace(spaceValue);
  const definition = resolveDefinition(space);
  if (definition === null) return emptyExperience(space, null, "unknown-type");
  // Structured post-MVP verticals are resolvable for contracts/tests but must not
  // publish contextual menus, widgets or Aura until a later promotion changes lifecycle.
  if (definition.lifecycle === "deferred") return emptyExperience(space, definition, "deferred");

  const registry = providerMap(providers);
  const snapshots = new Map();
  const availableCapabilities = [];
  for (const capability of definition.capabilities) {
    const providersForCapability = registry.get(capability) ?? [];
    const provider = providersForCapability.find((candidate) =>
      candidate.spaceTypes.includes(definition.key)
    ) ?? null;
    if (!provider) continue;
    const snapshot = safeSnapshot(provider, space);
    if (snapshot?.state !== "ready") continue;
    snapshots.set(capability, snapshot);
    availableCapabilities.push(capability);
  }
  const available = new Set(availableCapabilities);

  const navigation = Object.freeze(definition.navigation
    .filter((item) => item.capability === null || available.has(item.capability))
    .map((item) => Object.freeze({ ...item })));

  const widgets = [];
  for (const item of definition.dashboard) {
    if (!available.has(item.capability)) continue;
    const snapshot = snapshots.get(item.capability);
    if (!snapshot || !Object.hasOwn(snapshot.metrics, item.id)) continue;
    widgets.push(Object.freeze({
      id: item.id,
      label: item.label,
      capability: item.capability,
      value: snapshot.metrics[item.id],
    }));
  }
  const frozenWidgets = Object.freeze(widgets);
  const widgetById = new Map(frozenWidgets.map((widget) => [widget.id, widget]));
  const spaceCardMetrics = Object.freeze(definition.cardMetrics
    .map((id) => widgetById.get(id) ?? null)
    .filter(Boolean));

  const auraSnapshot = snapshots.get(definition.aura.capability) ?? null;
  const auraFragments = Object.freeze([...snapshots.entries()]
    .filter(([, snapshot]) => snapshot.auraContext !== null)
    .map(([capability, snapshot]) => {
      const { spaceId: _spaceId, ...data } = snapshot.auraContext;
      return Object.freeze({
        capability,
        data: Object.freeze({ ...data }),
      });
    }));
  const auraContext = auraSnapshot === null
    ? null
    : Object.freeze({
        spaceId: space.id,
        domain: definition.domain,
        subtype: definition.subtype,
        capabilities: Object.freeze([...availableCapabilities]),
        fragments: auraFragments,
      });

  return Object.freeze({
    schema: SPACE_EXPERIENCE_SCHEMA,
    state: "ready",
    spaceId: space.id,
    type: Object.freeze({
      key: definition.key,
      domain: definition.domain,
      subtype: definition.subtype,
      lifecycle: definition.lifecycle,
    }),
    capabilities: Object.freeze(availableCapabilities),
    navigation,
    widgets: frozenWidgets,
    spaceCardMetrics,
    auraContext,
    resources: definition.resources,
  });
}

export function createSpaceExperienceSource({ providers = [] } = {}) {
  const registry = [...providerMap(providers).values()].flat();
  const listeners = new Set();
  let disposed = false;
  const unsubscribers = registry.map((provider) => provider.subscribe(() => {
    if (disposed) return;
    for (const listener of [...listeners]) listener();
  }));

  return Object.freeze({
    schema: SPACE_EXPERIENCE_SOURCE_SCHEMA,
    get(space) {
      if (disposed) return emptyExperience(validateSpace(space), resolveDefinition(validateSpace(space)), "unavailable");
      return composeSpaceExperience(space, registry);
    },
    subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("Space experience listener must be a function");
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe?.();
      listeners.clear();
    },
  });
}

export function createStudioProjectIntent(spaceValue, projectId) {
  const space = validateSpace(spaceValue);
  const definition = resolveDefinition(space);
  const projectResource = definition?.resources.find((resource) => resource.kind === "project") ?? null;
  if (
    definition?.key !== "development.software"
    || projectResource?.multiplicity !== "many"
    || projectResource.openWith !== "studio"
    || projectResource.owner !== "space"
  ) {
    throw new Error("Studio project intent requires a Development Space project resource");
  }
  if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 160 || projectId.includes("\0")) {
    throw new TypeError("Project id is invalid");
  }
  return Object.freeze({
    appId: "studio",
    ownership: "space",
    spaceId: space.id,
    projectId: projectId.trim(),
  });
}

export { SPACE_TYPE_CATALOG };
