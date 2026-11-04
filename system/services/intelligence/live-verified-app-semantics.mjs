import {
  APPLICATION_INTELLIGENCE_AWARENESS_PORT_SCHEMA,
} from "../../contracts/application-intelligence-awareness.mjs";
import { validateComponentRuntimeMetadata } from "../../contracts/component-runtime-metadata.mjs";
import { hasNativeExternalFirstPartyModuleRead } from "../apps/external-first-party-policy.mjs";
import {
  APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA,
} from "../../contracts/application-action-capability.mjs";
import {
  createCurrentVerifiedActionGate,
} from "../system-foundation/current-verified-action-gate.mjs";
import {
  loadVerifiedFirstPartyApplicationSemantics,
  overlayVerifiedFirstPartyApplications,
} from "./verified-app-semantics.mjs";
import {
  createApplicationIntelligenceAwareness,
} from "./application-awareness.mjs";
import {
  createApplicationActionCapabilityRegistry,
} from "./application-action-capabilities.mjs";
import {
  APPLICATION_SEMANTIC_ROUTER_SCHEMA,
  createApplicationSemanticRouter,
} from "./application-semantic-router.mjs";

/**
 * One live generation of the existing signed Application semantic owners.
 * The stable ports are delegates, not a second registry: every operation
 * reads the currently validated generation. Store CURRENT observations still
 * control availability, and nothing here can mint execution authority.
 */
