import assert from "node:assert/strict";
import test from "node:test";

import {
  NETWORK_MUTATION_OUTCOME_SCHEMA,
  validateNetworkMutationOutcome,
} from "../system/contracts/network-mutation-outcome-v2.mjs";

test("accepts applied and idempotent outcomes only with canonical resource ids", () => {
  for (const outcome of ["applied", "idempotent"]) {
    const result = validateNetworkMutationOutcome({
      schema: NETWORK_MUTATION_OUTCOME_SCHEMA,
      outcome,
      operation: "message-send",
      code: outcome === "applied" ? "message-applied" : "message-idempotent",
      resource_id: "message_00000001",
      retry_after_seconds: null,
      idempotency_key: "client-key-00000001",
    });
    assert.equal(result.outcome, outcome);
    assert.equal(result.resourceId, "message_00000001");
  }
});

test("rate limited is explicit and cannot masquerade as null success", () => {
  const result = validateNetworkMutationOutcome({
    schema: NETWORK_MUTATION_OUTCOME_SCHEMA,
    outcome: "rate_limited",
    operation: "message-send",
    code: "message-rate-limited",
    resource_id: null,
    retry_after_seconds: 45,
    idempotency_key: "client-key-00000002",
  });
  assert.equal(result.outcome, "rate_limited");
  assert.equal(result.resourceId, null);
  assert.equal(result.retryAfterSeconds, 45);
});

test("rejects resource ids for denied or invalid outcomes", () => {
  for (const outcome of ["denied", "invalid", "rate_limited"]) {
    assert.throws(() =>
      validateNetworkMutationOutcome({
        schema: NETWORK_MUTATION_OUTCOME_SCHEMA,
        outcome,
        operation: "group-join",
        code: "group-operation-denied",
        resource_id: "group_00000001",
        retry_after_seconds: outcome === "rate_limited" ? 10 : null,
      }),
    );
  }
});

test("rejects ambiguous or unbounded rate-limit outcomes", () => {
  for (const retryAfter of [null, 0, 86401, 1.5]) {
    assert.throws(() =>
      validateNetworkMutationOutcome({
        schema: NETWORK_MUTATION_OUTCOME_SCHEMA,
        outcome: "rate_limited",
        operation: "report-create",
        code: "report-rate-limited",
        resource_id: null,
        retry_after_seconds: retryAfter,
      }),
    );
  }
});

test("rejects retry metadata on non-rate-limited outcomes", () => {
  assert.throws(() =>
    validateNetworkMutationOutcome({
      schema: NETWORK_MUTATION_OUTCOME_SCHEMA,
      outcome: "applied",
      operation: "direct-create",
      code: "direct-applied",
      resource_id: "conversation_0001",
      retry_after_seconds: 30,
    }),
  );
});
