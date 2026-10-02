import { createNativePersonalOrdaxStore } from "../../adapters/native/personal-ordax.mjs";
import {
  assertIntelligenceToolGrantIssuer,
  assertIntelligenceToolGrantRegistry,
} from "../../contracts/intelligence-tool-grant-authority.mjs";
import { assertActionAdapter } from "../../contracts/action-executor.mjs";
import { assertPersonalActionCatalog } from "../../contracts/personal-action-catalog.mjs";
import { validatePersonalActionProposal } from "../../contracts/personal-action-proposal.mjs";
import { validatePersonalWorkRecoverySuggestion } from "../../contracts/personal-work-recovery-suggestion.mjs";
import { createIntelligenceToolGrantAuthority } from "../../services/intelligence/tool-grants.mjs";
import { createPersonalOrdaxActionExecutor, PersonalActionExecutionError } from "../../services/personal-ordax/action-executor.mjs";
import { createPersonalOrdaxActionGateway } from "../../services/personal-ordax/action-gateway.mjs";
import { createPersonalApprovalConsent } from "../../services/personal-ordax/approval-consent.mjs";
import { createPersonalActionProposalPlanner } from "../../services/personal-ordax/proposal-planner.mjs";
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
  const catalog = actionCatalog === null ? null : assertPersonalActionCatalog(actionCatalog);

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
  const workRecoveryPlanner = intelligence === null
    ? null
    : createPersonalWorkRecoveryPlanner({
        intelligencePort: intelligence,
      });
  const proposalBindings = new WeakMap();
  const recoveryBindings = new WeakMap();

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

  const bindProposal = (proposal, work) => {
    if (proposal === null) return null;
    proposalBindings.set(proposal, Object.freeze({
      ownerKey: ownerKeyFromSnapshot(runtime.getSnapshot()),
      workRevision: workRevision(work),
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

  return Object.freeze({
    ...runtime,
    approvalConsent,
    listAvailableActions() {
      return catalog === null ? Object.freeze([]) : catalog.list();
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
      const proposal = await proposalPlanner.propose(work);
      const after = runtime.getSnapshot();
      if (ownerKeyFromSnapshot(after) !== ownerKey) {
        throw new Error("Personal OrdaX proposal owner changed while planning");
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
      if (ownerKeyFromSnapshot(snapshot) !== binding.ownerKey) {
        throw new Error("Personal OrdaX proposal belongs to a different owner");
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
      const revisions = new Map(
        candidates.map((work) => [work.id, workRevision(work)]),
      );
      const suggestion = await workRecoveryPlanner.suggest(request, candidates);
      const after = runtime.getSnapshot();
      if (ownerKeyFromSnapshot(after) !== ownerKey) {
        throw new Error("Personal OrdaX Work recovery owner changed while matching");
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
      if (ownerKeyFromSnapshot(snapshot) !== binding.ownerKey) {
        throw new Error("Personal OrdaX Work recovery belongs to a different owner");
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
      runtime.dispose();
      if (ownsGrantAuthority) authority.dispose();
    },
  });
}
