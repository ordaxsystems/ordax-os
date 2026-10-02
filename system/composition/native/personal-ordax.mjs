import { createNativePersonalOrdaxStore } from "../../adapters/native/personal-ordax.mjs";
import {
  assertIntelligenceToolGrantIssuer,
  assertIntelligenceToolGrantRegistry,
} from "../../contracts/intelligence-tool-grant-authority.mjs";
import { assertActionAdapter } from "../../contracts/action-executor.mjs";
import { assertPersonalActionCatalog } from "../../contracts/personal-action-catalog.mjs";
import { validatePersonalActionProposal } from "../../contracts/personal-action-proposal.mjs";
import { createIntelligenceToolGrantAuthority } from "../../services/intelligence/tool-grants.mjs";
import { createPersonalOrdaxActionExecutor, PersonalActionExecutionError } from "../../services/personal-ordax/action-executor.mjs";
import { createPersonalOrdaxActionGateway } from "../../services/personal-ordax/action-gateway.mjs";
import { createPersonalApprovalConsent } from "../../services/personal-ordax/approval-consent.mjs";
import { createPersonalActionProposalPlanner } from "../../services/personal-ordax/proposal-planner.mjs";
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
  const proposalPlanner = catalog === null
    ? null
    : createPersonalActionProposalPlanner({
        intelligencePort: intelligence,
        actionCatalog: catalog,
      });

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
      return catalog.propose(work.id, entryId, input);
    },
    async proposeActionForWork(workItemId) {
      if (proposalPlanner === null) {
        throw new Error("Personal OrdaX action proposal planner is unavailable");
      }
      const work = currentProposalWork(workItemId);
      return proposalPlanner.propose(work);
    },
    requestProposedAction(proposalValue) {
      if (catalog === null) {
        throw new Error("Personal OrdaX action catalog is unavailable");
      }
      const proposal = validatePersonalActionProposal(proposalValue);
      const work = currentProposalWork(proposal.workItemId);
      return catalog.request(runtime, work.id, proposal.entryId, {
        resourceValue: proposal.resourceValue,
      });
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
