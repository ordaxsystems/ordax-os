export const NETWORK_MUTATION_RESULT_SCHEMA =
  "prototype-ordax.network-mutation-result/2";

export const NETWORK_MUTATION_OUTCOMES = Object.freeze([
  "applied",
  "idempotent",
  "rate_limited",
  "denied",
]);

const OUTCOMES = new Set(NETWORK_MUTATION_OUTCOMES);
const CODE_RE = /^[a-z][a-z0-9-]{2,79}$/;
const RESOURCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;

function boundedCode(value) {
  return typeof value === "string" && CODE_RE.test(value);
}

function boundedResourceId(value) {
  return typeof value === "string" && RESOURCE_ID_RE.test(value);
}

export function validateNetworkMutationResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Network mutation result must be an object");
  }
  if (value.schema !== NETWORK_MUTATION_RESULT_SCHEMA) {
    throw new TypeError("Network mutation result schema is incompatible");
  }
  if (!OUTCOMES.has(value.outcome)) {
    throw new TypeError(`Unsupported Network mutation outcome: ${String(value.outcome)}`);
  }
  if (!boundedCode(value.code)) {
    throw new TypeError("Network mutation result code must be bounded and canonical");
  }

  const resourceId = value.resourceId ?? null;
  const retryAfterSeconds = value.retryAfterSeconds ?? null;

  if (value.outcome === "applied" || value.outcome === "idempotent") {
    if (!boundedResourceId(resourceId)) {
      throw new TypeError(`${value.outcome} Network result requires resourceId`);
    }
    if (retryAfterSeconds !== null) {
      throw new TypeError(`${value.outcome} Network result must not include retryAfterSeconds`);
    }
  } else if (value.outcome === "rate_limited") {
    if (
      !Number.isSafeInteger(retryAfterSeconds)
      || retryAfterSeconds < 1
      || retryAfterSeconds > 86_400
    ) {
      throw new TypeError(
        "rate_limited Network result requires bounded retryAfterSeconds",
      );
    }
    if (resourceId !== null) {
      throw new TypeError("rate_limited Network result must not expose resourceId");
    }
  } else {
    if (resourceId !== null || retryAfterSeconds !== null) {
      throw new TypeError(
        "denied Network result must not expose resource or retry details",
      );
    }
  }

  return Object.freeze({
    schema: NETWORK_MUTATION_RESULT_SCHEMA,
    outcome: value.outcome,
    code: value.code,
    resourceId,
    retryAfterSeconds,
  });
}
