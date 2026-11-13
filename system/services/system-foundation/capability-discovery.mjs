import {
  CAPABILITY_DISCOVERY_SCHEMA,
  validateCapabilityDiscoverySnapshot,
} from "../../contracts/capability-discovery.mjs";
import {
  SYSTEM_CAPABILITY_STATE_SCHEMA,
  SYSTEM_FOUNDATION_SCHEMA,
  validateSystemCapabilityState,
} from "../../contracts/system-foundation.mjs";
import {
  SURFACE_HOST_SCHEMA,
  validateSurfaceSnapshot,
} from "../../contracts/surface-host.mjs";
import {
  assertApplicationActionCapabilityRegistryPort,
  validateApplicationActionCapability,
} from "../../contracts/application-action-capability.mjs";
import {
  readPersonalActionCatalogEntries,
  validatePersonalActionEntry,
} from "../../contracts/personal-action-catalog.mjs";

// Read-only projection; the System Foundation and verified app-action registry
// remain the ONLY authorities for their respective source metadata.
const MAX_ENTRIES = 1024;

function frozen(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) frozen(entry);
    Object.freeze(value);
  }
  return value;
}

function parameterSchema(parameter) {
  const type = ["enum", "uri", "resource-grant-id"].includes(parameter.type)
    ? "string" : parameter.type;
  const result = { type };
  if (parameter.maxLength !== null) result.maxLength = parameter.maxLength;
  if (parameter.minimum !== null) result.minimum = parameter.minimum;
  if (parameter.maximum !== null) result.maximum = parameter.maximum;
  if (parameter.values !== null) result.enum = [...parameter.values];
  if (parameter.type === "uri") {
    // The declared schemes are documentation, NOT authorization to fetch.
    result.description = "Declared URI schemes: " + parameter.schemes.join(", ");
  }
  if (parameter.type === "resource-grant-id") {
    result.pattern = "^[a-z][a-z0-9-]{0,127}$";
  }
  return result;
}

function applicationInputSchema(capability) {
  const properties = Object.create(null);
  const required = [];
  for (const parameter of capability.parameters) {
    properties[parameter.id] = parameterSchema(parameter);
    if (parameter.required) required.push(parameter.id);
  }
  // JSON Schema is descriptive only: the Application Action Registry still
  // performs its own exact typed validation when creating a proposal.
  return frozen({
    type: "object",
    properties: { ...properties },
    required,
    additionalProperties: false,
  });
}

function systemEntry(raw) {
  const state = validateSystemCapabilityState(raw);
  return frozen({
    id: "system:" + state.id,
    kind: "system-state",
    ownerId: state.source,
    availability: state.available ? "reported-available" : "unavailable",
    reason: state.reason,
    actionId: null,
    inputSchema: null,
    riskClass: null,
    confirmation: null,
    execution: "unavailable",
    authority: "none",
  });
}

function appEntry(raw) {
  const action = validateApplicationActionCapability(raw);
  return frozen({
    id: "app:" + action.appId + ":" + action.actionId,
    kind: "application-action",
    ownerId: action.appId,
    availability: "declared-only",
    reason: null,
    actionId: action.actionId,
    inputSchema: applicationInputSchema(action),
    riskClass: action.riskClass,
    confirmation: action.confirmation,
    execution: "unavailable",
    authority: "none",
  });
}

const NATIVE_EFFECT_RISK = Object.freeze({
  read: "read-only",
  write: "local-change",
  "external-egress": "external-effect",
  "device-control": "privileged",
});

function nativeActionEntry(raw) {
  const action = validatePersonalActionEntry(raw);
  return frozen({
    id: "system:action." + action.id,
    kind: "native-action",
    ownerId: action.toolId,
    availability: "declared-only",
    reason: null,
    actionId: action.actionId,
    // Descriptive only: the canonical registration validates resourceValue.
    inputSchema: {
      type: "object",
      properties: { "resource-value": { type: "string", maxLength: 8192 } },
      required: ["resource-value"],
      additionalProperties: false,
    },
    riskClass: NATIVE_EFFECT_RISK[action.effect],
    confirmation: "always",
    execution: "unavailable",
    authority: "none",
  });
}

