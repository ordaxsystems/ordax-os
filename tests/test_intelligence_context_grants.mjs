import assert from "node:assert/strict";
import test from "node:test";

import {
  INTELLIGENCE_CONTEXT_GRANT_BROKER_SCHEMA,
  INTELLIGENCE_CONTEXT_GRANT_SCHEMA,
} from "../system/contracts/intelligence-context-grant.mjs";
import { createIntelligenceContextGrantBroker } from "../system/services/intelligence/context-grants.mjs";

function context(text = "selected context") {
  return [{
    id: "selected-project",
    scope: "workspace",
    text,
    provenance: "test:selected-project",
  }];
}

function brokerFixture() {
  let clock = 1_000_000;
  let ordinal = 0;
  const broker = createIntelligenceContextGrantBroker({
    now: () => clock,
    createGrantId: () => `grant-${String(++ordinal).padStart(16, "0")}`,
  });
  return {
    broker,
    advance(ms) {
      clock += ms;
    },
  };
}

test("context grant exposes metadata only and consumes authorized context once", () => {
  const { broker } = brokerFixture();
  assert.equal(broker.schema, INTELLIGENCE_CONTEXT_GRANT_BROKER_SCHEMA);

  const grant = broker.issue({
    sourceId: "selected-project",
    target: { kind: "project", id: "project-1" },
    context: context("project metadata"),
  });

  assert.equal(grant.schema, INTELLIGENCE_CONTEXT_GRANT_SCHEMA);
  assert.equal(Object.hasOwn(grant, "context"), false);
  assert.equal(grant.sourceId, "selected-project");
  assert.deepEqual(grant.target, { kind: "project", id: "project-1" });
  assert.equal(grant.oneShot, true);
  assert.equal(grant.readOnly, true);
  assert.equal(grant.authority, "none");
  assert.equal(grant.executable, false);
  assert.equal(grant.toolExecution, false);

  assert.deepEqual(broker.describe(grant.id), grant);
  assert.deepEqual(
    broker.consume(grant.id, {
      sourceId: "selected-project",
      target: { kind: "project", id: "project-1" },
    }),
    context("project metadata"),
  );
  assert.throws(() => broker.describe(grant.id), /unavailable or already consumed/);
  assert.throws(
    () => broker.consume(grant.id, {
      sourceId: "selected-project",
      target: { kind: "project", id: "project-1" },
    }),
    /unavailable or already consumed/,
  );
  broker.dispose();
});

test("context grant rejects source or target confusion without consuming the valid grant", () => {
  const { broker } = brokerFixture();
  const grant = broker.issue({
    sourceId: "selected-project",
    target: { kind: "project", id: "project-7" },
    context: context(),
  });

  assert.throws(
    () => broker.consume(grant.id, {
      sourceId: "selected-document",
      target: { kind: "project", id: "project-7" },
    }),
    /source does not match/,
  );
  assert.throws(
    () => broker.consume(grant.id, {
      sourceId: "selected-project",
      target: { kind: "project", id: "project-8" },
    }),
    /target does not match/,
  );
  assert.equal(broker.describe(grant.id).id, grant.id);
  assert.equal(
    broker.consume(grant.id, {
      sourceId: "selected-project",
      target: { kind: "project", id: "project-7" },
    })[0].text,
    "selected context",
  );
  broker.dispose();
});

test("expired and revoked context grants fail closed", () => {
  const { broker, advance } = brokerFixture();
  const expired = broker.issue({
    sourceId: "selected-project",
    target: { kind: "project", id: "project-2" },
    context: context(),
    ttlMs: 1_000,
  });
  advance(1_000);
  assert.throws(() => broker.describe(expired.id), /expired/);

  const revoked = broker.issue({
    sourceId: "selected-project",
    target: { kind: "project", id: "project-3" },
    context: context(),
  });
  assert.equal(broker.revoke(revoked.id), true);
  assert.throws(() => broker.describe(revoked.id), /unavailable or already consumed/);
  broker.dispose();
});

test("grant creation requires bounded non-empty context and secure-shaped ids", () => {
  let ordinal = 0;
  const broker = createIntelligenceContextGrantBroker({
    now: () => 100,
    createGrantId: () => `bad-${++ordinal}`,
  });
  assert.throws(
    () => broker.issue({
      sourceId: "selected-project",
      target: { kind: "project", id: "project-1" },
      context: context(),
    }),
    /grant id is invalid/,
  );
  broker.dispose();

  const good = brokerFixture().broker;
  assert.throws(
    () => good.issue({
      sourceId: "selected-project",
      target: { kind: "project", id: "project-1" },
      context: [],
    }),
    /non-empty authorized context/,
  );
  assert.throws(
    () => good.issue({
      sourceId: "selected-project",
      target: null,
      context: context(),
    }),
    /requires a concrete target/,
  );
  good.dispose();
});
