import { createNativePersonalOrdaxStore } from "../../adapters/native/personal-ordax.mjs";
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

  // Identity, Space and Project owners are the SSOT. This local generation is
  // only a revocation fence for transient, model-suggested objects. It is not
  // persisted, treated as identity, or exposed to Intelligence as authority.
  // A -> B -> A must not resurrect an old inference or previously issued offer.
  let contextGeneration = 0;
  let disposed = false;
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

  const reconcileApplicationActionPreparations = (snapshot = runtime.getSnapshot()) => {
    if (applicationActionPreparations === null) return false;
    const ownerKey = ownerKeyFromSnapshot(snapshot);
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

  const unsubscribeApplicationActionPreparations = applicationActionPreparations === null
    ? () => {}
    : runtime.subscribe((snapshot) => {
        reconcileApplicationActionPreparations(snapshot);
      });

  const bindProposal = (proposal, work) => {
    if (proposal === null) return null;
    proposalBindings.set(proposal, Object.freeze({
      ownerKey: ownerKeyFromSnapshot(runtime.getSnapshot()),
      workRevision: workRevision(work),
      contextGeneration,
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
    if (applicationActionPreparations === null) {
      throw new Error("Personal OrdaX Application Action preparation is unavailable");
    }
    reconcileApplicationActionPreparations();
    const work = currentProposalWork(workItemId);
    if (!applicationActionWorkContextIsCurrent(work)) {
      throw new Error("Personal OrdaX Application Action Work scope is no longer current");
    }
    const preparation = applicationActionPreparations.prepare(work.id, proposalValue);
    applicationActionPreparationBindings.set(
      preparation.resourceRef,
      Object.freeze({
        ownerKey: ownerKeyFromSnapshot(runtime.getSnapshot()),
        workRevision: workRevision(work),
        contextGeneration,
      }),
    );
    return preparation;
  };

  const reconcileApprovedAuthority = () => {
    let changed = false;
    for (const approval of runtime.getSnapshot().approvals) {
      if (
        approval.status === "approved"
        && approval.grantRef !== null
        && registry.resolve(approval.grantRef) === null
      ) {
        runtime.revokeApprovedAction(approval.workItemId, approval.id);
        changed = true;
      }
    }
    return changed;
  };
  reconcileApprovedAuthority();

  const approvalConsent = createPersonalApprovalConsent({
    runtime,
    grantIssuer: authority.issuer,
    toolResolver,
  });

  const resolveCurrentApplicationActionProviderBinding = async (resourceRef) => {
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
    if (disposed) {
      throw new Error("Personal OrdaX provider resolution requires an active runtime");
    }
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
    approvalConsent,
    listAvailableActions() {
      return catalog === null ? Object.freeze([]) : catalog.list();
    },
    listAvailableApplicationActions(appId = null) {
      if (applicationActionCapabilityRegistry === null) return Object.freeze([]);
      return appId === null
        ? applicationActionCapabilityRegistry.list()
        : applicationActionCapabilityRegistry.listForApp(appId);
    },
    proposeApplicationAction(appId, actionId, argumentsValue = {}) {
      if (applicationActionCapabilityRegistry === null) {
        throw new Error("Personal OrdaX Application Action capabilities are unavailable");
      }
      return applicationActionCapabilityRegistry.propose(appId, actionId, argumentsValue);
    },
    prepareApplicationAction(workItemId, proposalValue) {
      return prepareApplicationActionForWork(workItemId, proposalValue);
    },
    async suggestApplicationActionForWork(workItemId) {
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
      if (proposal !== null) {
        applicationActionProposalBindings.set(proposal, Object.freeze({
          ownerKey,
          workRevision: revision,
          contextGeneration: generation,
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
      const prepared = prepareApplicationActionForWork(work.id, proposalValue);
      applicationActionProposalBindings.delete(proposalValue);
      return prepared;
    },
    resolveApplicationActionPreparation(resourceRef) {
      if (applicationActionPreparations === null) return null;
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
      if (applicationActionPreparations === null) return false;
      const revoked = applicationActionPreparations.revoke(resourceRef);
      applicationActionPreparationBindings.delete(resourceRef);
      return revoked;
    },
    listApplicationActionPreparations(workItemId) {
      if (applicationActionPreparations === null) return Object.freeze([]);
      reconcileApplicationActionPreparations();
      return applicationActionPreparations.listForWork(workItemId);
    },
    proposeAvailableAction(workItemId, entryId, input) {
      if (catalog === null) {
        throw new Error("Personal OrdaX action catalog is unavailable");
      }
      const work = currentProposalWork(workItemId);
      return bindProposal(catalog.propose(work.id, entryId, input), work);
    },
    async proposeActionForWork(workItemId) {
      if (proposalPlanner === null) {
        throw new Error("Personal OrdaX action proposal planner is unavailable");
      }
      const before = runtime.getSnapshot();
      const ownerKey = ownerKeyFromSnapshot(before);
      const work = currentProposalWork(workItemId);
      const revision = workRevision(work);
      const generation = contextGeneration;
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
      return bindProposal(proposal, currentWork);
    },
    requestProposedAction(proposalValue) {
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
      const approval = catalog.request(runtime, work.id, proposal.entryId, {
        resourceValue: proposal.resourceValue,
      });
      proposalBindings.delete(proposalValue);
      return approval;
    },
    async recoverWorkForRequest(request) {
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
      if (catalog === null) {
        throw new Error("Personal OrdaX action catalog is unavailable");
      }
      return catalog.request(runtime, workItemId, entryId, input);
    },
    reconcileApprovedAuthority() {
      return reconcileApprovedAuthority();
    },
    canExecuteApprovedAction(workItemId, approvalId) {
      reconcileApprovedAuthority();
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
      reconcileApprovedAuthority();
      const execution = runtime.startActionExecution(workItemId, approvalId);
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
      runtime.dispose();
      if (ownsGrantAuthority) authority.dispose();
    },
  });
}
