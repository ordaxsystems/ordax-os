import {
  INTELLIGENCE_MAX_CONTEXT_ITEMS,
  INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS,
  INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS,
  INTELLIGENCE_PORT_SCHEMA,
  assertIntelligencePort,
  validateIntelligenceRequest,
} from "../../contracts/intelligence.mjs";
import {
  assertApplicationIntelligenceAwarenessPort,
} from "../../contracts/application-intelligence-awareness.mjs";
import {
  assertApplicationActionCapabilityRegistryPort,
} from "../../contracts/application-action-capability.mjs";
import { assertApplicationSemanticRouter } from "./application-semantic-router.mjs";
import {
  CAPABILITY_DISCOVERY_SCHEMA,
  validateCapabilityDiscoverySnapshot,
} from "../../contracts/capability-discovery.mjs";

const RESERVED_CONTEXT_IDS = new Set([
  "ordax-application-catalog",
  "ordax-application-action-capabilities",
  "ordax-native-capabilities",
]);

function reservedContextId(value) {
  return RESERVED_CONTEXT_IDS.has(value) || value.startsWith("ordax-application-detail:");
}

function validatedSystemContextItem(value, expectedId) {
  const validated = validateIntelligenceRequest({
    prompt: "context-validation",
    context: [value],
    maxTokens: 1,
  }).context[0];
  if (
    validated.id !== expectedId
    || validated.scope !== "system"
    || validated.provenance.length === 0
  ) {
    throw new TypeError(`Application Intelligence context item is invalid: ${expectedId}`);
  }
  return validated;
}

function nativeCapabilityContext(source, verifiedSnapshot = null) {
  if (!source || source.schema !== CAPABILITY_DISCOVERY_SCHEMA ||
      typeof source.snapshot !== "function") {
    throw new TypeError("Aura requires the current Native Capability Fabric");
  }
  const live = verifiedSnapshot ?? validateCapabilityDiscoverySnapshot(source.snapshot());
  // The same read-only catalog powers UI/Personal. App actions already use
  // the existing verified Application Action Registry context, so include
  // ONLY Native actions here, never a duplicated app catalog or grants.
  const actions = live.entries
    .filter(entry => entry.kind === "native-action")
    .map(entry => ({
      id: entry.id,
      actionId: entry.actionId,
      inputSchema: entry.inputSchema,
      riskClass: entry.riskClass,
      confirmation: entry.confirmation,
      availability: entry.availability,
    }));
  if (actions.length === 0) return null;
  const text = JSON.stringify({
    schema: CAPABILITY_DISCOVERY_SCHEMA,
    revision: live.revision,
    revisionScope: live.revisionScope,
    authority: "none",
    toolExecution: false,
    execution: "unavailable",
    note: "Descriptions only: no tools, grants, direct execution, or approval.",
    nativeActions: actions,
  });
  // Omit an oversized advisory context in full; never truncate JSON and
  // never modify the authoritative Fabric snapshot to fit a model budget.
  if (text.length > INTELLIGENCE_MAX_CONTEXT_ITEM_CHARS) return null;
  return validatedSystemContextItem({
    id: "ordax-native-capabilities",
    scope: "system",
    text,
    provenance: "ordax:capability-fabric/native-live",
  }, "ordax-native-capabilities");
}

function appendIfFits(context, item) {
  if (context.length >= INTELLIGENCE_MAX_CONTEXT_ITEMS) return context;
  const usedChars = context.reduce((total, entry) => total + entry.text.length, 0);
  if (usedChars + item.text.length > INTELLIGENCE_MAX_CONTEXT_TOTAL_CHARS) {
    return context;
  }
  return [...context, item];
}