export function createLiveVerifiedApplicationSemantics({
  initialVerifiedSemantics = [],
  baseApplications = [],
  bundledManifests = [],
  getCurrentObservations,
} = {}) {
  if (typeof getCurrentObservations !== "function") {
    throw new TypeError("Live verified semantics require Native Store observations");
  }
  if (!Array.isArray(initialVerifiedSemantics) ||
      !Array.isArray(baseApplications) || !Array.isArray(bundledManifests)) {
    throw new TypeError("Live verified semantics require bounded verified inputs");
  }
  const compile = (verifiedSemantics) => {
    const gate = createCurrentVerifiedActionGate({
      verifiedSemantics,
      getCurrentObservations,
    });
    const verifiedIds = new Set(verifiedSemantics.map(entry => entry.application.id));
    const current = (appId) => !verifiedIds.has(appId) ||
      gate.isCurrent({ appId });
    const applications = overlayVerifiedFirstPartyApplications(
      baseApplications, verifiedSemantics,
    );
    const manifests = new Map(bundledManifests.map(
      manifest => [manifest.appId, manifest],
    ));
    for (const entry of verifiedSemantics) {
      manifests.set(entry.intelligenceManifest.appId, entry.intelligenceManifest);
    }
    const activeManifests = Object.freeze([...manifests.values()]);
    const awareness = createApplicationIntelligenceAwareness({
      firstPartyApplications: applications,
      firstPartyIntelligenceManifests: activeManifests,
      isContextAppCurrent: current,
    });
    const actions = createApplicationActionCapabilityRegistry({
      awareness,
      capabilities: verifiedSemantics.flatMap(entry =>
        entry.actionManifest?.capabilities ?? []),
      isCurrent: gate.isCurrent,
      isCurrentBatch: gate.isCurrentBatch,
    });
    const router = createApplicationSemanticRouter({
      awareness,
      manifests: activeManifests,
      isManifestCurrent: current,
    });
    return Object.freeze({ gate, awareness, actions, router });
  };

  let active = compile(initialVerifiedSemantics);
  // The epoch belongs to the SAME compiled verified semantic owner. It is
  // not an app inventory or a second action registry: it only fences
  // in-flight Aura responses across A -> B -> A semantic replacements.
  let generation = 1;
  let disposed = false;
  const ensureActive = () => {
    if (disposed) throw new Error("Live verified semantics are disposed");
  };

  const awarenessPort = Object.freeze({
    schema: APPLICATION_INTELLIGENCE_AWARENESS_PORT_SCHEMA,
    list() { ensureActive(); return active.awareness.list(); },
    get(appId) { ensureActive(); return active.awareness.get(appId); },
    resolveExact(reference) {
      ensureActive(); return active.awareness.resolveExact(reference);
    },
    contextItem() { ensureActive(); return active.awareness.contextItem(); },
  });

  const actionRegistryPort = Object.freeze({
    schema: APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA,
    list() { ensureActive(); return active.actions.list(); },
    get(appId, actionId) {
      ensureActive(); return active.actions.get(appId, actionId);
    },
    listForApp(appId) {
      ensureActive(); return active.actions.listForApp(appId);
    },
    propose(appId, actionId, args = {}) {
      ensureActive(); return active.actions.propose(appId, actionId, args);
    },
    contextItem() { ensureActive(); return active.actions.contextItem(); },
    contextItemForApps(ids) {
      ensureActive(); return active.actions.contextItemForApps(ids);
    },
  });

  const semanticRouterPort = Object.freeze({
    schema: APPLICATION_SEMANTIC_ROUTER_SCHEMA,
    route(prompt) { ensureActive(); return active.router.route(prompt); },
    select(prompt) { ensureActive(); return active.router.select(prompt); },
    contextItemsForPrompt(prompt) {
      ensureActive(); return active.router.contextItemsForPrompt(prompt);
    },
  });

  return Object.freeze({
    awarenessPort,
    actionRegistryPort,
    semanticRouterPort,
    getGeneration() {
      ensureActive();
      return generation;
    },
    replaceVerifiedSemantics(next, { attestCurrent = true } = {}) {
      ensureActive();
      if (!Array.isArray(next) || next.length > 32) {
        throw new TypeError("Live semantics update exceeds verified bounds");
      }
      // Skipping CURRENT attestation is only valid to WITHDRAW a generation
      // after the Store becomes unavailable or during an explicit removal.
      // Publishing even one new Aura manifest or action requires CURRENT.
      if (!attestCurrent && next.length !== 0) {
        throw new TypeError("Nonempty semantic publication requires CURRENT attestation");
      }
      const candidate = compile(next);
      if (attestCurrent) {
        // Attest all signed app origins against one atomic Store CURRENT read.
        // Separate reads could mix mutually exclusive slot generations.
        const current = candidate.gate.isCurrentBatch(next.map(entry => ({
          appId: entry.application.id,
        })));
        if (current.some(valid => valid !== true)) {
          throw new Error("Live semantics update lost CURRENT slot attestation");
        }
      }
      // Complete every fallible CURRENT-dependent projection BEFORE the
      // atomic generation swap. The previous form returned list() after
      // commit; a second Native CURRENT read could fail and report rejection
      // even though Aura/Personal had already switched to the new owner.
      const exposedActions = candidate.actions.list();
      // The Store may silently withdraw a slot between the pre-attestation
      // and this final CURRENT-dependent read without throwing. Publishing
      // only a subset would commit Aura/Personal semantics that have not
      // passed the last CURRENT observation. Require the entire signed
      // action declaration to survive the final native projection.
      const declaredActionCount = next.reduce((sum, entry) =>
        sum + (entry.actionManifest?.capabilities?.length ?? 0), 0);
      if (exposedActions.length !== declaredActionCount) {
        throw new Error("Live semantics update lost CURRENT action attestation before publication");
      }
      // Semantic-only apps have no Action declaration to observe in the
      // final action projection. Re-attest their identities directly through
      // the SAME read-through Store gate before publishing Aura manifests.
      const withoutActions = next.filter(entry =>
        (entry.actionManifest?.capabilities?.length ?? 0) === 0);
      if (withoutActions.length > 0 &&
          candidate.gate.isCurrentBatch(withoutActions.map(entry => ({
            appId: entry.application.id,
          }))).some(current => current !== true)) {
        throw new Error("Live semantics update lost CURRENT semantic-only attestation before publication");
      }
      if (generation === Number.MAX_SAFE_INTEGER) {
        throw new RangeError("Verified application semantic generation exhausted");
      }
      active = candidate;
      generation += 1;
      return exposedActions;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  });
}

/**
 * The Store is the only trigger and current-slot observation source.
 * Re-read signed manifests only when a verified CURRENT identity changes.
 * Concurrent or superseded loads can never promote an older generation.
 */
export function createVerifiedSemanticsRefresh({
  liveSemantics,
  getCurrentObservations,
  source,
  fetchImpl,
  initialVerifiedSemantics = [],
  onPublished = () => {},
  onError = () => {},
  load = loadVerifiedFirstPartyApplicationSemantics,
} = {}) {
  if (!liveSemantics || typeof liveSemantics.replaceVerifiedSemantics !== "function" ||
      typeof getCurrentObservations !== "function" || typeof fetchImpl !== "function" ||
      typeof onPublished !== "function" || typeof onError !== "function" ||
      typeof load !== "function" || !Array.isArray(initialVerifiedSemantics) ||
      initialVerifiedSemantics.length > 32) {
    throw new TypeError("Verified semantic refresh requires a live owner, Store, loader and callbacks");
  }
  let generation = 0;
  // Only a PUBLISHED signed generation needs pre-load withdrawal. An
  // initial install (or a load already failed/withdrawn) has no app
  // semantics to revoke and must not emit a spurious success event.
  let hasPublishedSemantics = initialVerifiedSemantics.length > 0;
  // Reuse the already-verified bootstrap package when Store CURRENT reports
  // the exact same slot. Do not read the same signed manifests twice at boot.
  let desiredSignature = initialVerifiedSemantics.length === 0 ? null :
    JSON.stringify(initialVerifiedSemantics.map(entry => [
      entry.application.id,
      entry.application.component.version,
      entry.revision,
      String(entry.sourceCommit).toLowerCase(),
    ]).sort((a, b) => a[0].localeCompare(b[0], "en")));
  let disposed = false;
  return Object.freeze({
    refresh() {
      if (disposed) return;
      let slots;
      try {
        const observed = getCurrentObservations();
        if (!Array.isArray(observed) || observed.length > 128) {
          throw new Error("Verified Native CURRENT observations unavailable");
        }
        // Validate the ENTIRE Store CURRENT publication before filtering by
        // Native module-read policy. A malformed/duplicated unsupported entry
        // must not preserve previously granted semantic descriptions by
        // slipping past the policy filter. Valid unsupported apps still
        // never trigger module fetches or register actions.
        const validated = observed.map(item => validateComponentRuntimeMetadata(item, {
          componentId: item?.componentId, state: "current",
        }));
        if (new Set(validated.map(item => item.componentId)).size !== validated.length) {
          throw new Error("Duplicate verified CURRENT app identity");
        }
        slots = validated
          .filter(item => hasNativeExternalFirstPartyModuleRead(item.componentId))
          .filter(item => item.source === "slot")
          .sort((a, b) => a.componentId.localeCompare(b.componentId, "en"));
      } catch (error) {
        // A malformed or unreadable Store CURRENT publication invalidates
        // even an in-flight signed load: its later reply cannot authorize
        // the previously observed generation after an A -> invalid -> A
        // transition. Withdraw the same semantic ports fail-closed; a
        // later explicit Store event must re-attest its package.
        generation += 1;
        desiredSignature = null;
        try {
          liveSemantics.replaceVerifiedSemantics([], { attestCurrent: false });
          hasPublishedSemantics = false;
          // A malformed Store publication must notify the SAME existing
          // Fabric and Personal subscribers as a normal removal. Otherwise
          // their cached UI can still show actions after these live ports
          // have already withdrawn them.
          onPublished();
        } catch (withdrawalError) {
          onError(withdrawalError);
        }
        onError(error);
        return;
      }
      const signature = JSON.stringify(slots.map(item => [
        item.componentId, item.version, item.revision, item.sourceCommit,
      ]));
      if (signature === desiredSignature) return;
      desiredSignature = signature;
      const currentGeneration = ++generation;
      if (slots.length > 0 && hasPublishedSemantics) {
        // CURRENT changed while the next signed package still needs to be
        // read. Withdraw the previous generation NOW: otherwise a silent
        // A -> B -> A could resurrect old verified semantics without a
        // fresh Store event or signed re-attestation, and an in-flight Aura
        // response would retain the old generation fence.
        try {
          liveSemantics.replaceVerifiedSemantics([], { attestCurrent: false });
          hasPublishedSemantics = false;
          onPublished();
        } catch (error) {
          desiredSignature = null;
          onError(error);
          return;
        }
      }
      const publish = entries => {
        if (disposed || currentGeneration !== generation) return;
        liveSemantics.replaceVerifiedSemantics(entries);
        hasPublishedSemantics = entries.length > 0;
        onPublished();
      };
      if (slots.length === 0) {
        try { publish([]); } catch (error) {
          if (!disposed && currentGeneration === generation) desiredSignature = null;
          onError(error);
        }
        return;
      }
      void Promise.resolve().then(() => load({
        appIds: slots.map(item => item.componentId),
        source,
        fetchImpl,
      })).then(entries => {
        if (disposed || currentGeneration !== generation) return;
        if (!Array.isArray(entries) || entries.length !== slots.length) {
          throw new Error("Verified CURRENT app semantic package count drifted");
        }
        for (let i = 0; i < slots.length; i += 1) {
          const entry = entries.find(item =>
            item?.application?.id === slots[i].componentId);
          if (!entry ||
              entry.application.component.version !== slots[i].version ||
              entry.revision !== slots[i].revision ||
              String(entry.sourceCommit).toLowerCase() !==
                slots[i].sourceCommit.toLowerCase()) {
            throw new Error("Verified CURRENT app semantic identity drifted");
          }
        }
        publish(entries);
      }).catch(error => {
        if (!disposed && currentGeneration === generation) {
          // A failed load must not publish an unverified generation, but the
          // NEXT explicit Store refresh may retry the same signed identity.
          // Never spin/retry automatically while its outcome is unknown.
          desiredSignature = null;
          onError(error);
        }
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
    },
  });
}
