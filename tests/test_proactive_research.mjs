import assert from "node:assert/strict";
import test from "node:test";

import {
  PROACTIVE_RESEARCH_AUTH_SCHEMA,
  PROACTIVE_RESEARCH_SOURCE_SCHEMA,
} from "../system/contracts/proactive-research.mjs";
import {
  PROACTIVE_RESEARCH_ANALYZER_SCHEMA,
  createProactiveResearchRuntime,
} from "../system/services/proactive-research/runtime.mjs";

function request(overrides = {}) {
  return {
    researchId: "research-1",
    subjectId: "work-1",
    query: "Find relevant blockers in this project.",
    ownerKind: "account",
    ownerId: "user-1",
    spaceId: "space-1",
    projectId: "project-1",
    sourceIds: ["memory"],
    includeRestricted: false,
    ...overrides,
  };
}

function source(overrides = {}) {
  return {
    schema: PROACTIVE_RESEARCH_SOURCE_SCHEMA,
    id: "memory",
    kind: "memory",
    network: false,
    mutation: false,
    read() {
      return [{
        evidenceId: "evidence-1",
        sourceId: "memory",
        sourceKind: "memory",
        provenanceRef: "memory:item-1",
        excerpt: "The project is waiting for a local model validation.",
        sensitivity: "personal",
      }];
    },
    ...overrides,
  };
}

function analyzer(overrides = {}) {
  return {
    schema: PROACTIVE_RESEARCH_ANALYZER_SCHEMA,
    network: false,
    mutation: false,
    analyze(value) {
      return {
        summary: value.evidence.length === 0 ? "No evidence found." : "One local blocker was found.",
        authority: "none",
      };
    },
    ...overrides,
  };
}

function runtime({ authorize = true, sourceValue = source(), analyzerValue = analyzer() } = {}) {
  return createProactiveResearchRuntime({
    sourceResolver(id) {
      return id === sourceValue.id ? sourceValue : null;
    },
    authorization: {
      schema: PROACTIVE_RESEARCH_AUTH_SCHEMA,
      authorizeRead() { return authorize; },
    },
    analyzer: analyzerValue,
  });
}

test("local proactive research returns evidence-backed authority-free result", () => {
  const result = runtime().run(request());
  assert.equal(result.authority, "none");
  assert.equal(result.summary, "One local blocker was found.");
  assert.deepEqual(result.evidenceRefs, ["evidence-1"]);
});

test("source read is denied before access when authorization does not allow exact context", () => {
  let reads = 0;
  const sourceValue = source({ read() { reads += 1; return []; } });
  assert.throws(() => runtime({ authorize: false, sourceValue }).run(request()), /authorization denied/);
  assert.equal(reads, 0);
});

test("network or mutating sources and analyzers are rejected", () => {
  assert.throws(() => runtime({ sourceValue: source({ network: true }) }).run(request()), /incompatible/);
  assert.throws(
    () => createProactiveResearchRuntime({
      sourceResolver: () => source(),
      authorization: { schema: PROACTIVE_RESEARCH_AUTH_SCHEMA, authorizeRead: () => true },
      analyzer: analyzer({ mutation: true }),
    }),
    /local authority-free/,
  );
});

test("restricted evidence is filtered unless request explicitly authorizes inclusion", () => {
  const restricted = source({
    read() {
      return [{
        evidenceId: "restricted-1",
        sourceId: "memory",
        sourceKind: "memory",
        provenanceRef: "memory:restricted-1",
        excerpt: "Restricted context.",
        sensitivity: "restricted",
      }];
    },
  });
  const hidden = runtime({ sourceValue: restricted }).run(request());
  assert.deepEqual(hidden.evidenceRefs, []);

  const visible = runtime({ sourceValue: restricted }).run(request({ includeRestricted: true }));
  assert.deepEqual(visible.evidenceRefs, ["restricted-1"]);
});

test("source binding and analyzer authority escalation fail closed", () => {
  const mismatched = source({
    read() {
      return [{
        evidenceId: "evidence-x",
        sourceId: "other-source",
        sourceKind: "memory",
        provenanceRef: "memory:item-x",
        excerpt: "Mismatched.",
        sensitivity: "personal",
      }];
    },
  });
  assert.throws(() => runtime({ sourceValue: mismatched }).run(request()), /binding mismatch/);

  const escalating = analyzer({
    analyze() { return { summary: "Unsafe", authority: "grant" }; },
  });
  assert.throws(() => runtime({ analyzerValue: escalating }).run(request()), /authority-free/);
});
