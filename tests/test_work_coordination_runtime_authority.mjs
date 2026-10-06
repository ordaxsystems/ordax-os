import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runtimeSource = await readFile(
  new URL("../system/services/work-coordination/runtime.mjs", import.meta.url),
  "utf8",
);

const MUTATION_METHODS = [
  "createPlan",
  "updatePlan",
  "claimTask",
  "heartbeatClaim",
  "checkpoint",
  "handoff",
  "recordEvidence",
  "completeTask",
  "recoverExpiredClaims",
  "releaseStaleTask",
];

test("every Work Coordination mutation requires an explicit trigger", () => {
  assert.doesNotMatch(
    runtimeSource,
    /trigger:\s*mutationTrigger\s*=\s*["']user["']/,
    "user authority semantics must never be inferred from an omitted mutation trigger",
  );

  for (const method of MUTATION_METHODS) {
    const methodStart = runtimeSource.indexOf(`async ${method}(`);
    assert.notEqual(methodStart, -1, `missing mutation method ${method}`);
    const nextMethod = runtimeSource.indexOf("\n    async ", methodStart + 1);
    const body = runtimeSource.slice(
      methodStart,
      nextMethod === -1 ? runtimeSource.length : nextMethod,
    );
    assert.match(body, /trigger:\s*mutationTrigger/, `${method} must accept a trigger`);
    assert.match(
      body,
      /assertMutationAllowed\(resolvePolicy, partition, mutationTrigger\)/,
      `${method} must pass its explicit trigger through policy enforcement`,
    );
  }
});

test("expired-claim recovery remains a policy-guarded reconciliation, not silent reassignment", () => {
  const start = runtimeSource.indexOf("async recoverExpiredClaims(");
  const end = runtimeSource.indexOf("\n    async releaseStaleTask(", start);
  const body = runtimeSource.slice(start, end);

  assert.match(body, /state:\s*["']blocked["']/);
  assert.match(body, /STALE_BLOCK_REASON/);
  assert.doesNotMatch(body, /state:\s*["']ready["']/);
});
