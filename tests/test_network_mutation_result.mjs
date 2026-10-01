import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_MUTATION_RESULT_SCHEMA,
  NETWORK_MUTATION_OUTCOMES,
  validateNetworkMutationResult,
} from "../system/contracts/network-mutation-result.mjs";

test("Network mutation v2 exposes only canonical outcomes", () => {
  assert.deepEqual(NETWORK_MUTATION_OUTCOMES, [
    "applied",
    "idempotent",
    "rate_limited",
    "denied",
  ]);
});

test("applied and idempotent require a canonical resource id", () => {
  for (const outcome of ["applied", "idempotent"]) {
    const result = validateNetworkMutationResult({
      schema: NETWORK_MUTATION_RESULT_SCHEMA,
      outcome,
      code: outcome === "applied" ? "message-created" : "message-existing",
      resourceId: "message_00000001",
      retryAfterSeconds: null,
    });
    assert.equal(result.outcome, outcome);
    assert.equal(result.resourceId, "message_00000001");
  }

  assert.throws(
    () => validateNetworkMutationResult({
      schema: NETWORK_MUTATION_RESULT_SCHEMA,
      outcome: "applied",
      code: "message-created",
      resourceId: null,
    }),
    /requires resourceId/,
  );
});

test("rate_limited requires bounded retry metadata and no resource leak", () => {
  const result = validateNetworkMutationResult({
    schema: NETWORK_MUTATION_RESULT_SCHEMA,
    outcome: "rate_limited",
    code: "message-rate-limited",
    resourceId: null,
    retryAfterSeconds: 42,
  });
  assert.equal(result.retryAfterSeconds, 42);

  assert.throws(
    () => validateNetworkMutationResult({
      schema: NETWORK_MUTATION_RESULT_SCHEMA,
      outcome: "rate_limited",
      code: "message-rate-limited",
      resourceId: "message_00000001",
      retryAfterSeconds: 42,
    }),
    /must not expose resourceId/,
  );

  assert.throws(
    () => validateNetworkMutationResult({
      schema: NETWORK_MUTATION_RESULT_SCHEMA,
      outcome: "rate_limited",
      code: "message-rate-limited",
      retryAfterSeconds: 0,
    }),
    /bounded retryAfterSeconds/,
  );
});

test("denied is intentionally generic and cannot carry sensitive details", () => {
  const result = validateNetworkMutationResult({
    schema: NETWORK_MUTATION_RESULT_SCHEMA,
    outcome: "denied",
    code: "operation-denied",
  });
  assert.equal(result.resourceId, null);
  assert.equal(result.retryAfterSeconds, null);

  assert.throws(
    () => validateNetworkMutationResult({
      schema: NETWORK_MUTATION_RESULT_SCHEMA,
      outcome: "denied",
      code: "operation-denied",
      resourceId: "private_resource_01",
    }),
    /must not expose resource or retry details/,
  );
});

test("unknown outcomes and unversioned payloads fail closed", () => {
  assert.throws(
    () => validateNetworkMutationResult({
      schema: NETWORK_MUTATION_RESULT_SCHEMA,
      outcome: "success",
      code: "operation-success",
    }),
    /Unsupported Network mutation outcome/,
  );
  assert.throws(
    () => validateNetworkMutationResult({
      outcome: "applied",
      code: "message-created",
      resourceId: "message_00000001",
    }),
    /schema is incompatible/,
  );
});
