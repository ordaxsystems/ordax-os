import { createNativePersonalOrdaxStore } from "../../adapters/native/personal-ordax.mjs";
import { NATIVE_FILE_ACTION_TOOL_ID } from "../../adapters/native/personal-ordax-file-actions.mjs";
import {
  CAPABILITY_DISCOVERY_SCHEMA,
  validateCapabilityDiscoverySnapshot,
} from "../../contracts/capability-discovery.mjs";
import {
  assertIntelligenceToolGrantIssuer,
  assertIntelligenceToolGrantRegistry,
} from "../../contracts/intelligence-tool-grant-authority.mjs";
import { assertActionAdapter } from "../../contracts/action-executor.mjs";
import { assertPersonalActionCatalog } from "../../contracts/personal-action-catalog.mjs";
import {
  APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA,
} from "../../contracts/application-action-provider-binding.mjs";
import { validatePersonalActionProposal } from "../../contracts/personal-action-proposal.mjs";
import { validatePersonalWorkRecoverySuggestion } from "../../contracts/personal-work-recovery-suggestion.mjs";
import { createIntelligenceToolGrantAuthority } from "../../services/intelligence/tool-grants.mjs";
import { createApplicationActionPreparationRegistry } from "../../services/personal-ordax/application-action-preparations.mjs";
import {
  createApplicationActionProviderResolver,
} from "../../services/personal-ordax/application-action-provider-bindings.mjs";
import {
  createApplicationActionProviderArtifactResolver,
} from "../../services/personal-ordax/application-action-provider-artifact-resolver.mjs";
import {
  createApplicationActionProviderActivationBroker,
} from "../../services/personal-ordax/application-action-provider-activation-broker.mjs";
import { createPersonalOrdaxActionExecutor, PersonalActionExecutionError } from "../../services/personal-ordax/action-executor.mjs";
import { createPersonalOrdaxActionGateway } from "../../services/personal-ordax/action-gateway.mjs";
import { createPersonalApprovalConsent } from "../../services/personal-ordax/approval-consent.mjs";
import { createPersonalActionProposalPlanner } from "../../services/personal-ordax/proposal-planner.mjs";
import { createApplicationActionProposalPlanner } from "../../services/personal-ordax/application-action-proposal-planner.mjs";
import { createPersonalWorkRecoveryPlanner } from "../../services/personal-ordax/work-recovery.mjs";
import { createPersonalOrdaxRuntime } from "../../services/personal-ordax/runtime.mjs";