export function createApplicationContextIntelligence({
  intelligencePort,
  awarenessPort,
  actionCapabilityRegistryPort = null,
  semanticRouterPort = null,
  getCapabilityDiscovery = null,
  getApplicationSemanticsGeneration = null,
  withCurrentAppSnapshot = null,
} = {}) {
  const intelligence = assertIntelligencePort(intelligencePort);
  const awareness = assertApplicationIntelligenceAwarenessPort(awarenessPort);
  const capabilities = actionCapabilityRegistryPort === null
    ? null
    : assertApplicationActionCapabilityRegistryPort(actionCapabilityRegistryPort);
  const semanticRouter = semanticRouterPort === null
    ? null
    : assertApplicationSemanticRouter(semanticRouterPort);
  if (getCapabilityDiscovery !== null && typeof getCapabilityDiscovery !== "function") {
    throw new TypeError("Aura Native Capability Fabric resolver must be a function");
  }
  if (getApplicationSemanticsGeneration !== null &&
      typeof getApplicationSemanticsGeneration !== "function") {
    throw new TypeError("Aura verified app semantic generation resolver must be a function");
  }
  if (withCurrentAppSnapshot !== null &&
      (typeof withCurrentAppSnapshot !== "function" ||
        getApplicationSemanticsGeneration === null)) {
    throw new TypeError("Aura CURRENT context scope requires a verified semantic generation owner");
  }
  const readAppGeneration = () => {
    if (getApplicationSemanticsGeneration === null) return null;
    const generation = getApplicationSemanticsGeneration();
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new TypeError("Aura verified app semantic generation is invalid");
    }
    return generation;
  };
  // App and Action descriptions can be withdrawn while the UI is open.
  // Both are read again immediately before inference; never reuse
  // descriptions for removed or superseded verified component slots.
  // Never cache them at composition creation: the signed/current Native slot
  // must still match immediately before creating each inference context.
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot() {
      return intelligence.getSnapshot();
    },
    subscribe(listener) {
      return intelligence.subscribe(listener);
    },
    respond(value, { signal = null, onDelta = null } = {}) {
      // The live verified owner supplies one ephemeral CURRENT view for the
      // synchronous construction of awareness, routes, Actions and Fabric.
      // Inference and completion run outside the scope and recheck live.
      const compose = () => {
      const request = validateIntelligenceRequest(value);
      for (const entry of request.context) {
        if (reservedContextId(entry.id)) {
          throw new TypeError(`Application Intelligence reserved context id cannot be caller supplied: ${entry.id}`);
        }
      }

      // Capture before reading any App awareness, action or routing item.
      // If their verified owner replaces the generation during composition,
      // never send a mixed-generation prompt to the model.
      const appGeneration = readAppGeneration();
      let context = [...request.context];
      const liveAwarenessContext = validatedSystemContextItem(
        awareness.contextItem(),
        "ordax-application-catalog",
      );
      context = appendIfFits(context, liveAwarenessContext);
      const awarenessIncluded = context.length === request.context.length + 1;

      let selectedAppIds = null;
      if (semanticRouter !== null && awarenessIncluded) {
        let routedItems = null;
        if (typeof semanticRouter.route === "function") {
          const routed = semanticRouter.route(request.prompt);
          selectedAppIds = routed.selection.map(({ appId }) => appId);
          routedItems = routed.contextItems;
        } else {
          selectedAppIds = semanticRouter.select(request.prompt).map(({ appId }) => appId);
          routedItems = semanticRouter.contextItemsForPrompt(request.prompt);
        }
        for (const item of routedItems) {
          const validated = validatedSystemContextItem(item, item.id);
          context = appendIfFits(context, validated);
        }
      }

      if (capabilities !== null && awarenessIncluded) {
        if (
          selectedAppIds !== null
          && typeof capabilities.contextItemForApps === "function"
        ) {
          if (selectedAppIds.length > 0) {
            const filteredCapabilityContext = validatedSystemContextItem(
              capabilities.contextItemForApps(selectedAppIds),
              "ordax-application-action-capabilities",
            );
            context = appendIfFits(context, filteredCapabilityContext);
          }
        } else {
          const liveCapabilityContext = validatedSystemContextItem(
            capabilities.contextItem(),
            "ordax-application-action-capabilities",
          );
          context = appendIfFits(context, liveCapabilityContext);
        }
      }

      let fabricFence = null;
      if (getCapabilityDiscovery !== null) {
        // Resolve after composition, read through once per inference. A
        // missing source during first boot simply advertises no Native actions.
        // Invalid source/snapshot rejects; there is no cached fallback.
        const source = getCapabilityDiscovery();
        if (source !== null) {
          if (source.schema !== CAPABILITY_DISCOVERY_SCHEMA ||
              typeof source.snapshot !== "function") {
            throw new TypeError("Aura requires the current Native Capability Fabric");
          }
          const observed = validateCapabilityDiscoverySnapshot(source.snapshot());
          fabricFence = Object.freeze({
            source, revision: observed.revision,
            revisionScope: observed.revisionScope,
          });
          const nativeContext = nativeCapabilityContext(source, observed);
          if (nativeContext !== null) {
            context = appendIfFits(context, nativeContext);
          }
        } else {
          fabricFence = Object.freeze({ source: null });
        }
      }

      // Do not invoke the model while a temporary CURRENT view is pinned.
      // The scope owner verifies the Store AGAIN after composition; only
      // then may this closure subscribe and send the prepared inference.
      return () => {
      // The same Fabric is the action source for Aura, Personal and UI.
      // A Store revocation during inference invalidates that answer, even
      // when its action set is restored A -> B -> A before delivery. Only
      // the Native discovery owner advances this revision; no second ledger.
      let observedRevocation = false;
      let unsubscribeFabric = null;
      if (fabricFence?.source !== null && fabricFence?.source !== undefined &&
          typeof fabricFence.source.subscribe === "function") {
        try {
          // Use the Fabric's already-existing Native Host/Store events,
          // not a second event bus. Event checks are O(1) per streamed
          // token; the authoritative readback still happens at completion.
          unsubscribeFabric = fabricFence.source.subscribe(
            snapshot => {
              if (snapshot.revision !== fabricFence.revision ||
                  snapshot.revisionScope !== fabricFence.revisionScope) {
                observedRevocation = true;
              }
            },
            () => { observedRevocation = true; },
          );
        } catch {
          // A non-subscribable discovery (e.g. first boot without a
          // Native Host) falls back to strict per-delta readback.
          unsubscribeFabric = null;
        }
      }
      const assertSameFabric = (readSnapshot = true) => {
        if (appGeneration !== readAppGeneration()) {
          throw new Error("Aura verified application semantic generation changed during inference");
        }
        if (fabricFence === null) return;
        if (observedRevocation) {
          throw new Error("Aura Native capability context changed during inference");
        }
        const source = getCapabilityDiscovery();
        if (source !== fabricFence.source) {
          throw new Error("Aura Native capability context changed during inference");
        }
        if (source === null || (!readSnapshot && unsubscribeFabric !== null)) return;
        const current = validateCapabilityDiscoverySnapshot(source.snapshot());
        if (current.revision !== fabricFence.revision ||
            current.revisionScope !== fabricFence.revisionScope) {
          throw new Error("Aura Native capability context changed during inference");
        }
      };
      const observedDelta = typeof onDelta === "function"
        ? (...args) => {
            assertSameFabric(false);
            return onDelta(...args);
          }
        : onDelta;
      let pending;
      try {
        // A synchronous provider failure must also detach the per-request
        // observer. No observer is retained after success or cancellation.
        assertSameFabric(true);
        pending = intelligence.respond(validateIntelligenceRequest({
          intent: request.intent,
          prompt: request.prompt,
          context,
          maxTokens: request.maxTokens,
        }), { signal, onDelta: observedDelta });
      } catch (error) {
        unsubscribeFabric?.();
        throw error;
      }
      return Promise.resolve(pending).then(response => {
        assertSameFabric(true);
        return response;
      }).finally(() => unsubscribeFabric?.());
      };
      };
      const invoke = withCurrentAppSnapshot === null
        ? compose() : withCurrentAppSnapshot(compose);
      return invoke();
    },
  });
}
