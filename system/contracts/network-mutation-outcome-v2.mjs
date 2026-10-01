export const NETWORK_MUTATION_OUTCOME_SCHEMA =
  "prototype-ordax.network-mutation-outcome/2";

export const NETWORK_MUTATION_OUTCOMES = Object.freeze([
  "applied",
  "idempotent",
  "rate_limited",
  "denied",
  "invalid",
]);

const OUTCOME_SET = new Set(NETWORK_MUTATION_OUTCOMES);
const MACHINE_CODE = /^[a-z][a-z0-9-]{2,95}$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireBoundedString(value, label, max = 160) {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new TypeError(`${label} must be a bounded string`);
  }
  return value;
}

export function validateNetworkMutationOutcome(value) {
  const input = requireObject(value, "Network mutation outcome");

  if (input.schema !== NETWORK_MUTATION_OUTCOME_SCHEMA) {
    throw new TypeError("Network mutation outcome schema is incompatible");
  }
  if (!OUTCOME_SET.has(input.outcome)) {
    throw new TypeError("Network mutation outcome is unsupported");
  }

  requireBoundedString(input.operation, "operation", 80);
  if (!MACHINE_CODE.test(input.code ?? "")) {
    throw new TypeError("Network mutation outcome code must be a machine code");
  }

  const resourceId =
    input.resource_id === null || input.resource_id === undefined
      ? null
      : requireBoundedString(input.resource_id, "resource_id");

  if (resourceId !== null && !RESOURCE_ID.test(resourceId)) {
    throw new TypeError("resource_id must be an opaque bounded identifier");
  }

  const successLike = input.outcome === "applied" || input.outcome === "idempotent";
  if (successLike && resourceId === null) {
    throw new TypeError(`${input.outcome} requires resource_id`);
  }
  if (!successLike && resourceId !== null) {
    throw new TypeError(`${input.outcome} must not expose resource_id`);
  }

  const retryAfter =
    input.retry_after_seconds === null || input.retry_after_seconds === undefined
      ? null
      : input.retry_after_seconds;

  if (input.outcome === "rate_limited") {
    if (!Number.isInteger(retryAfter) || retryAfter < 1 || retryAfter > 86400) {
      throw new TypeError("rate_limited requires bounded retry_after_seconds");
    }
  } else if (retryAfter !== null) {
    throw new TypeError("retry_after_seconds is only valid for rate_limited");
  }

  if (input.idempotency_key !== null && input.idempotency_key !== undefined) {
    requireBoundedString(input.idempotency_key, "idempotency_key", 120);
  }

  return Object.freeze({
    schema: NETWORK_MUTATION_OUTCOME_SCHEMA,
    outcome: input.outcome,
    operation: input.operation,
    code: input.code,
    resourceId,
    retryAfterSeconds: retryAfter,
    idempotencyKey: input.idempotency_key ?? null,
  });
}
