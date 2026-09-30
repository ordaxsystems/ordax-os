import {
  ACTION_EXECUTOR_SCHEMA,
  assertActionAdapter,
  validateActionReceipt,
  validateAuthorizedActionExecution,
} from "../../contracts/action-executor.mjs";
import { assertActionGateway } from "../../contracts/action-gateway.mjs";

function readClock(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Action Executor clock must return epoch milliseconds");
  }
  return value;
}

export function createPersonalOrdaxActionExecutor({
  actionGateway: actionGatewayValue,
  adapterResolver,
  now = Date.now,
} = {}) {
  const actionGateway = assertActionGateway(actionGatewayValue);
  if (typeof adapterResolver !== "function") {
    throw new TypeError("Action Executor requires an adapter resolver");
  }
  if (typeof now !== "function") {
    throw new TypeError("Action Executor requires a clock function");
  }

  return Object.freeze({
    schema: ACTION_EXECUTOR_SCHEMA,
    async execute(executionValue) {
      const execution = validateAuthorizedActionExecution(executionValue);
      const { request, decision } = execution;

      const freshDecision = actionGateway.decide(request, {
        grantRef: decision.grantRef,
      });
      if (
        freshDecision.decision !== "allow"
        || freshDecision.grantRef !== decision.grantRef
        || freshDecision.workItemId !== decision.workItemId
        || freshDecision.actionId !== decision.actionId
        || freshDecision.effect !== decision.effect
      ) {
        throw new Error("Action authority is no longer valid at execution time");
      }

      const adapter = assertActionAdapter(adapterResolver(request.toolId, request.actionId));
      if (
        adapter.toolId !== request.toolId
        || adapter.actionId !== request.actionId
        || adapter.effect !== request.effect
      ) {
        throw new TypeError("Action Adapter does not match the authorized request");
      }

      const result = await adapter.execute(request);
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new TypeError("Action Adapter must return a bounded result object");
      }

      return validateActionReceipt({
        workItemId: request.workItemId,
        approvalId: request.approvalId,
        toolId: request.toolId,
        actionId: request.actionId,
        effect: request.effect,
        resourceRef: request.resourceRef,
        grantRef: decision.grantRef,
        status: result.status ?? "succeeded",
        summary: result.summary,
        artifactRefs: result.artifactRefs ?? [],
        executedAt: new Date(readClock(now)).toISOString(),
      });
    },
  });
}
