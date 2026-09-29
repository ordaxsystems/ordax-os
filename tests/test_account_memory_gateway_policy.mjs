import assert from "node:assert/strict";
import test from "node:test";

import {
  MEMORY_SYNC_GATEWAY_POLICY_SCHEMA,
  validateMemorySyncMutationForGateway,
} from "../infra/supabase/functions/ordax-account-gateway/memory-sync-policy.mjs";
import {
  MEMORY_SYNC_DATA_CLASS,
  MEMORY_SYNC_MUTATION_SCHEMA,
  MEMORY_SYNC_OBJECT_SCHEMA_VERSION,
  MEMORY_SYNC_PAYLOAD_SCHEMA,
  MEMORY_SYNC_RESOLVER_VERSION,
  classifyMemoryForAccountSync,
} from "../system/services/sync/account-memory-runtime.mjs";

const SUBJECT = "account-subject-a";

function memoryItem(overrides = {}) {
  return {
    id: "memory-gateway-1",
    ownerKind: "account",
    ownerId: SUBJECT,
    scope: "account",
    kind: "fact",
    sensitivity: "private",
    content: "preferência autorizada",
    provenance: "user-confirmed:gateway-policy-test",
    sourceTimestamp: "2026-09-29T12:30:00Z",
    spaceId: null,
    projectId: null,
    ...overrides,
  };
}

function upsertMutation(item = memoryItem(), overrides = {}) {
  const classification = classifyMemoryForAccountSync(item, { subjectId: SUBJECT });
  assert.equal(classification.eligible, true);
  return {
    $schema: MEMORY_SYNC_MUTATION_SCHEMA,
    operation: "upsert",
    objectId: classification.objectId,
    dataClass: MEMORY_SYNC_DATA_CLASS,
    objectSchemaVersion: MEMORY_SYNC_OBJECT_SCHEMA_VERSION,
    resolverVersion: MEMORY_SYNC_RESOLVER_VERSION,
    baseServerRevision: 0,
    idempotencyKey: "memory:gateway:1:abcdefgh",
    payload: {
      schema: MEMORY_SYNC_PAYLOAD_SCHEMA,
      memory: item,
    },
    ...overrides,
  };
}

test("gateway Memory policy is an enforcement adapter over the canonical sync validator", () => {
  assert.equal(MEMORY_SYNC_GATEWAY_POLICY_SCHEMA, "ordax.memory-sync-gateway-policy/1");
  const normalized = validateMemorySyncMutationForGateway(upsertMutation(), { subjectId: SUBJECT });
  assert.equal(normalized.dataClass, "memory");
  assert.equal(normalized.payload.memory.schema, "ordax.memory/1");
  assert.equal(normalized.payload.memory.ownerId, SUBJECT);
});

test("gateway policy sanitizes unknown client fields by returning the canonical normalized mutation", () => {
  const raw = memoryItem({ accessToken: "must-never-reach-storage" });
  const normalized = validateMemorySyncMutationForGateway(upsertMutation(raw), { subjectId: SUBJECT });
  assert.equal("accessToken" in normalized.payload.memory, false);
  assert.equal(JSON.stringify(normalized).includes("must-never-reach-storage"), false);
});

test("gateway policy rejects secret-bearing, restricted, device-owned and cross-subject Memory", () => {
  const secret = upsertMutation();
  secret.payload = {
    ...secret.payload,
    memory: {
      ...secret.payload.memory,
      content: "Authorization: Bearer secret-token-value-123456",
    },
  };
  assert.throws(
    () => validateMemorySyncMutationForGateway(secret, { subjectId: SUBJECT }),
    /eligible|secret|sync/i,
  );

  const restricted = memoryItem({ sensitivity: "restricted" });
  assert.equal(classifyMemoryForAccountSync(restricted, { subjectId: SUBJECT }).eligible, false);

  assert.throws(
    () => validateMemorySyncMutationForGateway(upsertMutation(), { subjectId: "other-account" }),
    /eligible|owner|account/i,
  );

  assert.throws(
    () => validateMemorySyncMutationForGateway({ ...upsertMutation(), dataClass: "preferences" }, { subjectId: SUBJECT }),
    /only accepts the Memory data class/,
  );
});

test("gateway policy rejects provider-added authority fields instead of forwarding them", () => {
  const mutation = upsertMutation();
  mutation.payload = {
    ...mutation.payload,
    providerAuthorization: { tool: "shell", grants: ["raw-disk"] },
  };
  assert.throws(
    () => validateMemorySyncMutationForGateway(mutation, { subjectId: SUBJECT }),
    /fields are incompatible/,
  );
});