function readSystemCapabilities(foundation, surfaceHost, nativeSource) {
  if (nativeSource) {
    // Native Surface already reports observed host capabilities. Its single
    // SSOT must be reused, never mirrored into an independent Foundation.
    if (!surfaceHost || surfaceHost.schema !== SURFACE_HOST_SCHEMA ||
        typeof surfaceHost.getSnapshot !== "function" ||
        typeof surfaceHost.subscribe !== "function") {
      throw new TypeError("Current Native Surface Host is required");
    }
    return validateSurfaceSnapshot(surfaceHost.getSnapshot()).capabilityIds
      .map(id => ({
        schema: SYSTEM_CAPABILITY_STATE_SCHEMA,
        id,
        available: true,
        source: "surface.native",
        reason: null,
      }));
  }
  if (!foundation || foundation.schema !== SYSTEM_FOUNDATION_SCHEMA ||
      typeof foundation.capabilities?.list !== "function") {
    throw new TypeError("Current System Foundation capability source is required");
  }
  return foundation.capabilities.list();
}

export function createCapabilityDiscovery({
  getFoundation = null,
  getSurfaceHost = null,
  getApplicationActions,
  getNativeActions = null,
  isApplicationActionCurrent = null,
} = {}) {
  if ((typeof getFoundation === "function") ===
        (typeof getSurfaceHost === "function") ||
      (getFoundation !== null && typeof getFoundation !== "function") ||
      (getSurfaceHost !== null && typeof getSurfaceHost !== "function") ||
      typeof getApplicationActions !== "function" ||
      (getNativeActions !== null && typeof getNativeActions !== "function") ||
      (isApplicationActionCurrent !== null &&
        typeof isApplicationActionCurrent !== "function")) {
    throw new TypeError("Capability discovery requires exactly one live system source and app resolver");
  }
  let revision = 0;
  let lastProjection = null;
  const readValidatedSnapshot = () => {
    // Always re-read both sources. A resolver error fails closed; no stale
    // catalog can be served after an app or provider changes.
    const foundation = getFoundation === null ? null : getFoundation();
    const surfaceHost = getSurfaceHost === null ? null : getSurfaceHost();
    const actions = getApplicationActions();
    const nativeCatalog = getNativeActions === null ? null : getNativeActions();
    // A failed provider never falls back to stale capability data.
    const system = readSystemCapabilities(foundation, surfaceHost,
      getSurfaceHost !== null);
    if (actions !== null) assertApplicationActionCapabilityRegistryPort(actions);
    const declared = actions === null ? [] : actions.list();
    const nativeActions = nativeCatalog === null ? [] :
      readPersonalActionCatalogEntries(nativeCatalog);
    // The installed current slot may change after bootstrap. A manifest
    // declared earlier is not current unless the Native verifier still
    // attests the EXACT slot revision/version/source commit. This filter
    // cannot add actions or execution authority, only remove stale ones.
    const app = isApplicationActionCurrent === null ? declared :
      declared.filter(action => isApplicationActionCurrent(
        validateApplicationActionCapability(action)) === true);
    if (!Array.isArray(system) || !Array.isArray(app) ||
        !Array.isArray(nativeActions) ||
        system.length + app.length + nativeActions.length > MAX_ENTRIES) {
      throw new TypeError("Capability discovery exceeds its bounded sources");
    }
    const entries = [...system.map(systemEntry), ...app.map(appEntry),
      ...nativeActions.map(nativeActionEntry)]
      .sort((a, b) => a.id.localeCompare(b.id, "en"));
    const seen = new Set();
    for (const entry of entries) {
      if (seen.has(entry.id)) throw new TypeError("Duplicate discovery identity");
      seen.add(entry.id);
    }
    // Include verified provider identity and payload bindings in the PRIVATE
    // change fingerprint. An app upgrade must change the revision even when
    // its public action title and input schema stay exactly the same.
    const byName = (a, b) => a.localeCompare(b, "en");
    const nextProjection = JSON.stringify({
      entries,
      system: [...system].sort((a, b) => byName(a.id, b.id)),
      app: [...app].sort((a, b) => byName(
        a.appId + ":" + a.actionId, b.appId + ":" + b.actionId)),
      // Include artifact identity privately: replacing a registered native
      // tool invalidates old revision-bound requests even if its labels match.
      native: [...nativeActions].sort((a, b) => byName(a.id, b.id)),
    });
    const changed = nextProjection !== lastProjection;
    if (changed && revision === Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Capability discovery revision exhausted");
    }
    const candidate = validateCapabilityDiscoverySnapshot(frozen({
      schema: CAPABILITY_DISCOVERY_SCHEMA,
      revision: revision + (changed ? 1 : 0),
      revisionScope: "session",
      authority: "none",
      toolExecution: false,
      entries,
    }));
    // Only a fully validated snapshot advances the session cursor.
    if (changed) {
      revision = candidate.revision;
      lastProjection = nextProjection;
    }
    return candidate;
  };
  const snapshot = () => {
    try {
      return readValidatedSnapshot();
    } catch (error) {
      lastProjection = null;
      throw error;
    }
  };
  const changeChecks = new Set();
  const refresh = () => {
    const result = snapshot();
    for (const check of [...changeChecks]) check(result);
    return result;
  };
  return Object.freeze({
    schema: CAPABILITY_DISCOVERY_SCHEMA,
    refresh,
    snapshot,
    get(id) {
      if (typeof id !== "string" || !/^(?:app|system):[a-z0-9.:-]+$/.test(id)) {
        return null;
      }
      return snapshot().entries.find(entry => entry.id === id) ?? null;
    },
    isNativeActionRegistered(candidateValue) {
      if (getNativeActions === null) return false;
      // Identity check only, never execution authority. Compare the private
      // artifact digest so a new provider cannot be routed through old tools.
      const candidate = validatePersonalActionEntry(candidateValue);
      try {
        const current = getNativeActions();
        if (current === null) {
          lastProjection = null;
          return false;
        }
        const entries = readPersonalActionCatalogEntries(current);
        const sameIdentity = entry =>
          entry.id === candidate.id && entry.toolId === candidate.toolId &&
          entry.actionId === candidate.actionId &&
          entry.effect === candidate.effect &&
          entry.resourceScheme === candidate.resourceScheme &&
          entry.inputKind === candidate.inputKind &&
          entry.toolArtifactSha256 === candidate.toolArtifactSha256;
        const matching = entries.some(sameIdentity);
        // The same catalog enumeration can expose a change to a different
        // registered provider even when this candidate still matches. Fence
        // a silent A -> B -> A of the FULL Native projection; otherwise the
        // old session revision could revive without a Host or Store event.
        // Compare against the existing validated fingerprint, not another
        // registry or independent source of Native action authority.
        if (lastProjection !== null) {
          const previous = JSON.parse(lastProjection).native;
          const observed = [...entries].sort((a, b) =>
            a.id.localeCompare(b.id, "en"));
          if (JSON.stringify(previous) !== JSON.stringify(observed)) {
            lastProjection = null;
          }
        }
        return matching;
      } catch (error) {
        lastProjection = null;
        throw error;
      }
    },
    subscribe(listener, onError = null) {
      if (getSurfaceHost === null) {
        throw new TypeError("Capability change subscription requires the live Native Surface Host");
      }
      if (typeof listener !== "function" ||
          (onError !== null && typeof onError !== "function")) {
        throw new TypeError("Capability change listener is invalid");
      }
      const host = getSurfaceHost();
      if (!host || host.schema !== SURFACE_HOST_SCHEMA ||
          typeof host.subscribe !== "function") {
        throw new TypeError("Current Native Surface Host is required");
      }
      // Host and already-existing Store events call the same revision
      // check; never add a polling timer or a second capability ledger.
      let deliveredRevision = snapshot().revision;
      let active = true;
      const check = (readResult = null) => {
        // refresh() iterates a snapshot of listeners. A previous subscriber
        // may synchronously remove this one during page teardown or a Host
        // update; never deliver an already-queued callback after unsubscribe.
        if (!active) return;
        try {
          if (getSurfaceHost() !== host) {
            throw new Error("Native Surface Host identity changed");
          }
          const current = readResult ?? snapshot();
          // The callback may synchronously call refresh() and deliver a
          // newer revision before this invocation returns. Advance the
          // cursor first and never deliver a lower or duplicate revision.
          // The onError path remains responsible for fail-closed recovery
          // if a subscriber throws.
          if (active && current.revision > deliveredRevision) {
            deliveredRevision = current.revision;
            listener(current);
          }
        } catch (error) {
          // A source read can synchronously tear down this subscription.
          // Once removed, neither events nor diagnostics belong to it.
          if (!active) return;
          if (onError === null) throw error;
          onError(error);
        }
      };
      changeChecks.add(check);
      let unsubscribeHost;
      try {
        unsubscribeHost = host.subscribe(() => check());
        // A Store or Host update can land between the initial snapshot
        // and attaching the Native listener. Close that registration gap
        // with one immediate read of the same live sources (no polling).
        check();
      } catch (error) {
        active = false;
        changeChecks.delete(check);
        unsubscribeHost?.();
        throw error;
      }
      return () => {
        if (!active) return;
        active = false;
        changeChecks.delete(check);
        unsubscribeHost?.();
      };
    },
  });
}
