import {
  validateApplicationActionProposal,
} from "../../contracts/application-action-capability.mjs";
import {
  APPLICATION_ACTION_PREPARATION_REGISTRY_SCHEMA,
  assertApplicationActionCapabilityRegistryForPreparation,
  assertApplicationActionPreparationRegistry,
  validateApplicationActionPreparation,
} from "../../contracts/application-action-preparation.mjs";

const MAX_PREPARATIONS = 256;
const RISK_TO_EFFECT = Object.freeze({
  "read-only": "read",
  "local-change": "write",
  "external-effect": "external-egress",
  privileged: "device-control",
});

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function sameProposal(left, right) {
  return (
    left.appId === right.appId
    && left.actionId === right.actionId
    && left.riskClass === right.riskClass
    && left.confirmation === right.confirmation
    && left.capabilitySha256 === right.capabilitySha256
    && left.capabilityProvenance === right.capabilityProvenance
    && canonicalJson(left.arguments) === canonicalJson(right.arguments)
  );
}

function preparationId(value) {
  if (typeof value !== "string") {
    throw new TypeError("Application action preparation id factory must return text");
  }
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9._-]{0,159}$/.test(normalized)) {
    throw new TypeError("Application action preparation id factory returned invalid id");
  }
  return normalized;
}

export function createApplicationActionPreparationRegistry({
  capabilityRegistry: capabilityRegistryValue,
  createPreparationId = () => {
    throw new Error("Application action preparation id factory is required");
  },
  maxPreparations = MAX_PREPARATIONS,
} = {}) {
  const capabilityRegistry = assertApplicationActionCapabilityRegistryForPreparation(
    capabilityRegistryValue,
  );
  if (typeof createPreparationId !== "function") {
    throw new TypeError("Application action preparation id factory must be a function");
  }
  if (
    !Number.isSafeInteger(maxPreparations)
    || maxPreparations < 1
    || maxPreparations > MAX_PREPARATIONS
  ) {
    throw new TypeError("Application action preparation capacity is outside bounds");
  }

  const byRef = new Map();
  const refsByWork = new Map();

  const port = {
    schema: APPLICATION_ACTION_PREPARATION_REGISTRY_SCHEMA,
    prepare(workItemId, proposalValue) {
      if (byRef.size >= maxPreparations) {
        throw new Error("Application action preparation registry is full");
      }
      const proposal = validateApplicationActionProposal(proposalValue);
      const capability = capabilityRegistry.get(proposal.appId, proposal.actionId);
      if (!capability) {
        throw new Error("Application action proposal capability is no longer available");
      }
      if (
        capability.provider.kind !== "first-party-native"
        || capability.binding.payloadSha256 !== null
      ) {
        throw new Error("Application action preparation only supports verified first-party providers");
      }

      const currentProposal = capabilityRegistry.propose(
        proposal.appId,
        proposal.actionId,
        proposal.arguments,
      );
      if (!sameProposal(proposal, currentProposal)) {
        throw new Error("Application action proposal is stale or no longer matches capability");
      }

      const id = preparationId(createPreparationId());
      const resourceRef = `application-action:${id}`;
      if (byRef.has(resourceRef)) {
        throw new Error("Duplicate Application action preparation id");
      }
      const preparation = validateApplicationActionPreparation({
        schema: "ordax.application-action-preparation/1",
        preparationId: id,
        resourceRef,
        workItemId,
        proposal,
        provider: capability.provider,
        effect: RISK_TO_EFFECT[capability.riskClass],
        authority: "none",
        executionAuthorized: false,
        modelDirectExecutionAuthorized: false,
      });

      byRef.set(resourceRef, preparation);
      const refs = refsByWork.get(preparation.workItemId) ?? [];
      refs.push(resourceRef);
      refsByWork.set(preparation.workItemId, refs);
      return preparation;
    },
    resolve(resourceRef) {
      if (typeof resourceRef !== "string") return null;
      return byRef.get(resourceRef) ?? null;
    },
    revoke(resourceRef) {
      if (typeof resourceRef !== "string") return false;
      const preparation = byRef.get(resourceRef);
      if (!preparation) return false;
      byRef.delete(resourceRef);
      const refs = refsByWork.get(preparation.workItemId) ?? [];
      const next = refs.filter((value) => value !== resourceRef);
      if (next.length === 0) refsByWork.delete(preparation.workItemId);
      else refsByWork.set(preparation.workItemId, next);
      return true;
    },
    listForWork(workItemId) {
      if (typeof workItemId !== "string") return Object.freeze([]);
      const refs = refsByWork.get(workItemId) ?? [];
      return Object.freeze(
        refs.map((resourceRef) => byRef.get(resourceRef)).filter(Boolean),
      );
    },
  };

  assertApplicationActionPreparationRegistry(port);
  return Object.freeze(port);
}
