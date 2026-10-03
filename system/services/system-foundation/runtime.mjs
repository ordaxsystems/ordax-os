import {
  SYSTEM_CAPABILITY_STATE_SCHEMA,
  SYSTEM_EVENT_SCHEMA,
  SYSTEM_FOUNDATION_SCHEMA,
  SYSTEM_POLICY_DECISION_SCHEMA,
  validateSystemCapabilityState,
  validateSystemEvent,
  validateSystemPolicyDecision,
  validateSystemServiceDescriptor,
} from "../../contracts/system-foundation.mjs";

const POLICY_RANK = Object.freeze({ pass: 0, "require-approval": 1, deny: 2 });

function cloneMapValues(map) {
  return Object.freeze([...map.values()]);
}

function lifecycleOrder(services) {
  const state = new Map();
  const ordered = [];

  const visit = (serviceId, path = []) => {
    const mark = state.get(serviceId);
    if (mark === "done") return;
    if (mark === "visiting") {
      throw new Error(`System service dependency cycle: ${[...path, serviceId].join(" -> ")}`);
    }
    const service = services.get(serviceId);
    if (!service) throw new Error(`Unknown system service: ${serviceId}`);
    state.set(serviceId, "visiting");
    for (const dependencyId of service.dependencies) {
      if (!services.has(dependencyId)) {
        throw new Error(`System service ${serviceId} requires missing dependency ${dependencyId}`);
      }
      visit(dependencyId, [...path, serviceId]);
    }
    for (const dependencyId of service.optionalDependencies) {
      if (services.has(dependencyId)) visit(dependencyId, [...path, serviceId]);
    }
    state.set(serviceId, "done");
    ordered.push(serviceId);
  };

  for (const serviceId of [...services.keys()].sort()) visit(serviceId);
  return Object.freeze(ordered);
}

export function createSystemFoundationRuntime({
  capabilities = [],
  services = [],
  eventLimit = 512,
  clock = () => new Date().toISOString(),
} = {}) {
  if (!Number.isSafeInteger(eventLimit) || eventLimit < 32 || eventLimit > 8192) {
    throw new TypeError("System event limit must be between 32 and 8192");
  }
  if (typeof clock !== "function") throw new TypeError("System foundation clock must be a function");

  const capabilityMap = new Map();
  for (const value of capabilities) {
    const capability = validateSystemCapabilityState(value);
    if (capabilityMap.has(capability.id)) throw new Error(`Duplicate system capability: ${capability.id}`);
    capabilityMap.set(capability.id, capability);
  }

  const serviceMap = new Map();
  for (const value of services) {
    const service = validateSystemServiceDescriptor(value);
    if (serviceMap.has(service.id)) throw new Error(`Duplicate system service: ${service.id}`);
    serviceMap.set(service.id, service);
  }
  let resolvedLifecycle = lifecycleOrder(serviceMap);
  let sequence = 0;
  const events = [];

  const appendEvent = ({ type, source, correlationId = null, subjectId = null, sensitivity = "system" }) => {
    sequence += 1;
    const event = validateSystemEvent({
      schema: SYSTEM_EVENT_SCHEMA,
      sequence,
      type,
      source,
      occurredAt: clock(),
      correlationId,
      subjectId,
      sensitivity,
    });
    events.push(event);
    if (events.length > eventLimit) events.splice(0, events.length - eventLimit);
    return event;
  };

  return Object.freeze({
    schema: SYSTEM_FOUNDATION_SCHEMA,
    capabilities: Object.freeze({
      get(id) {
        return capabilityMap.get(id) ?? null;
      },
      isAvailable(id) {
        return capabilityMap.get(id)?.available === true;
      },
      list() {
        return cloneMapValues(capabilityMap);
      },
      set({ id, available, source, reason = null }) {
        const next = validateSystemCapabilityState({
          schema: SYSTEM_CAPABILITY_STATE_SCHEMA,
          id,
          available,
          source,
          reason,
        });
        capabilityMap.set(next.id, next);
        appendEvent({
          type: next.available ? "capability.available" : "capability.unavailable",
          source: "system.foundation",
          subjectId: next.id,
        });
        return next;
      },
    }),
    lifecycle: Object.freeze({
      order() {
        return resolvedLifecycle;
      },
      register(value) {
        const service = validateSystemServiceDescriptor(value);
        if (serviceMap.has(service.id)) throw new Error(`Duplicate system service: ${service.id}`);
        serviceMap.set(service.id, service);
        try {
          resolvedLifecycle = lifecycleOrder(serviceMap);
        } catch (error) {
          serviceMap.delete(service.id);
          throw error;
        }
        appendEvent({ type: "service.registered", source: "system.foundation", subjectId: service.id });
        return service;
      },
      list() {
        return cloneMapValues(serviceMap);
      },
    }),
    events: Object.freeze({
      append: appendEvent,
      list({ afterSequence = 0 } = {}) {
        if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
          throw new TypeError("System event cursor is invalid");
        }
        return Object.freeze(events.filter((event) => event.sequence > afterSequence));
      },
      latestSequence() {
        return sequence;
      },
    }),
    policy: Object.freeze({
      evaluate(decisions = []) {
        if (!Array.isArray(decisions)) throw new TypeError("System policy decisions must be an array");
        if (decisions.length === 0) {
          return validateSystemPolicyDecision({
            schema: SYSTEM_POLICY_DECISION_SCHEMA,
            effect: "pass",
            reasonCode: "system.no-additional-restriction",
            source: "system.foundation",
          });
        }
        const validated = decisions.map(validateSystemPolicyDecision);
        return validated.reduce((strictest, candidate) => (
          POLICY_RANK[candidate.effect] > POLICY_RANK[strictest.effect] ? candidate : strictest
        ));
      },
    }),
  });
}
