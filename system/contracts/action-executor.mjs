import {
  ACTION_REQUEST_SCHEMA,
  validateActionRequest,
} from "./action-gateway.mjs";
import { validatePersonalActionDecision } from "./personal-ordax.mjs";

export const ACTION_EXECUTOR_SCHEMA = "ordax.action-executor/1";
export const AUTHORIZED_ACTION_EXECUTION_SCHEMA = "ordax.authorized-action-execution/1";

export function validateAuthorizedActionExecution(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Authorized action execution must be an object");
  }
  if (
    value.schema !== undefined
    && value.schema !== AUTHORIZED_ACTION_EXECUTION_SCHEMA
  ) {
    throw new TypeError("Authorized action execution schema is incompatible");
  }

  const request = validateActionRequest({
    ...value.request,
    schema: ACTION_REQUEST_SCHEMA,
  });
  const decision = validatePersonalActionDecision(value.decision);

  if (decision.decision !== "allow") {
    throw new TypeError("Action executor requires an allow decision");
  }
  if (
    decision.workItemId !== request.workItemId
    || decision.actionId !== request.actionId
    || decision.effect !== request.effect
  ) {
    throw new TypeError("Action executor decision does not match the action request");
  }
  if (
    request.effect !== "read"
    && (decision.grantRef === null || decision.grantRef === "")
  ) {
    throw new TypeError("Sensitive action execution requires an explicit grant reference");
  }

  return Object.freeze({
    schema: AUTHORIZED_ACTION_EXECUTION_SCHEMA,
    request,
    decision,
  });
}

export function assertActionExecutor(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== ACTION_EXECUTOR_SCHEMA
    || typeof value.execute !== "function"
  ) {
    throw new TypeError("A compatible Action Executor is required");
  }
  return value;
}
