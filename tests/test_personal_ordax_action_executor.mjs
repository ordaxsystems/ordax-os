import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_ADAPTER_SCHEMA } from "../system/contracts/action-executor.mjs";
import { createPersonalOrdaxActionGateway } from "../system/services/personal-ordax/action-gateway.mjs";
import { createPersonalOrdaxActionExecutor, PersonalActionExecutionError } from "../system/services/personal-ordax/action-executor.mjs";

const NOW = Date.parse("2026-09-30T22:30:00.000Z");

function tool() {
  return {
    id: "files-inspector",
    version: "1.0.0",
    artifactSha256: "a".repeat(64),
    sandbox: "native-broker",
    actions: [{
      id: "files.directory.create",
      mode: "write",
      approval: "per-use",
      scopes: ["user-file-space"],
    }],
    network: { allowed: false, destinations: [] },
    filesystem: { allowed: true, scopes: ["/Documentos"] },
    limits: { timeoutMs: 1000, maxOutputBytes: 4096 },
  };
}

function request(overrides = {}) {
  return {
    workItemId: "personal-work-1",
    approvalId: "personal-approval-personal-work-1-1",
    actionId: "files.directory.create",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    effect: "write",
    ownerKind: "account",
    ownerId: "user-a",
    spaceId: "space-a",
    projectId: null,
    resourceRef: "file-space:/Documentos/Novo",
    reason: "Criar a pasta explicitamente aprovada.",
    requestedAt: "2026-09-30T22:29:00.000Z",
    ...overrides,
  };
}

function grant(overrides = {}) {
  return {
    grantId: "grant-1",
    workItemId: "personal-work-1",
    approvalId: "personal-approval-personal-work-1-1",
    toolId: "files-inspector",
    toolArtifactSha256: "a".repeat(64),
    action: "files.directory.create",
    mode: "write",
    approved: true,
    source: "user-approval",
    ownerKind: "account",
    ownerId: "user-a",
    spaceId: "space-a",
    projectId: null,
    resourceRef: "file-space:/Documentos/Novo",
    expiresAt: "2026-09-30T22:34:00.000Z",
    ...overrides,
  };
}

function setup() {
  const grants = new Map([["grant-1", grant()]]);
  const gateway = createPersonalOrdaxActionGateway({
    toolResolver: (id) => id === "files-inspector" ? tool() : null,
    grantResolver: (id) => grants.get(id) ?? null,
    now: () => NOW,
  });
  return { grants, gateway };
}

test("Action Executor revalidates authority immediately before invoking typed adapter", async () => {
  const { gateway } = setup();
  const actionRequest = request();
  const decision = gateway.decide(actionRequest, { grantRef: "grant-1" });
  let calls = 0;
  const executor = createPersonalOrdaxActionExecutor({
    actionGateway: gateway,
    adapterResolver(toolId, actionId) {
      assert.equal(toolId, "files-inspector");
      assert.equal(actionId, "files.directory.create");
      return {
        schema: ACTION_ADAPTER_SCHEMA,
        toolId,
        artifactSha256: "a".repeat(64),
        actionId,
        effect: "write",
        async execute(received) {
          calls += 1;
          assert.equal(received.resourceRef, "file-space:/Documentos/Novo");
          return {
            status: "succeeded",
            summary: "Diretorio criado.",
            artifactRefs: ["file-space:/Documentos/Novo"],
          };
        },
      };
    },
    now: () => NOW,
  });

  const receipt = await executor.execute({ request: actionRequest, decision });
  assert.equal(calls, 1);
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.approvalId, actionRequest.approvalId);
  assert.equal(receipt.grantRef, "grant-1");
  assert.equal(receipt.toolArtifactSha256, "a".repeat(64));
  assert.equal(receipt.resourceRef, actionRequest.resourceRef);
  assert.deepEqual(receipt.artifactRefs, ["file-space:/Documentos/Novo"]);
});

test("policy-authorized read executes without inventing resource or grant references", async () => {
  const gateway = createPersonalOrdaxActionGateway({
    toolResolver: () => null,
    grantResolver: () => null,
    readPolicy: () => true,
    now: () => NOW,
  });
  const actionRequest = request({
    actionId: "files.document.read",
    effect: "read",
    resourceRef: null,
  });
  const decision = gateway.decide(actionRequest);
  assert.equal(decision.decision, "allow");
  assert.equal(decision.authoritySource, "system-policy");
  assert.equal(decision.grantRef, null);

  const executor = createPersonalOrdaxActionExecutor({
    actionGateway: gateway,
    adapterResolver() {
      return {
        schema: ACTION_ADAPTER_SCHEMA,
        toolId: "files-inspector",
        artifactSha256: "a".repeat(64),
        actionId: "files.document.read",
        effect: "read",
        async execute() {
          return {
            status: "succeeded",
            summary: "Read completed under trusted policy.",
            artifactRefs: [],
          };
        },
      };
    },
    now: () => NOW,
  });

  const receipt = await executor.execute({ request: actionRequest, decision });
  assert.equal(receipt.status, "succeeded");
  assert.equal(receipt.effect, "read");
  assert.equal(receipt.resourceRef, null);
  assert.equal(receipt.grantRef, null);
});