export function createNativePersonalOrdaxComposition({
  windowRef = globalThis.window,
  identitySession,
  spaceSelection = null,
  projects = null,
  intelligence,
  toolResolver = () => null,
  adapterResolver = () => null,
  actionCatalog = null,
  applicationActionCapabilityRegistry = null,
  getCapabilityDiscovery = null,
  applicationSemanticRouter = null,
  resolveVerifiedApplicationSemantics = null,
  verifiedComponentPackageSource = null,
  verifiedComponentFetch = null,
  applicationActionProviderArtifactIdentity = null,
  expectedApplicationActionProviderOwner = null,
  createApplicationActionPreparationId = null,
  grantAuthority = null,
} = {}) {
  if (!windowRef || typeof windowRef !== "object") {
    throw new TypeError("Native Personal OrdaX composition requires a window-like host");
  }
  if (typeof toolResolver !== "function") {
    throw new TypeError("Native Personal OrdaX composition tool resolver must be a function");
  }
  if (typeof adapterResolver !== "function") {
    throw new TypeError("Native Personal OrdaX composition adapter resolver must be a function");
  }
  if (getCapabilityDiscovery !== null && typeof getCapabilityDiscovery !== "function") {
    throw new TypeError("Native capability discovery resolver must be a function or null");
  }
  const artifactInputs = [
    verifiedComponentPackageSource,
    verifiedComponentFetch,
    applicationActionProviderArtifactIdentity,
  ];
  const artifactInputsConfigured = artifactInputs.some((value) => value !== null);
  if (
    artifactInputsConfigured
    && (
      verifiedComponentPackageSource === null
      || typeof verifiedComponentFetch !== "function"
      || typeof applicationActionProviderArtifactIdentity !== "function"
    )
  ) {
    throw new TypeError(
      "Native Personal OrdaX provider artifact resolution requires complete read-only dependencies",
    );
  }
  const catalog = actionCatalog === null ? null : assertPersonalActionCatalog(actionCatalog);
  // The current Native file action keeps its canonical tool identity after
  // its registration has been removed. Persisted approvals may outlive the
  // transient catalog; the old resolver must never restore that authority.
  const isManagedNativeToolId = (toolId) => (
    toolId === NATIVE_FILE_ACTION_TOOL_ID ||
    catalog?.list().some(entry => entry.toolId === toolId) === true
  );
  if (
    createApplicationActionPreparationId !== null
    && typeof createApplicationActionPreparationId !== "function"
  ) {
    throw new TypeError("Native Personal OrdaX Application Action preparation id factory must be a function or null");
  }
  const preparationIdFactory = createApplicationActionPreparationId ?? (() => {
    const randomUUID = windowRef.crypto?.randomUUID;
    if (typeof randomUUID !== "function") {
      throw new Error("Native Personal OrdaX Application Action preparation requires Web Crypto randomUUID()");
    }
    return `prep-${randomUUID.call(windowRef.crypto)}`;
  });
  const applicationActionPreparations = applicationActionCapabilityRegistry === null
    ? null
    : createApplicationActionPreparationRegistry({
        capabilityRegistry: applicationActionCapabilityRegistry,
        createPreparationId: preparationIdFactory,
      });
  const applicationActionProviderResolver = (
    applicationActionPreparations !== null
    && resolveVerifiedApplicationSemantics !== null
  )
    ? createApplicationActionProviderResolver({
        preparationRegistry: applicationActionPreparations,
        capabilityRegistry: applicationActionCapabilityRegistry,
        resolveVerifiedSemantics: resolveVerifiedApplicationSemantics,
        expectedOwner: expectedApplicationActionProviderOwner,
      })
    : null;

  const ownsGrantAuthority = grantAuthority === null;
  const authority = grantAuthority ?? createIntelligenceToolGrantAuthority();
  const registry = assertIntelligenceToolGrantRegistry(authority.registry);
  assertIntelligenceToolGrantIssuer(authority.issuer);

  const actionGateway = createPersonalOrdaxActionGateway({
    toolResolver,
    grantResolver: (grantId) => registry.resolve(grantId),
  });
  const actionExecutor = createPersonalOrdaxActionExecutor({
    actionGateway,
    adapterResolver,
    // Only the live Native composition knows its current Fabric revision and
    // owner. The canonical executor invokes this once after resolving the
    // adapter, before entering it. No second executor or grant authority.
    verifyBeforeAdapter(request) {
      if (disposed || !isCurrentNativeDiscoveryApproval(
        request.workItemId, request.approvalId,
      )) return false;
      try {
        const current = runtime.getSnapshot();
        const approval = current.approvals.find(candidate =>
          candidate.id === request.approvalId &&
          candidate.workItemId === request.workItemId,
        );
        if (!approval || approval.status !== "approved" ||
            approval.toolId !== request.toolId ||
            approval.toolArtifactSha256 !== request.toolArtifactSha256 ||
            approval.actionId !== request.actionId ||
            approval.effect !== request.effect ||
            approval.resourceRef !== request.resourceRef) return false;
        // The Fabric revision alone cannot attest a live grant. Reuse the
        // SAME Action Gateway after adapter resolution so silent expiry or
        // revocation is denied even without a Host/Personal event.
        const decision = actionGateway.decide(request, {
          grantRef: approval.grantRef,
        });
        return decision.decision === "allow" &&
          decision.grantRef === approval.grantRef &&
          decision.workItemId === request.workItemId &&
          decision.approvalId === request.approvalId &&
          decision.actionId === request.actionId &&
          decision.effect === request.effect;
      } catch {
        return false;
      }
    },
  });
  const runtime = createPersonalOrdaxRuntime({
    identitySessionPort: identitySession,
    spaceSelectionPort: spaceSelection,
    projectCatalogPort: projects,
    intelligencePort: intelligence,
    actionGatewayPort: actionGateway,
    revokeGrant: (grantId) => authority.issuer.revoke(grantId),
    store: createNativePersonalOrdaxStore(windowRef),
  });
  const proposalPlanner = catalog === null || intelligence === null
    ? null
    : createPersonalActionProposalPlanner({
        intelligencePort: intelligence,
        actionCatalog: catalog,
        getCurrentEntryIds: getCapabilityDiscovery === null
          ? null : () => currentNativeActionIds(),
      });
  const applicationActionProposalPlanner = (
    applicationActionCapabilityRegistry === null
    || applicationSemanticRouter === null
    || intelligence === null
  ) ? null : createApplicationActionProposalPlanner({
    intelligencePort: intelligence,
    capabilityRegistryPort: applicationActionCapabilityRegistry,
    semanticRouterPort: applicationSemanticRouter,
  });
  const workRecoveryPlanner = intelligence === null
    ? null
    : createPersonalWorkRecoveryPlanner({
        intelligencePort: intelligence,
      });
  const proposalBindings = new WeakMap();
  const applicationActionProposalBindings = new WeakMap();
  const recoveryBindings = new WeakMap();
  const applicationActionPreparationBindings = new Map();
  // Ephemeral denial fence for already-requested Native semantic actions.
  // It never stores a grant or replaces the persistent approval lifecycle.
  const nativeDiscoveryApprovalBindings = new Map();

  // Identity, Space and Project owners are the SSOT. This local generation is
  // only a revocation fence for transient, model-suggested objects. It is not
  // persisted, treated as identity, or exposed to Intelligence as authority.
  // A -> B -> A must not resurrect an old inference or previously issued offer.
  let contextGeneration = 0;
  let disposed = false;
  const requireActivePersonal = () => {
    if (disposed) {
      throw new Error("Personal OrdaX composition is disposed");
    }
  };
  const invalidateContext = () => { contextGeneration += 1; };
  const contextUnsubscribers = [
    identitySession.subscribe(invalidateContext),
    spaceSelection?.subscribe(invalidateContext) ?? null,
    projects?.subscribe(invalidateContext) ?? null,
  ].filter((unsubscribe) => typeof unsubscribe === "function");

  const ownerKeyFromSnapshot = (snapshot) => (
    snapshot.ownerKind === "account"
      ? `account:${snapshot.ownerId}`
      : "device"
  );

  const workRevision = (work) => JSON.stringify({
    id: work.id,
    ownerKind: work.ownerKind,
    ownerId: work.ownerId,
    goal: work.goal,
    state: work.state,
    spaceId: work.spaceId,
    projectId: work.projectId,
    pendingApprovalId: work.pendingApprovalId,
    contextRefs: work.contextRefs,
    updatedAt: work.updatedAt,
  });

  const applicationActionWorkContextIsCurrent = (work) => {
    if (!work || ["completed", "failed", "cancelled"].includes(work.state)) return false;
    if (work.spaceId !== null) {
      const selectionSnapshot = spaceSelection?.getSnapshot?.();
      if (
        selectionSnapshot?.state !== "selected"
        || selectionSnapshot.subjectId !== work.ownerId
        || selectionSnapshot.selectedSpace?.id !== work.spaceId
      ) {
        return false;
      }
    }
    if (work.projectId !== null) {
      const projectSnapshot = projects?.getSnapshot?.();
      if (
        !Array.isArray(projectSnapshot?.projects)
        || !projectSnapshot.projects.some((project) => project.id === work.projectId)
      ) {
        return false;
      }
    }
    return true;
  };

  const discoverCurrentCapabilities = () => {
    if (disposed || getCapabilityDiscovery === null) {
      throw new Error("Native Capability Fabric discovery is unavailable");
    }
    const source = getCapabilityDiscovery();
    if (!source || source.schema !== CAPABILITY_DISCOVERY_SCHEMA ||
        typeof source.snapshot !== "function") {
      throw new TypeError("Native Capability Fabric source is not current");
    }
    return validateCapabilityDiscoverySnapshot(source.snapshot());
  };
  const currentApplicationActionIds = () => new Set(
    discoverCurrentCapabilities().entries
      .filter(entry => entry.kind === "application-action")
      .map(entry => entry.id),
  );
  const requireCurrentApplicationAction = (appId, actionId) => {
    if (getCapabilityDiscovery !== null &&
        !currentApplicationActionIds().has("app:" + appId + ":" + actionId)) {
      throw new Error("Native Application Action version is no longer current");
    }
  };

  const currentNativeActionEntries = () => {
    if (disposed || catalog === null) return Object.freeze([]);
    if (getCapabilityDiscovery === null) return catalog.list();
    const snapshot = discoverCurrentCapabilities();
    const source = getCapabilityDiscovery();
    if (typeof source?.isNativeActionRegistered !== "function") {
      throw new TypeError("Current Native action registration verifier is unavailable");
    }
    return Object.freeze(catalog.list().filter(entry =>
      snapshot.entries.some(candidate =>
        candidate.id === "system:action." + entry.id &&
        candidate.kind === "native-action" &&
        candidate.ownerId === entry.toolId &&
        candidate.actionId === entry.actionId) &&
      source.isNativeActionRegistered(entry) === true));
  };
  const currentNativeActionIds = () => new Set(
    currentNativeActionEntries().map(entry => entry.id),
  );

  const requestCurrentNativeApproval = (workItemId, entryId, resourceValue, expectedRevision = null) => {
    requireActivePersonal();
    if (catalog === null) {
      throw new Error("Personal OrdaX action catalog is unavailable");
    }
    if (getCapabilityDiscovery === null) {
      if (expectedRevision !== null) {
        throw new Error("Native capability discovery is unavailable");
      }
      return catalog.request(runtime, workItemId, entryId, { resourceValue });
    }
    const discovery = discoverCurrentCapabilities();
    if (expectedRevision !== null && discovery.revision !== expectedRevision) {
      throw new Error("Native action discovery revision is stale");
    }
    const registration = catalog.list().find(entry => entry.id === entryId);
    const capabilityId = "system:action." + entryId;
    const descriptor = discovery.entries.find(entry =>
      entry.id === capabilityId && entry.kind === "native-action");
    if (!registration || !descriptor ||
        descriptor.ownerId !== registration.toolId ||
        descriptor.actionId !== registration.actionId ||
        getCapabilityDiscovery()?.isNativeActionRegistered?.(registration) !== true) {
      throw new Error("Native action is not in the current canonical registration");
    }
    const work = currentProposalWork(workItemId);
    if (!applicationActionWorkContextIsCurrent(work)) {
      throw new Error("Native action Work scope is no longer current");
    }
    if (nativeDiscoveryApprovalBindings.size >= 1024) {
      throw new Error("Native discovery has too many pending approval fences");
    }
    const ownerKey = ownerKeyFromSnapshot(runtime.getSnapshot());
    const generation = contextGeneration;
    const workAtRequest = workRevision(work);
    const verifyBeforeGrantRequest = () => {
      const now = runtime.getSnapshot();
      const currentWork = now.workItems.find(item => item.id === work.id);
      if (disposed || contextGeneration !== generation ||
          ownerKeyFromSnapshot(now) !== ownerKey || !currentWork ||
          workRevision(currentWork) !== workAtRequest ||
          !applicationActionWorkContextIsCurrent(currentWork)) {
        throw new Error("Native action owner or Work context changed before approval request");
      }
      const current = discoverCurrentCapabilities();
      if (current.revision !== discovery.revision ||
          !current.entries.some(item =>
            item.id === capabilityId && item.kind === "native-action" &&
            item.ownerId === registration.toolId &&
            item.actionId === registration.actionId) ||
          getCapabilityDiscovery()?.isNativeActionRegistered?.(registration) !== true) {
        throw new Error("Native action discovery revision or provider changed before approval request");
      }
    };
    // Resource conversion is part of the existing catalog's request(). It
    // may trigger a synchronous Host/Store event. Pass only a guarded
    // requestApproval method so the canonical runtime cannot mint a stale
    // pending approval after that conversion.
    const requestPort = Object.freeze({
      schema: runtime.schema,
      requestApproval(requestWorkId, requestValue) {
        if (requestWorkId !== work.id ||
            requestValue?.toolId !== registration.toolId ||
            requestValue?.actionId !== registration.actionId ||
            requestValue?.toolArtifactSha256 !== registration.toolArtifactSha256 ||
            requestValue?.effect !== registration.effect) {
          throw new Error("Native action approval request differs from its registered provider");
        }
        verifyBeforeGrantRequest();
        return runtime.requestApproval(requestWorkId, requestValue);
      },
    });
    const approval = catalog.request(requestPort, work.id, registration.id, { resourceValue });
    const after = runtime.getSnapshot();
    if (disposed || contextGeneration !== generation ||
        ownerKeyFromSnapshot(after) !== ownerKey) {
      // The owner-local pending request, if already persisted by the runtime,
      // has NO live Fabric fence and cannot receive a grant after a switch.
      throw new Error("Native action owner or context changed during approval request");
    }
    const latest = discoverCurrentCapabilities();
    if (latest.revision !== discovery.revision) {
      throw new Error("Native action discovery revision changed during approval request");
    }
    nativeDiscoveryApprovalBindings.set(
      JSON.stringify([ownerKey, approval.id]),
      Object.freeze({
        approvalId: approval.id,
        workItemId: work.id,
        capabilityId,
        revision: discovery.revision,
        toolId: registration.toolId,
        actionId: registration.actionId,
        toolArtifactSha256: registration.toolArtifactSha256,
        ownerKey,
        contextGeneration: generation,
      }));
    return approval;
  };

  const isCurrentNativeDiscoveryApproval = (workItemId, approvalId) => {
    const runtimeSnapshot = runtime.getSnapshot();
    const ownerKey = ownerKeyFromSnapshot(runtimeSnapshot);
    // Approval IDs are owner-local; never collapse account A and B into one
    // binding even if both partitions reuse the same ordinal.
    const bindingKey = JSON.stringify([ownerKey, approvalId]);
    const bound = nativeDiscoveryApprovalBindings.get(bindingKey);
    if (!bound) {
      // An old persisted Native approval has no live revision attestation.
      // Deny rather than treating a missing ephemeral fence as a free pass.
      const approval = runtimeSnapshot.approvals.find(item =>
        item.id === approvalId && item.workItemId === workItemId);
      return !(getCapabilityDiscovery !== null && approval &&
        isManagedNativeToolId(approval.toolId));
    }
    if (disposed || bound.workItemId !== workItemId ||
        bound.contextGeneration !== contextGeneration) return false;
    try {
      if (ownerKey !== bound.ownerKey) return false;
      const approval = runtimeSnapshot.approvals.find(item =>
        item.id === approvalId && item.workItemId === workItemId);
      if (!approval || approval.toolId !== bound.toolId ||
          approval.actionId !== bound.actionId ||
          approval.toolArtifactSha256 !== bound.toolArtifactSha256) return false;
      const snapshot = discoverCurrentCapabilities();
      return snapshot.revision === bound.revision &&
        snapshot.entries.some(entry =>
          entry.id === bound.capabilityId && entry.kind === "native-action" &&
          entry.ownerId === bound.toolId && entry.actionId === bound.actionId);
    } catch {
      return false; // Missing or invalid live observations cannot restore approval.
    }
  };

  const reconcileApplicationActionPreparations = (snapshot = runtime.getSnapshot()) => {
    if (disposed || applicationActionPreparations === null) return false;
    const ownerKey = ownerKeyFromSnapshot(snapshot);
    // Reconcile old Work preparations against the same live discovery used
    // by the Native UI. Invalid Store observations revoke rather than
    // retaining a previous provider's preparation.
    let currentActionIds = null;
    let currentCapabilityRevision = null;
    if (getCapabilityDiscovery !== null) {
      try {
        const current = discoverCurrentCapabilities();
        currentCapabilityRevision = current.revision;
        currentActionIds = new Set(current.entries
          .filter(entry => entry.kind === "application-action")
          .map(entry => entry.id));
      } catch {
        currentActionIds = new Set();
      }
    }
    let changed = false;
    for (const [resourceRef, binding] of [...applicationActionPreparationBindings]) {
      const preparation = applicationActionPreparations.resolve(resourceRef);
      if (preparation === null) {
        applicationActionPreparationBindings.delete(resourceRef);
        continue;
      }
      const work = snapshot.workItems.find(
        (candidate) => candidate.id === preparation.workItemId,
      );
      const approval = snapshot.approvals.find(
        (candidate) =>
          candidate.workItemId === preparation.workItemId
          && candidate.resourceRef === resourceRef,
      );
      const attempt = snapshot.attempts.find(
        (candidate) =>
          candidate.workItemId === preparation.workItemId
          && candidate.resourceRef === resourceRef,
      );
      const invalid = (
        binding.ownerKey !== ownerKey
        || binding.contextGeneration !== contextGeneration
        || !applicationActionWorkContextIsCurrent(work)
        || (binding.capabilityRevision !== null &&
            binding.capabilityRevision !== currentCapabilityRevision)
        || (currentActionIds !== null &&
            !currentActionIds.has("app:" + preparation.proposal.appId +
              ":" + preparation.proposal.actionId))
        || ["executed", "revoked", "denied", "cancelled"].includes(approval?.status)
        || ["succeeded", "uncertain"].includes(attempt?.status)
      );
      if (!invalid) continue;
      applicationActionPreparations.revoke(resourceRef);
      applicationActionPreparationBindings.delete(resourceRef);
      changed = true;
    }
    return changed;
  };

  // Reuse the existing Personal runtime event stream. Transient Fabric
  // approval fences are dropped as soon as the authoritative approval is
  // consumed, denied, revoked, or its owner partition disappears.
  const unsubscribeApplicationActionPreparations = runtime.subscribe((snapshot) => {
    reconcileApplicationActionPreparations(snapshot);
    const ownerKey = ownerKeyFromSnapshot(snapshot);
    const stillPending = new Set(snapshot.approvals
      .filter(approval => ["pending", "approved"].includes(approval.status))
      .map(approval => approval.id));
    for (const [key, binding] of nativeDiscoveryApprovalBindings) {
      if (binding.ownerKey === ownerKey &&
          !stillPending.has(binding.approvalId)) {
        nativeDiscoveryApprovalBindings.delete(key);
      }
    }
  });

  const bindProposal = (proposal, work, capabilityRevision = null) => {
    if (proposal === null) return null;
    proposalBindings.set(proposal, Object.freeze({
      ownerKey: ownerKeyFromSnapshot(runtime.getSnapshot()),
      workRevision: workRevision(work),
      contextGeneration,
      capabilityRevision,
    }));
    return proposal;
  };

  const recoverableWorks = (snapshot) => snapshot.workItems.filter((work) => (
    (work.state === "queued" || work.state === "paused")
    && !snapshot.approvals.some((approval) =>
      approval.workItemId === work.id
      && (approval.status === "pending" || approval.status === "approved")
    )
  ));

  const bindRecoverySuggestion = (suggestion, work, ownerKey) => {
    if (suggestion === null) return null;
    recoveryBindings.set(suggestion, Object.freeze({
      ownerKey,
      workRevision: workRevision(work),
      contextGeneration,
    }));
    return suggestion;
  };

  const currentProposalWork = (workItemId) => {
    requireActivePersonal();
    const snapshot = runtime.getSnapshot();
    const work = snapshot.workItems.find((candidate) => candidate.id === workItemId);
    if (!work) {
      throw new Error("Personal OrdaX proposal requires a current owner-bound Work item");
    }
    if (work.state !== "queued" && work.state !== "paused") {
      throw new Error("Personal OrdaX proposal requires queued or paused Work");
    }
    if (snapshot.approvals.some((approval) =>
      approval.workItemId === workItemId
      && (approval.status === "pending" || approval.status === "approved")
    )) {
      throw new Error("Personal OrdaX proposal is blocked while Work has unresolved authority");
    }
    return work;
  };

  const prepareApplicationActionForWork = (workItemId, proposalValue) => {
    requireActivePersonal();
    if (applicationActionPreparations === null) {
      throw new Error("Personal OrdaX Application Action preparation is unavailable");
    }
    reconcileApplicationActionPreparations();
    // A proposal issued before an app update/removal cannot be prepared
    // against a stale boot-time declaration, even without an MCP tool.
    requireCurrentApplicationAction(proposalValue?.appId, proposalValue?.actionId);
    const work = currentProposalWork(workItemId);
    if (!applicationActionWorkContextIsCurrent(work)) {
      throw new Error("Personal OrdaX Application Action Work scope is no longer current");
    }
    // Keep the authority-free preparation tied to the observation BEFORE
    // invoking the existing registry. Its ID factory and registry callbacks
    // can synchronously trigger owner or Store updates.
    const binding = Object.freeze({
      ownerKey: ownerKeyFromSnapshot(runtime.getSnapshot()),
      workRevision: workRevision(work),
      contextGeneration,
      capabilityRevision: getCapabilityDiscovery === null
        ? null : discoverCurrentCapabilities().revision,
    });
    const preparation = applicationActionPreparations.prepare(work.id, proposalValue);
    try {
      const current = runtime.getSnapshot();
      const currentWork = current.workItems.find(item => item.id === work.id);
      if (disposed || ownerKeyFromSnapshot(current) !== binding.ownerKey
        || contextGeneration !== binding.contextGeneration
        || !currentWork || workRevision(currentWork) !== binding.workRevision
        || !applicationActionWorkContextIsCurrent(currentWork)) {
        throw new Error("Personal OrdaX Application Action owner or Work scope changed during preparation");
      }
      if (binding.capabilityRevision !== null) {
        const snapshot = discoverCurrentCapabilities();
        if (snapshot.revision !== binding.capabilityRevision ||
            !snapshot.entries.some(item =>
              item.kind === "application-action" &&
              item.id === "app:" + proposalValue.appId + ":" + proposalValue.actionId)) {
          throw new Error("Personal OrdaX Application Action slot revision changed during preparation");
        }
      }
      applicationActionPreparationBindings.set(preparation.resourceRef, binding);
      return preparation;
    } catch (error) {
      // Revoke the exact newly created reference instead of leaving an
      // unbound preparation that could later become current by accident.
      applicationActionPreparations.revoke(preparation.resourceRef);
      throw error;
    }
  };

  const reconcileApprovedAuthority = () => {
    if (disposed) return false;
    // Host/Store events must withdraw stale app preparations as well as
    // Native grants; both use the existing Work and preparation lifecycles.
    let changed = reconcileApplicationActionPreparations();
    for (const approval of runtime.getSnapshot().approvals) {
      if (approval.status !== "approved") continue;
      // The existing grant reconciler also withdraws Native approvals that
      // lost their source revision. It uses the canonical grant revoker and
      // Work journal: no additional permission system or polling loop.
      const revokedByFabric = !isCurrentNativeDiscoveryApproval(
        approval.workItemId, approval.id,
      );
      const revokedByGrant = approval.grantRef !== null
        && registry.resolve(approval.grantRef) === null;
      if (revokedByFabric || revokedByGrant) {
        runtime.revokeApprovedAction(approval.workItemId, approval.id);
        changed = true;
      }
    }
    return changed;
  };
  reconcileApprovedAuthority();

  const canonicalApprovalConsent = createPersonalApprovalConsent({
    runtime,
    grantIssuer: authority.issuer,
    toolResolver,
  });
  const approvalConsent = Object.freeze({
    ...canonicalApprovalConsent,
    canApprove(workItemId, approvalId) {
      return !disposed && isCurrentNativeDiscoveryApproval(workItemId, approvalId) &&
        canonicalApprovalConsent.canApprove(workItemId, approvalId);
    },
    approve(workItemId, approvalId) {
      requireActivePersonal();
      if (!isCurrentNativeDiscoveryApproval(workItemId, approvalId)) {
        throw new Error("Native semantic action approval was revoked by discovery change");
      }
      return canonicalApprovalConsent.approve(workItemId, approvalId);
    },
  });

  const resolveCurrentApplicationActionProviderBinding = async (resourceRef) => {
    requireActivePersonal();
    if (
      applicationActionPreparations === null
      || applicationActionProviderResolver === null
    ) {
      throw new Error(
        "Personal OrdaX Application Action provider binding is unavailable",
      );
    }
    reconcileApplicationActionPreparations();
    const preparation = applicationActionPreparations.resolve(resourceRef);
    if (preparation === null) {
      throw new Error(
        "Personal OrdaX Application Action preparation is no longer current",
      );
    }
    const preparationBinding = applicationActionPreparationBindings.get(resourceRef);
    if (!preparationBinding) {
      throw new Error(
        "Personal OrdaX Application Action preparation binding is unavailable",
      );
    }

    const resolved = await applicationActionProviderResolver.resolve(resourceRef);

    reconcileApplicationActionPreparations();
    const snapshot = runtime.getSnapshot();
    const currentPreparation = applicationActionPreparations.resolve(resourceRef);
    const currentWork = snapshot.workItems.find(
      (candidate) => candidate.id === preparation.workItemId,
    );
    if (
      currentPreparation !== preparation
      || ownerKeyFromSnapshot(snapshot) !== preparationBinding.ownerKey
      || preparationBinding.contextGeneration !== contextGeneration
      || !currentWork
      || workRevision(currentWork) !== preparationBinding.workRevision
    ) {
      throw new Error(
        "Personal OrdaX Application Action changed during provider binding resolution",
      );
    }
    return resolved;
  };

  const applicationActionProviderBindingPort = applicationActionProviderResolver === null
    ? null
    : Object.freeze({
        schema: APPLICATION_ACTION_PROVIDER_RESOLVER_SCHEMA,
        resolve: resolveCurrentApplicationActionProviderBinding,
      });

  const applicationActionProviderArtifactResolver = (
    applicationActionProviderBindingPort !== null
    && artifactInputsConfigured
  )
    ? createApplicationActionProviderArtifactResolver({
        providerBindingResolver: applicationActionProviderBindingPort,
        resolveVerifiedSemantics: resolveVerifiedApplicationSemantics,
        source: verifiedComponentPackageSource,
        fetchImpl: verifiedComponentFetch,
        artifactIdentity: applicationActionProviderArtifactIdentity,
        expectedOwner: expectedApplicationActionProviderOwner,
      })
    : null;

  const applicationActionProviderActivationBroker = (
    applicationActionProviderArtifactResolver !== null
    && resolveVerifiedApplicationSemantics !== null
  )
    ? createApplicationActionProviderActivationBroker({
        providerArtifactResolver: applicationActionProviderArtifactResolver,
        resolveVerifiedSemantics: resolveVerifiedApplicationSemantics,
        expectedOwner: expectedApplicationActionProviderOwner,
      })
    : null;

  // A provider lookup can cross artifact I/O and multiple source metadata reads.
  // The binding resolver already validates each read, but its callers must also
  // fence the completed result: A -> B -> A or explicit revocation cannot
  // restore a result obtained for an earlier context generation.
  const resolveCurrentProviderState = async (resourceRef, resolver, label) => {
    requireActivePersonal();
    reconcileApplicationActionPreparations();
    const preparation = applicationActionPreparations.resolve(resourceRef);
    if (preparation === null) return null;
    const binding = applicationActionPreparationBindings.get(resourceRef);
    if (!binding || binding.contextGeneration !== contextGeneration) {
      throw new Error("Personal OrdaX provider preparation has no current context binding");
    }
    const generation = contextGeneration;
    const resolved = await resolver.resolve(resourceRef);

    reconcileApplicationActionPreparations();
    const snapshot = runtime.getSnapshot();
    const work = snapshot.workItems.find(
      (candidate) => candidate.id === preparation.workItemId,
    );
    if (
      disposed
      || contextGeneration !== generation
      || applicationActionPreparations.resolve(resourceRef) !== preparation
      || applicationActionPreparationBindings.get(resourceRef) !== binding
      || ownerKeyFromSnapshot(snapshot) !== binding.ownerKey
      || !applicationActionWorkContextIsCurrent(work)
      || workRevision(work) !== binding.workRevision
    ) {
      throw new Error(`Personal OrdaX Application Action context changed during ${label}`);
    }
    return resolved;
  };

  return Object.freeze({
    ...runtime,
    // Native action approvals must originate from the same revision-bound
    // Personal catalog request. Never allow the inherited raw Work method to
    // bypass that binding. Other typed actions retain their canonical path.
    requestApproval(workItemId, requestValue) {
      requireActivePersonal();
      if (getCapabilityDiscovery !== null &&
          isManagedNativeToolId(requestValue?.toolId)) {
        throw new Error("Native catalog approvals require current Native discovery");
      }
      return runtime.requestApproval(workItemId, requestValue);
    },
    resolveApproval(workItemId, approvalId, options = {}) {
      requireActivePersonal();
      // Explicit denial can always cancel stale pending authority. Granting
      // approval requires the live Fabric attestation, never only a grantId.
      if (options?.userDecision !== "deny" &&
          !isCurrentNativeDiscoveryApproval(workItemId, approvalId)) {
        throw new Error("Native semantic action approval was revoked by discovery change");
      }
      return runtime.resolveApproval(workItemId, approvalId, options);
    },
    prepareActionExecution(workItemId, approvalId) {
      requireActivePersonal();
      if (!isCurrentNativeDiscoveryApproval(workItemId, approvalId)) {
        throw new Error("Native semantic action execution was revoked by discovery change");
      }
      return runtime.prepareActionExecution(workItemId, approvalId);
    },
    startActionExecution(workItemId, approvalId) {
      requireActivePersonal();
      if (!isCurrentNativeDiscoveryApproval(workItemId, approvalId)) {
        throw new Error("Native semantic action execution was revoked by discovery change");
      }
      return runtime.startActionExecution(workItemId, approvalId);
    },
    approvalConsent,
    listAvailableActions() {
      return currentNativeActionEntries();
    },
    discoverCapabilities() {
      return discoverCurrentCapabilities();
    },
    requestDiscoveredNativeAction(workItemId, capabilityId, {
      resourceValue, expectedRevision,
    } = {}) {
      // Same approval path used by UI and Aura; discovery never executes.
      if (typeof capabilityId !== "string" ||
          !/^system:action\.[a-z][a-z0-9.-]{0,159}$/.test(capabilityId) ||
          !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw new TypeError("Native action requires a current catalog revision and identity");
      }
      return requestCurrentNativeApproval(
        workItemId, capabilityId.slice("system:action.".length),
        resourceValue, expectedRevision,
      );
    },
    listAvailableApplicationActions(appId = null) {
      if (disposed || applicationActionCapabilityRegistry === null) return Object.freeze([]);
      const declared = appId === null
        ? applicationActionCapabilityRegistry.list()
        : applicationActionCapabilityRegistry.listForApp(appId);
      if (getCapabilityDiscovery === null) return declared;
      const current = currentApplicationActionIds();
      return Object.freeze(declared.filter(item =>
        current.has("app:" + item.appId + ":" + item.actionId)));
    },
    proposeApplicationAction(appId, actionId, argumentsValue = {}) {
      requireActivePersonal();
      if (applicationActionCapabilityRegistry === null) {
        throw new Error("Personal OrdaX Application Action capabilities are unavailable");
      }
      requireCurrentApplicationAction(appId, actionId);
      return applicationActionCapabilityRegistry.propose(appId, actionId, argumentsValue);
    },
    prepareApplicationAction(workItemId, proposalValue) {
      return prepareApplicationActionForWork(workItemId, proposalValue);
    },
    async suggestApplicationActionForWork(workItemId) {
      requireActivePersonal();
      if (applicationActionProposalPlanner === null) {
        throw new Error("Personal OrdaX Application Action model planner is unavailable");
      }
      const before = runtime.getSnapshot();
      const ownerKey = ownerKeyFromSnapshot(before);
      const work = currentProposalWork(workItemId);
      if (!applicationActionWorkContextIsCurrent(work)) {
        throw new Error("Personal OrdaX Application Action Work scope is no longer current");
      }
      const revision = workRevision(work);
      const generation = contextGeneration;
      const capabilityRevision = getCapabilityDiscovery === null
        ? null : discoverCurrentCapabilities().revision;
      const proposal = await applicationActionProposalPlanner.propose(work);
      const after = runtime.getSnapshot();
      if (disposed || contextGeneration !== generation
        || ownerKeyFromSnapshot(after) !== ownerKey) {
        throw new Error("Personal OrdaX Application Action owner changed or context changed during planning");
      }
      const currentWork = currentProposalWork(workItemId);
      if (workRevision(currentWork) !== revision
        || !applicationActionWorkContextIsCurrent(currentWork)) {
        throw new Error("Personal OrdaX Application Action Work scope changed during planning");
      }
      if (capabilityRevision !== null &&
          discoverCurrentCapabilities().revision !== capabilityRevision) {
        throw new Error("Personal OrdaX Application Action slot revision changed during planning");
      }
      if (proposal !== null) {
        applicationActionProposalBindings.set(proposal, Object.freeze({
          ownerKey,
          workRevision: revision,
          contextGeneration: generation,
          capabilityRevision,
        }));
      }
      return proposal;
    },
    prepareSuggestedApplicationAction(workItemId, proposalValue) {
      if (!proposalValue || typeof proposalValue !== "object") {
        throw new TypeError("Personal OrdaX Application Action suggestion must be an issued proposal");
      }
      const binding = applicationActionProposalBindings.get(proposalValue);
      if (!binding) {
        throw new Error("Personal OrdaX Application Action suggestion is not current or issued");
      }
      const work = currentProposalWork(workItemId);
      if (disposed || contextGeneration !== binding.contextGeneration
        || ownerKeyFromSnapshot(runtime.getSnapshot()) !== binding.ownerKey
        || workRevision(work) !== binding.workRevision
        || !applicationActionWorkContextIsCurrent(work)) {
        throw new Error("Personal OrdaX Application Action suggestion scope has changed");
      }
      if (binding.capabilityRevision !== null &&
          discoverCurrentCapabilities().revision !== binding.capabilityRevision) {
        throw new Error("Personal OrdaX Application Action slot revision is stale");
      }
      const prepared = prepareApplicationActionForWork(work.id, proposalValue);
      applicationActionProposalBindings.delete(proposalValue);
      return prepared;
    },
    resolveApplicationActionPreparation(resourceRef) {
      if (disposed || applicationActionPreparations === null) return null;
      reconcileApplicationActionPreparations();
      return applicationActionPreparations.resolve(resourceRef);
    },
    async resolveApplicationActionProviderBinding(resourceRef) {
      return resolveCurrentApplicationActionProviderBinding(resourceRef);
    },
    async resolveApplicationActionProviderArtifact(resourceRef) {
      if (applicationActionProviderArtifactResolver === null) {
        throw new Error(
          "Personal OrdaX Application Action provider artifact resolution is unavailable",
        );
      }
      return resolveCurrentProviderState(
        resourceRef, applicationActionProviderArtifactResolver, "provider artifact resolution",
      );
    },
    async resolveApplicationActionProviderActivation(resourceRef) {
      if (applicationActionProviderActivationBroker === null) {
        throw new Error(
          "Personal OrdaX Application Action provider activation is unavailable",
        );
      }
      return resolveCurrentProviderState(
        resourceRef, applicationActionProviderActivationBroker, "provider activation resolution",
      );
    },
    revokeApplicationActionPreparation(resourceRef) {
      if (disposed || applicationActionPreparations === null) return false;
      const revoked = applicationActionPreparations.revoke(resourceRef);
      applicationActionPreparationBindings.delete(resourceRef);
      return revoked;
    },
    listApplicationActionPreparations(workItemId) {
      if (disposed || applicationActionPreparations === null) return Object.freeze([]);
      reconcileApplicationActionPreparations();
      return applicationActionPreparations.listForWork(workItemId);
    },
    proposeAvailableAction(workItemId, entryId, input) {
      requireActivePersonal();
      if (catalog === null) {
        throw new Error("Personal OrdaX action catalog is unavailable");
      }
      const capabilityRevision = getCapabilityDiscovery === null
        ? null : discoverCurrentCapabilities().revision;
      if (getCapabilityDiscovery !== null && !currentNativeActionIds().has(entryId)) {
        throw new Error("Native action is no longer current");
      }
      const work = currentProposalWork(workItemId);
      return bindProposal(
        catalog.propose(work.id, entryId, input), work, capabilityRevision,
      );
    },
    async proposeActionForWork(workItemId) {
      requireActivePersonal();
      if (proposalPlanner === null) {
        throw new Error("Personal OrdaX action proposal planner is unavailable");
      }
      const before = runtime.getSnapshot();
      const ownerKey = ownerKeyFromSnapshot(before);
      const work = currentProposalWork(workItemId);
      const revision = workRevision(work);
      const generation = contextGeneration;
      const capabilityRevision = getCapabilityDiscovery === null
        ? null : discoverCurrentCapabilities().revision;
      const proposal = await proposalPlanner.propose(work);
      const after = runtime.getSnapshot();
      if (disposed || contextGeneration !== generation
        || ownerKeyFromSnapshot(after) !== ownerKey) {
        throw new Error("Personal OrdaX proposal owner changed or context changed while planning");
      }
      const currentWork = currentProposalWork(workItemId);
      if (workRevision(currentWork) !== revision) {
        throw new Error("Personal OrdaX Work changed while planning");
      }
      if (capabilityRevision !== null &&
          discoverCurrentCapabilities().revision !== capabilityRevision) {
        throw new Error("Personal OrdaX Native capability changed while planning");
      }
      return bindProposal(proposal, currentWork, capabilityRevision);
    },
    requestProposedAction(proposalValue) {
      requireActivePersonal();
      if (catalog === null) {
        throw new Error("Personal OrdaX action catalog is unavailable");
      }
      if (!proposalValue || typeof proposalValue !== "object") {
        throw new TypeError("Personal OrdaX proposal must be an issued proposal object");
      }
      const binding = proposalBindings.get(proposalValue);
      if (!binding) {
        throw new Error("Personal OrdaX proposal binding is unavailable");
      }
      const proposal = validatePersonalActionProposal(proposalValue);
      const snapshot = runtime.getSnapshot();
      if (disposed || contextGeneration !== binding.contextGeneration
        || ownerKeyFromSnapshot(snapshot) !== binding.ownerKey) {
        throw new Error("Personal OrdaX proposal belongs to a different owner or context");
      }
      const work = currentProposalWork(proposal.workItemId);
      if (workRevision(work) !== binding.workRevision) {
        throw new Error("Personal OrdaX proposal Work revision is stale");
      }
      const approval = requestCurrentNativeApproval(
        work.id, proposal.entryId, proposal.resourceValue, binding.capabilityRevision,
      );
      proposalBindings.delete(proposalValue);
      return approval;
    },
    async recoverWorkForRequest(request) {
      requireActivePersonal();
      if (workRecoveryPlanner === null) {
        throw new Error("Personal OrdaX Work recovery planner is unavailable");
      }
      const before = runtime.getSnapshot();
      const ownerKey = ownerKeyFromSnapshot(before);
      const candidates = recoverableWorks(before);
      const generation = contextGeneration;
      const revisions = new Map(
        candidates.map((work) => [work.id, workRevision(work)]),
      );
      const suggestion = await workRecoveryPlanner.suggest(request, candidates);
      const after = runtime.getSnapshot();
      if (disposed || contextGeneration !== generation
        || ownerKeyFromSnapshot(after) !== ownerKey) {
        throw new Error("Personal OrdaX Work recovery owner changed or context changed while matching");
      }
      if (suggestion === null) return null;
      const work = recoverableWorks(after).find(
        (candidate) => candidate.id === suggestion.workItemId,
      );
      if (!work || workRevision(work) !== revisions.get(work.id)) {
        throw new Error("Personal OrdaX Work changed while matching");
      }
      return bindRecoverySuggestion(suggestion, work, ownerKey);
    },
    acceptRecoveredWork(suggestionValue) {
      if (!suggestionValue || typeof suggestionValue !== "object") {
        throw new TypeError("Personal OrdaX recovery requires an issued suggestion object");
      }
      const binding = recoveryBindings.get(suggestionValue);
      if (!binding) {
        throw new Error("Personal OrdaX Work recovery binding is unavailable");
      }
      const suggestion = validatePersonalWorkRecoverySuggestion(suggestionValue);
      const snapshot = runtime.getSnapshot();
      if (disposed || contextGeneration !== binding.contextGeneration
        || ownerKeyFromSnapshot(snapshot) !== binding.ownerKey) {
        throw new Error("Personal OrdaX Work recovery belongs to a different owner or context");
      }
      const work = recoverableWorks(snapshot).find(
        (candidate) => candidate.id === suggestion.workItemId,
      );
      if (!work || workRevision(work) !== binding.workRevision) {
        throw new Error("Personal OrdaX Work recovery suggestion is stale");
      }
      const accepted = work.state === "paused"
        ? runtime.resume(work.id)
        : work;
      recoveryBindings.delete(suggestionValue);
      return accepted;
    },
    requestAvailableAction(workItemId, entryId, input) {
      return requestCurrentNativeApproval(
        workItemId, entryId, input?.resourceValue,
      );
    },
    reconcileApprovedAuthority() {
      return reconcileApprovedAuthority();
    },
    canExecuteApprovedAction(workItemId, approvalId) {
      if (disposed) return false;
      reconcileApprovedAuthority();
      if (!isCurrentNativeDiscoveryApproval(workItemId, approvalId)) return false;
      const snapshot = runtime.getSnapshot();
      const work = snapshot.workItems.find((candidate) => candidate.id === workItemId);
      const approval = snapshot.approvals.find((candidate) =>
        candidate.id === approvalId && candidate.workItemId === workItemId
      );
      if (!work || work.state !== "queued" || !approval || approval.status !== "approved") {
        return false;
      }
      if (
        approval.grantRef !== null
        && registry.resolve(approval.grantRef) === null
      ) {
        return false;
      }
      try {
        const adapter = assertActionAdapter(
          adapterResolver(approval.toolId, approval.actionId),
        );
        return adapter.toolId === approval.toolId
          && adapter.artifactSha256 === approval.toolArtifactSha256
          && adapter.actionId === approval.actionId
          && adapter.effect === approval.effect;
      } catch {
        return false;
      }
    },
    async executeApprovedAction(workItemId, approvalId) {
      requireActivePersonal();
      reconcileApprovedAuthority();
      if (!isCurrentNativeDiscoveryApproval(workItemId, approvalId)) {
        const approval = runtime.getSnapshot().approvals.find(item =>
          item.id === approvalId && item.workItemId === workItemId);
        if (approval?.status === "approved") {
          runtime.revokeApprovedAction(workItemId, approvalId);
        }
        throw new Error("Native semantic action execution was revoked by discovery change");
      }
      const execution = runtime.startActionExecution(workItemId, approvalId);
      // startActionExecution persists "started" and synchronously publishes a
      // Work event. A listener may withdraw the verified provider or change
      // Owner during that event. Check the same live Fabric fence again before
      // entering the typed adapter, not only before starting or after receipt.
      if (disposed || !isCurrentNativeDiscoveryApproval(workItemId, approvalId)) {
        if (!disposed) {
          try {
            // The adapter has NOT been entered; this is a known pre-effect
            // denial, unlike a transport failure after a real side effect.
            runtime.failActionExecution(
              workItemId, approvalId,
              "Native authority changed after attempt persistence but before adapter entry.",
              { uncertain: false },
            );
          } catch {
            // Account or provider callbacks may have already revoked the
            // attempt and recorded a more conservative uncertain outcome.
          }
          try {
            reconcileApprovedAuthority();
          } catch {
            // A failed source read must not authorize the typed adapter.
          }
        }
        throw new Error("Native action authority changed before adapter entry");
      }
      let receipt;
      try {
        receipt = await actionExecutor.execute(execution);
      } catch (error) {
        try {
          const preSideEffect = error instanceof PersonalActionExecutionError
            && error.phase === "pre-side-effect";
          runtime.failActionExecution(
            workItemId,
            approvalId,
            preSideEffect
              ? "Foreground action failed before entering the typed adapter."
              : "Foreground action entered the typed adapter but no verified receipt committed.",
            { uncertain: !preSideEffect },
          );
        } catch {
          // Owner/context changes may already have paused the original partition.
        }
        if (error instanceof PersonalActionExecutionError &&
            error.phase === "pre-side-effect") {
          try {
            reconcileApprovedAuthority();
          } catch {
            // Any unavailable discovery source still blocks dispatch.
          }
        }
        throw error;
      }
      if (receipt.status !== "succeeded") {
        try {
          runtime.failActionExecution(
            workItemId,
            approvalId,
            receipt.summary,
            { uncertain: true },
          );
        } catch {
          // Preserve the original receipt failure if the owner/context already changed.
        }
        throw new Error("Personal OrdaX action did not produce a succeeded receipt");
      }
      // The typed adapter can commit a physical side effect while its HTTP
      // reply is still in flight. A removed/replaced provider or a Surface
      // teardown must not convert that reply into a succeeded durable attempt
      // under stale authority. Keep the existing uncertain recovery path;
      // never replay an already-entered action.
      if (disposed || !isCurrentNativeDiscoveryApproval(workItemId, approvalId)) {
        if (!disposed) {
          try {
            reconcileApprovedAuthority();
          } catch {
            // The read-through authority check already failed closed.
          }
          try {
            runtime.failActionExecution(
              workItemId, approvalId,
              "Native provider or owner changed after the action entered its adapter; outcome is uncertain.",
              { uncertain: true },
            );
          } catch {
            // Revocation, owner switching, or an earlier failure may already
            // have persisted an uncertain attempt in the canonical journal.
          }
        }
        throw new Error("Native action authority changed before receipt commit; outcome is uncertain");
      }
      try {
        return runtime.finishActionExecution(workItemId, approvalId, receipt);
      } catch (error) {
        try {
          runtime.failActionExecution(
            workItemId,
            approvalId,
            "Foreground action produced a side effect receipt that could not be committed.",
            { uncertain: true },
          );
        } catch {
          // A switched owner cannot commit into the previous owner partition.
        }
        throw error;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of contextUnsubscribers) unsubscribe();
      unsubscribeApplicationActionPreparations();
      for (const resourceRef of [...applicationActionPreparationBindings.keys()]) {
        applicationActionPreparations?.revoke(resourceRef);
      }
      applicationActionPreparationBindings.clear();
      nativeDiscoveryApprovalBindings.clear();
      runtime.dispose();
      if (ownsGrantAuthority) authority.dispose();
    },
  });
}
