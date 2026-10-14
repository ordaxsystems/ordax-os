import { validateActionRequest } from "../../contracts/action-gateway.mjs";
import { validateExternalEgressGrant } from "../../contracts/external-egress-grant.mjs";

function sameNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

export function validateExternalEgressGrantForAction({
  grant: grantValue,
  request: requestValue,
  grantRef,
  nowMs,
} = {}) {
  const request = validateActionRequest(requestValue);
  const grant = validateExternalEgressGrant(grantValue);
  if (request.effect !== "external-egress") {
    throw new TypeError("External egress grant can only bind an external-egress action request");
  }
  if (typeof grantRef !== "string" || !grantRef) {
    throw new TypeError("External egress grant binding requires the exact grant reference");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new TypeError("External egress grant binding requires epoch milliseconds");
  }

  const exactScope = grant.grantId === grantRef
    && grant.workItemId === request.workItemId
    && request.approvalId !== null
    && grant.approvalId === request.approvalId
    && grant.toolId === request.toolId
    && grant.toolArtifactSha256 === request.toolArtifactSha256
    && grant.actionId === request.actionId
    && grant.effect === request.effect
    && grant.ownerKind === request.ownerKind
    && sameNullable(grant.ownerId, request.ownerId)
    && sameNullable(grant.spaceId, request.spaceId)
    && sameNullable(grant.projectId, request.projectId)
    && request.resourceRef !== null
    && grant.resourceRef === request.resourceRef;
  if (!exactScope) {
    throw new TypeError("External egress grant does not match the exact authorized action scope");
  }

  const expiry = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= nowMs) {
    throw new TypeError("External egress grant is expired or has an invalid expiry");
  }

  return Object.freeze({ request, grant });
}