test("revoked grant fails closed before adapter side effect", async () => {
  const { grants, gateway } = setup();
  const actionRequest = request();
  const decision = gateway.decide(actionRequest, { grantRef: "grant-1" });
  grants.delete("grant-1");
  let calls = 0;
  const executor = createPersonalOrdaxActionExecutor({
    actionGateway: gateway,
    adapterResolver() {
      return {
        schema: ACTION_ADAPTER_SCHEMA,
        toolId: "files-inspector",
        artifactSha256: "a".repeat(64),
        actionId: "files.directory.create",
        effect: "write",
        async execute() {
          calls += 1;
          return { summary: "nao deve executar" };
        },
      };
    },
    now: () => NOW,
  });

  await assert.rejects(
    () => executor.execute({ request: actionRequest, decision }),
    (error) => {
      assert.ok(error instanceof PersonalActionExecutionError);
      assert.equal(error.phase, "pre-side-effect");
      assert.match(error.message, /no longer valid/);
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("decision from another approval is rejected before adapter resolution", async () => {
  const { gateway } = setup();
  const approvedRequest = request();
  const decision = gateway.decide(approvedRequest, { grantRef: "grant-1" });
  let resolved = false;
  const executor = createPersonalOrdaxActionExecutor({
    actionGateway: gateway,
    adapterResolver() {
      resolved = true;
      throw new Error("must not resolve adapter");
    },
    now: () => NOW,
  });

  await assert.rejects(
    () => executor.execute({
      request: request({ approvalId: "personal-approval-personal-work-1-2" }),
      decision,
    }),
    (error) => {
      assert.ok(error instanceof PersonalActionExecutionError);
      assert.equal(error.phase, "pre-side-effect");
      assert.match(error.message, /does not match/);
      return true;
    },
  );
  assert.equal(resolved, false);
});

test("adapter-entered exception is explicitly classified as uncertain", async () => {
  const { gateway } = setup();
  const actionRequest = request();
  const decision = gateway.decide(actionRequest, { grantRef: "grant-1" });
  const executor = createPersonalOrdaxActionExecutor({
    actionGateway: gateway,
    adapterResolver() {
      return {
        schema: ACTION_ADAPTER_SCHEMA,
        toolId: "files-inspector",
        artifactSha256: "a".repeat(64),
        actionId: "files.directory.create",
        effect: "write",
        async execute() {
          throw new Error("adapter crashed after entry");
        },
      };
    },
    now: () => NOW,
  });

  await assert.rejects(
    () => executor.execute({ request: actionRequest, decision }),
    (error) => {
      assert.ok(error instanceof PersonalActionExecutionError);
      assert.equal(error.phase, "adapter-entered");
      assert.match(error.message, /adapter crashed after entry/);
      return true;
    },
  );
});

test("resource substitution is denied before adapter resolution", async () => {
  const { gateway } = setup();
  const approvedRequest = request();
  const decision = gateway.decide(approvedRequest, { grantRef: "grant-1" });
  let resolved = false;
  const executor = createPersonalOrdaxActionExecutor({
    actionGateway: gateway,
    adapterResolver() {
      resolved = true;
      throw new Error("must not resolve adapter");
    },
    now: () => NOW,
  });

  await assert.rejects(
    () => executor.execute({
      request: request({ resourceRef: "file-space:/Documentos/Outro" }),
      decision,
    }),
    /no longer valid/,
  );
  assert.equal(resolved, false);
});

test("adapter artifact substitution fails closed before side effect", async () => {
  const { gateway } = setup();
  const actionRequest = request();
  const decision = gateway.decide(actionRequest, { grantRef: "grant-1" });
  let calls = 0;
  const executor = createPersonalOrdaxActionExecutor({
    actionGateway: gateway,
    adapterResolver() {
      return {
        schema: ACTION_ADAPTER_SCHEMA,
        toolId: "files-inspector",
        artifactSha256: "b".repeat(64),
        actionId: "files.directory.create",
        effect: "write",
        async execute() {
          calls += 1;
          return { summary: "must not execute" };
        },
      };
    },
    now: () => NOW,
  });

  await assert.rejects(
    () => executor.execute({ request: actionRequest, decision }),
    /does not match/,
  );
  assert.equal(calls, 0);
});

test("mismatched typed adapter fails closed after authority revalidation", async () => {
  const { gateway } = setup();
  const actionRequest = request();
  const decision = gateway.decide(actionRequest, { grantRef: "grant-1" });
  const executor = createPersonalOrdaxActionExecutor({
    actionGateway: gateway,
    adapterResolver() {
      return {
        schema: ACTION_ADAPTER_SCHEMA,
        toolId: "files-inspector",
        artifactSha256: "a".repeat(64),
        actionId: "files.other.write",
        effect: "write",
        async execute() {
          throw new Error("must not execute");
        },
      };
    },
    now: () => NOW,
  });

  await assert.rejects(
    () => executor.execute({ request: actionRequest, decision }),
    /does not match/,
  );
});
