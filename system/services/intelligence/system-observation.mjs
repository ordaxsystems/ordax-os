import { validateIntelligenceContext } from "../../contracts/intelligence.mjs";
import { assertIntelligenceToolAuthorizationBroker } from "../../contracts/intelligence-tool-authorization.mjs";
import { INTELLIGENCE_READ_ONLY_TOOL_EXECUTOR_SCHEMA } from "../../contracts/intelligence-tool-execution.mjs";
import { validateIntelligenceToolId } from "../../contracts/intelligence-tool.mjs";

export const INTELLIGENCE_SYSTEM_OBSERVER_SCHEMA = "ordax.intelligence-system-observer/1";

const DEFAULT_GRANT_TTL_MS = 30_000;
const MAX_OBSERVATIONS = 8;
const OBSERVATION_KEYS = new Set(["toolId", "targetScope"]);
const TARGET_SCOPE_RE = /^[a-z][a-z0-9.-]{0,63}$/;

function boundedScope(value) {
  if (typeof value !== "string" || !TARGET_SCOPE_RE.test(value)) {
    throw new TypeError("Intelligence system observation target scope is invalid");
  }
  return value;
}

function normalizeObservations(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_OBSERVATIONS) {
    throw new TypeError("Intelligence system observations must be a bounded non-empty array");
  }
  const seen = new Set();
  return Object.freeze(value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Intelligence system observation must be an object");
    }
    for (const key of Object.keys(entry)) {
      if (!OBSERVATION_KEYS.has(key)) {
        throw new TypeError(`Intelligence system observation field ${key} is not allowed`);
      }
    }
    const toolId = validateIntelligenceToolId(entry.toolId);
    if (seen.has(toolId)) {
      throw new TypeError(`Duplicate Intelligence system observation ${toolId}`);
    }
    seen.add(toolId);
    return Object.freeze({
      toolId,
      targetScope: boundedScope(entry.targetScope),
    });
  }));
}

function assertReadOnlyExecutor(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== INTELLIGENCE_READ_ONLY_TOOL_EXECUTOR_SCHEMA
    || typeof value.execute !== "function"
  ) {
    throw new TypeError("A compatible Intelligence read-only tool executor is required");
  }
  return value;
}

export function assertIntelligenceSystemObserver(value) {
  if (
    !value
    || typeof value !== "object"
    || value.schema !== INTELLIGENCE_SYSTEM_OBSERVER_SCHEMA
    || typeof value.observe !== "function"
  ) {
    throw new TypeError("A compatible Intelligence system observer is required");
  }
  return value;
}

function limitationContext(failedToolIds) {
  if (failedToolIds.length === 0) return [];
  return [{
    id: "tool-system-observation-limitations",
    scope: "system",
    text: JSON.stringify({ unavailableObservations: failedToolIds }),
    provenance: "ordax:tool:system-observer:local-read-only-limitations",
  }];
}

export function createIntelligenceSystemObserver({
  authorizationBroker,
  executor,
  observations,
  grantTtlMs = DEFAULT_GRANT_TTL_MS,
  targetId = "device-local",
} = {}) {
  const authorization = assertIntelligenceToolAuthorizationBroker(authorizationBroker);
  const readOnlyExecutor = assertReadOnlyExecutor(executor);
  const configured = normalizeObservations(observations);
  if (!Number.isSafeInteger(grantTtlMs) || grantTtlMs <= 0 || grantTtlMs > 300_000) {
    throw new TypeError("Intelligence system observation grant TTL is invalid");
  }
  if (typeof targetId !== "string" || !targetId.trim() || targetId.length > 160) {
    throw new TypeError("Intelligence system observation target id is invalid");
  }

  let disposed = false;

  return Object.freeze({
    schema: INTELLIGENCE_SYSTEM_OBSERVER_SCHEMA,
    async observe() {
      if (disposed) throw new Error("Intelligence system observer is disposed");
      const context = [];
      const observedToolIds = [];
      const failedToolIds = [];

      for (const observation of configured) {
        let grant = null;
        try {
          grant = authorization.issue({
            agentId: "system",
            toolId: observation.toolId,
            targetScope: observation.targetScope,
            targetId,
            ttlMs: grantTtlMs,
          });
          const { result } = await readOnlyExecutor.execute({
            grantId: grant.id,
            agentId: "system",
            toolId: observation.toolId,
            targetScope: observation.targetScope,
            targetId,
          });
          context.push(...result.context);
          observedToolIds.push(observation.toolId);
        } catch {
          if (grant !== null) {
            try {
              authorization.revoke(grant.id);
            } catch {
              // The grant may already have been consumed by a failed execution.
            }
          }
          failedToolIds.push(observation.toolId);
        }
      }

      if (context.length === 0) {
        throw new Error("Governed system observations are unavailable");
      }
      context.push(...limitationContext(failedToolIds));

      return Object.freeze({
        schema: INTELLIGENCE_SYSTEM_OBSERVER_SCHEMA,
        context: validateIntelligenceContext(context),
        observedToolIds: Object.freeze([...observedToolIds]),
        failedToolIds: Object.freeze([...failedToolIds]),
        authority: "none",
        readOnly: true,
        networkEgress: false,
        mutatedState: false,
      });
    },
    dispose() {
      disposed = true;
    },
  });
}
