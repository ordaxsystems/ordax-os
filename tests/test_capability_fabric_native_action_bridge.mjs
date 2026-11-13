import assert from "node:assert/strict";
import test from "node:test";

import { FILE_SPACE_SCHEMA } from "../system/contracts/file-space.mjs";
import { createNativeSurfaceHost } from "../system/adapters/native/runtime.mjs";
import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { INTELLIGENCE_PORT_SCHEMA, INTELLIGENCE_RESPONSE_SCHEMA } from
  "../system/contracts/intelligence.mjs";
import {
  createNativePersonalOrdaxFileActions,
} from "../system/adapters/native/personal-ordax-file-actions.mjs";
import { createNativePersonalOrdaxComposition } from "../system/composition/native/personal-ordax.mjs";
import { validateCapabilityDiscoverySnapshot } from "../system/contracts/capability-discovery.mjs";
import { createCapabilityDiscovery } from "../system/services/system-foundation/capability-discovery.mjs";
import { createSystemFoundationRuntime } from "../system/services/system-foundation/runtime.mjs";
import { createPersonalActionCatalog } from "../system/services/personal-ordax/action-catalog.mjs";

function localStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function identity() {
  let subjectId = "user-a";
  const listeners = new Set();
  return {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return { state: "signed-in", subjectId, displayName: subjectId };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    switchTo(nextId) {
      subjectId = nextId;
      const snapshot = this.getSnapshot();
      for (const listener of [...listeners]) listener(snapshot);
    },
  };
}

async function setup({
  deferredMutation = false, intelligence = null, storage = localStorage(),
  surfaceHost = null, registeredNativeActionCatalog = true,
  onNativeResourceRef = null,
} = {}) {
  const mutations = [];
  const entries = [];
  let release = null;
  const fileSpace = {
    schema: FILE_SPACE_SCHEMA,
    async list(path = "/") { return { path, entries: [...entries] }; },
    async createDirectory(path, name) {
      mutations.push({ path, name });
      if (deferredMutation) {
        await new Promise(resolve => { release = resolve; });
      }
      entries.push({ name, kind: "directory", size: 0, modifiedAt: 1 });
      return { path, entries: [...entries] };
    },
    async readTextFile() { throw new Error("not used"); },
    async renameEntry() { throw new Error("not used"); },
    async copyFile() { throw new Error("not used"); },
    async moveEntry() { throw new Error("not used"); },
    async trashEntry() { throw new Error("not used"); },
    async listTrash() { throw new Error("not used"); },
    async restoreTrashEntry() { throw new Error("not used"); },
    async exportFile() { throw new Error("not used"); },
    async importFile() { throw new Error("not used"); },
  };
  const native = await createNativePersonalOrdaxFileActions({
    windowRef: {},
    fileSpace,
    artifactIdentity: async () => "a".repeat(64),
  });
  const registered = createPersonalActionCatalog({
    registrations: registeredNativeActionCatalog
      ? native.actionRegistrations.map(registration => (
          onNativeResourceRef === null ? registration : {
            ...registration,
            toResourceRef(value) {
              onNativeResourceRef(value);
              return registration.toResourceRef(value);
            },
          }
        )) : [],
  });
  let currentNative = registered;
  let nativeReadFailure = null;
  const fabric = createCapabilityDiscovery({
    ...(surfaceHost === null
      ? { getFoundation: () => createSystemFoundationRuntime() }
      : { getSurfaceHost: () => surfaceHost }),
    getApplicationActions: () => null,
    getNativeActions: () => {
      if (nativeReadFailure !== null) throw nativeReadFailure;
      return currentNative;
    },
  });
  const account = identity();
  const personal = createNativePersonalOrdaxComposition({
    windowRef: { localStorage: storage },
    identitySession: account,
    intelligence,
    actionCatalog: registered,
    toolResolver: native.toolResolver,
    adapterResolver: native.adapterResolver,
    getCapabilityDiscovery: () => fabric,
  });
  return {
    personal, fabric, native, mutations, account, storage,
    setNative(next) { currentNative = next; },
    failNativeRead(error = new Error("Native catalog read unavailable")) {
      nativeReadFailure = error;
    },
    recoverNativeRead() { nativeReadFailure = null; },
    release() { assert.ok(release, "mutation must be in flight"); release(); },
  };
}

test("Native semantic catalog projects the canonical file action without execution authority", async () => {
  const env = await setup();
  try {
    const snapshot = env.personal.discoverCapabilities();
    const descriptor = snapshot.entries.find(entry =>
      entry.id === "system:action.native-file.ensure-directory");
    assert.ok(descriptor);
    assert.equal(descriptor.kind, "native-action");
    assert.equal(descriptor.ownerId, "ordax-native-file-space");
    assert.equal(descriptor.actionId, "files.directory.ensure");
    assert.equal(descriptor.availability, "declared-only");
    assert.equal(descriptor.riskClass, "local-change");
    assert.equal(descriptor.confirmation, "always");
    assert.equal(descriptor.execution, "unavailable");
    assert.equal(descriptor.authority, "none");
    assert.equal(snapshot.toolExecution, false);
    assert.deepEqual(descriptor.inputSchema.required, ["resource-value"]);
    assert.equal(typeof env.fabric.execute, "undefined");
    assert.equal(typeof env.fabric.grant, "undefined");
    const forged = structuredClone(snapshot);
    forged.entries.find(item => item.kind === "native-action").confirmation = "none";
    assert.throws(() => validateCapabilityDiscoverySnapshot(forged), /Native action/);
  } finally {
    env.personal.dispose();
  }
});

test("selected Native capability requires fresh revision, explicit consent and one verified receipt", async () => {
  const env = await setup();
  try {
    const snapshot = env.personal.discoverCapabilities();
    const work = env.personal.create("Criar uma pasta");
    const request = { resourceValue: "/Documentos/Fabric", expectedRevision: snapshot.revision };
    assert.throws(() => env.personal.requestDiscoveredNativeAction(
      work.id, "system:action.native-file.ensure-directory",
      { ...request, expectedRevision: snapshot.revision - 1 },
    ), /stale|revision/);
    assert.throws(() => env.personal.requestDiscoveredNativeAction(
      work.id, "system:action.unknown", request,
    ), /not in the current canonical/);
    const pending = env.personal.requestDiscoveredNativeAction(
      work.id, "system:action.native-file.ensure-directory", request,
    );
    assert.equal(pending.status, "pending");
    assert.deepEqual(env.mutations, [], "discovery and request cannot invoke the adapter");
    assert.throws(() => env.personal.requestDiscoveredNativeAction(
      work.id, "system:action.native-file.ensure-directory", request,
    ), /unresolved authority|requires queued or paused Work/);
    assert.equal(env.personal.approvalConsent.canApprove(work.id, pending.id), true);
    env.personal.approvalConsent.approve(work.id, pending.id);
    assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), true);
    const receipt = await env.personal.executeApprovedAction(work.id, pending.id);
    assert.equal(receipt.status, "succeeded");
    assert.deepEqual(env.mutations, [{ path: "/Documentos", name: "Fabric" }]);
    assert.equal(env.personal.getSnapshot().attempts[0].status, "succeeded");
    await assert.rejects(
      () => env.personal.executeApprovedAction(work.id, pending.id),
      /unconsumed approved approval|revoked by discovery change/,
    );
    assert.equal(env.mutations.length, 1);
  } finally {
    env.personal.dispose();
  }
});

test("Native action removal and provider artifact drift invalidate previously viewed revision", async () => {
  const env = await setup();
  try {
    const before = env.personal.discoverCapabilities();
    env.setNative(null);
    const absent = env.personal.discoverCapabilities();
    assert.equal(absent.revision, before.revision + 1);
    assert.equal(absent.entries.some(entry => entry.kind === "native-action"), false);
    const work = env.personal.create("No stale Native actions");
    assert.throws(() => env.personal.requestDiscoveredNativeAction(
      work.id, "system:action.native-file.ensure-directory",
      { resourceValue: "/Documentos/Nope", expectedRevision: before.revision },
    ), /stale/);
    const altered = createPersonalActionCatalog({
      registrations: env.native.actionRegistrations.map(item => ({
        ...item,
        entry: { ...item.entry, toolArtifactSha256: "b".repeat(64) },
      })),
    });
    env.setNative(altered);
    const changed = env.personal.discoverCapabilities();
    assert.ok(changed.revision > absent.revision);
    assert.deepEqual(changed.entries.find(entry => entry.kind === "native-action"),
      before.entries.find(entry => entry.kind === "native-action"),
      "artifact digest is private, but still changes the revision");
    assert.deepEqual(env.mutations, []);
    assert.equal(env.personal.getSnapshot().approvals.length, 0);
  } finally {
    env.personal.dispose();
  }
});

test("concurrent duplicate execution of the same approved semantic action cannot double mutate", async () => {
  const env = await setup({ deferredMutation: true });
  try {
    const revision = env.personal.discoverCapabilities().revision;
    const work = env.personal.create("Concorrencia de acao");
    const approval = env.personal.requestDiscoveredNativeAction(
      work.id, "system:action.native-file.ensure-directory",
      { resourceValue: "/Documentos/Once", expectedRevision: revision },
    );
    env.personal.approvalConsent.approve(work.id, approval.id);
    const first = env.personal.executeApprovedAction(work.id, approval.id);
    // The second call must not start a second side effect while the first is in flight.
    await assert.rejects(
      () => env.personal.executeApprovedAction(work.id, approval.id),
      /unconsumed approved approval|running|execution|queued/i,
    );
    // Allow the adapter to enter its awaited mutation before releasing it.
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(env.mutations, [{ path: "/Documentos", name: "Once" }]);
    env.release();
    assert.equal((await first).status, "succeeded");
    assert.equal(env.mutations.length, 1);
  } finally {
    env.personal.dispose();
  }
});

test("removal before consent blocks grant issuance and cannot invoke Native file adapter", async () => {
  const env = await setup();
  try {
    const revision = env.personal.discoverCapabilities().revision;
    const work = env.personal.create("Retirar provedor");
    const approval = env.personal.requestDiscoveredNativeAction(
      work.id, "system:action.native-file.ensure-directory",
      { resourceValue: "/Documentos/Revoked", expectedRevision: revision },
    );
    env.setNative(null);
    assert.equal(env.personal.approvalConsent.canApprove(work.id, approval.id), false);
    assert.throws(
      () => env.personal.approvalConsent.approve(work.id, approval.id),
      /revoked by discovery change/,
    );
    assert.deepEqual(env.mutations, []);
    assert.equal(env.personal.getSnapshot().approvals[0].status, "pending");
  } finally {
    env.personal.dispose();
  }
});

test("removal after consent revokes approved Native action before dispatch, never mutates", async () => {
  const env = await setup();
  try {
    const revision = env.personal.discoverCapabilities().revision;
    const work = env.personal.create("Revogar depois de autorizar");
    const approval = env.personal.requestDiscoveredNativeAction(
      work.id, "system:action.native-file.ensure-directory",
      { resourceValue: "/Documentos/Denied", expectedRevision: revision },
    );
    env.personal.approvalConsent.approve(work.id, approval.id);
    assert.equal(env.personal.canExecuteApprovedAction(work.id, approval.id), true);
    env.setNative(null);
    assert.equal(env.personal.canExecuteApprovedAction(work.id, approval.id), false);
    await assert.rejects(
      () => env.personal.executeApprovedAction(work.id, approval.id),
      /revoked by discovery change/,
    );
    assert.deepEqual(env.mutations, []);
    assert.equal(env.personal.getSnapshot().approvals[0].status, "revoked");
    assert.equal(env.personal.getSnapshot().attempts.length, 0);
  } finally {
    env.personal.dispose();
  }
});

test("provider identity mismatch never routes the old Native action from a new discovery revision", async () => {
  const env = await setup();
  try {
    const candidate = createPersonalActionCatalog({
      registrations: env.native.actionRegistrations.map(item => ({
        ...item,
        entry: { ...item.entry, toolArtifactSha256: "b".repeat(64) },
      })),
    });
    env.setNative(candidate);
    const revision = env.personal.discoverCapabilities().revision;
    const work = env.personal.create("Não usar ferramenta antiga");
    assert.throws(() => env.personal.requestDiscoveredNativeAction(
      work.id, "system:action.native-file.ensure-directory",
      { resourceValue: "/Documentos/Wrong", expectedRevision: revision },
    ), /not in the current canonical registration/);
    assert.equal(env.personal.getSnapshot().approvals.length, 0);
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

function modelPort(respond) {
  let calls = 0;
  return Object.freeze({
    schema: INTELLIGENCE_PORT_SCHEMA,
    get calls() { return calls; },
    getSnapshot() {
      return {
        schema: INTELLIGENCE_PORT_SCHEMA,
        state: "ready", inferenceAvailable: true,
        engineId: "llama.cpp", modelId: "test", authority: "none",
        toolExecution: false,
      };
    },
    subscribe() { return () => {}; },
    async respond(request) {
      calls += 1;
      const result = await respond(request);
      return {
        schema: INTELLIGENCE_RESPONSE_SCHEMA,
        text: result, engineId: "llama.cpp", modelId: "test", authority: "none",
      };
    },
  });
}
const proposedDirectory = JSON.stringify({
  kind: "proposal", entryId: "native-file.ensure-directory",
  resourceValue: "/Documentos/FromAura", rationale: "Explicit human review required",
});

test("Aura existing Native planner uses live Fabric entries and same grant approval fence", async () => {
  const model = modelPort(async () => proposedDirectory);
  const env = await setup({ intelligence: model });
  try {
    assert.equal(env.personal.listAvailableActions().length, 1);
    const work = env.personal.create("Criar pasta na Area de Documentos");
    const proposal = await env.personal.proposeActionForWork(work.id);
    assert.equal(model.calls, 1);
    assert.equal(proposal.entryId, "native-file.ensure-directory");
    assert.equal(proposal.approvalRequested, false);
    assert.equal(env.personal.getSnapshot().approvals.length, 0);
    const pending = env.personal.requestProposedAction(proposal);
    assert.equal(pending.status, "pending");
    assert.deepEqual(env.mutations, []);
    env.setNative(null);
    assert.deepEqual(env.personal.listAvailableActions(), []);
    assert.equal(env.personal.approvalConsent.canApprove(work.id, pending.id), false);
    assert.throws(() => env.personal.approvalConsent.approve(work.id, pending.id),
      /revoked by discovery change/);
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("Aura abstains when a Native action was already uninstalled before inference", async () => {
  const model = modelPort(async () => proposedDirectory);
  const env = await setup({ intelligence: model });
  try {
    env.setNative(null);
    const work = env.personal.create("Criar pasta");
    assert.equal(await env.personal.proposeActionForWork(work.id), null);
    assert.equal(model.calls, 0, "no model call when there are no current actions");
    assert.deepEqual(env.personal.listAvailableActions(), []);
  } finally {
    env.personal.dispose();
  }
});

test("removal during asynchronous Aura inference invalidates selected Native action", async () => {
  let release;
  const model = modelPort(() => new Promise(resolve => {
    release = () => resolve(proposedDirectory);
  }));
  const env = await setup({ intelligence: model });
  try {
    const work = env.personal.create("Criar pasta em Documentos");
    const pending = env.personal.proposeActionForWork(work.id);
    assert.equal(model.calls, 1);
    env.setNative(null);
    release();
    await assert.rejects(pending, /no longer current|capability changed/);
    assert.equal(env.personal.getSnapshot().approvals.length, 0);
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("manual Native action proposals and direct UI requests share Fabric stale gates", async () => {
  const env = await setup();
  try {
    const work = env.personal.create("Criar pasta manualmente");
    const proposed = env.personal.proposeAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/Manual", rationale: "Explicit review" },
    );
    env.setNative(null);
    assert.throws(() => env.personal.requestProposedAction(proposed),
      /stale|not in the current canonical registration/);
    assert.throws(() => env.personal.requestAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/Direct" },
    ), /not in the current canonical registration/);
    assert.deepEqual(env.mutations, []);
    assert.equal(env.personal.getSnapshot().approvals.length, 0);
  } finally {
    env.personal.dispose();
  }
});

test("direct UI request from current Native catalog is bound to revocation", async () => {
  const env = await setup();
  try {
    const work = env.personal.create("Criar pasta via UI");
    const approval = env.personal.requestAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/Direct" },
    );
    assert.equal(approval.status, "pending");
    env.personal.approvalConsent.approve(work.id, approval.id);
    env.setNative(null);
    assert.equal(env.personal.canExecuteApprovedAction(work.id, approval.id), false);
    await assert.rejects(() => env.personal.executeApprovedAction(
      work.id, approval.id,
    ), /revoked by discovery change/);
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("account A-B-A never revives a previous Native approval, even with reused approval IDs", async () => {
  const env = await setup();
  try {
    const workA = env.personal.create("Conta A pasta");
    const approvalA = env.personal.requestAvailableAction(
      workA.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/OwnerA" },
    );
    env.personal.approvalConsent.approve(workA.id, approvalA.id);
    assert.equal(env.personal.canExecuteApprovedAction(workA.id, approvalA.id), true);

    env.account.switchTo("user-b");
    const workB = env.personal.create("Conta B pasta");
    const approvalB = env.personal.requestAvailableAction(
      workB.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/OwnerB" },
    );
    assert.equal(approvalA.id, approvalB.id,
      "the owner-local approval ordinal is reused on B");
    assert.equal(env.personal.approvalConsent.canApprove(workB.id, approvalB.id), true);

    env.account.switchTo("user-a");
    assert.equal(env.personal.canExecuteApprovedAction(workA.id, approvalA.id), false);
    await assert.rejects(
      () => env.personal.executeApprovedAction(workA.id, approvalA.id),
      /revoked by discovery change/,
    );
    assert.deepEqual(env.mutations, []);

    env.account.switchTo("user-b");
    assert.equal(env.personal.approvalConsent.canApprove(workB.id, approvalB.id), false,
      "round-trip cannot make B's pre-switch consent current again");
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("a persisted Native pending approval without a current Fabric fence cannot gain consent after restart", async () => {
  const storage = localStorage();
  const initial = await setup({ storage });
  const work = initial.personal.create("Aguardando aprovacao no disco");
  const approval = initial.personal.requestAvailableAction(
    work.id, "native-file.ensure-directory",
    { resourceValue: "/Documentos/AfterRestart" },
  );
  assert.equal(approval.status, "pending");
  initial.personal.dispose();

  const restored = await setup({ storage });
  try {
    const pending = restored.personal.getSnapshot().approvals.find(
      entry => entry.id === approval.id,
    );
    assert.ok(pending, "pending approval must be restored as existing Work state");
    assert.equal(pending.status, "pending");
    assert.equal(restored.personal.approvalConsent.canApprove(work.id, approval.id), false);
    assert.throws(() => restored.personal.approvalConsent.approve(
      work.id, approval.id,
    ), /revoked by discovery change/);
    assert.deepEqual(restored.mutations, []);
  } finally {
    restored.personal.dispose();
  }
});

test("low-level Personal start and prepare cannot bypass Native discovery revocation", async () => {
  const env = await setup();
  try {
    const work = env.personal.create("Prevent low-level dispatch");
    const approval = env.personal.requestAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/NoBypass" },
    );
    env.personal.approvalConsent.approve(work.id, approval.id);
    env.setNative(null);
    assert.throws(
      () => env.personal.prepareActionExecution(work.id, approval.id),
      /revoked by discovery change/,
    );
    assert.throws(
      () => env.personal.startActionExecution(work.id, approval.id),
      /revoked by discovery change/,
    );
    assert.equal(env.personal.getSnapshot().attempts.length, 0);
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("low-level approval resolution cannot bypass a removed Native provider", async () => {
  const env = await setup();
  try {
    const work = env.personal.create("Prevent low-level consent");
    const approval = env.personal.requestAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/NoConsent" },
    );
    env.setNative(null);
    assert.throws(
      () => env.personal.resolveApproval(work.id, approval.id, { grantRef: "forged" }),
      /revoked by discovery change/,
    );
    assert.equal(env.personal.getSnapshot().approvals[0].status, "pending");
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("direct raw Personal requestApproval cannot mint an unbound Native approval", async () => {
  const env = await setup();
  try {
    const entry = env.native.actionRegistrations[0].entry;
    const work = env.personal.create("Prevent raw Native request");
    assert.throws(() => env.personal.requestApproval(work.id, {
      toolId: entry.toolId,
      toolArtifactSha256: entry.toolArtifactSha256,
      actionId: entry.actionId,
      effect: entry.effect,
      resourceRef: "file-space:/Documentos/Injected",
      reason: "Bypass the current catalog revision",
    }), /current Native discovery|Native catalog/);
    assert.equal(env.personal.getSnapshot().approvals.length, 0);
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("explicit denial remains possible after a Native provider disappears", async () => {
  const env = await setup();
  try {
    const work = env.personal.create("Denial after removal");
    const pending = env.personal.requestAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/NoGrant" },
    );
    env.setNative(null);
    const result = env.personal.resolveApproval(work.id, pending.id, {
      userDecision: "deny",
    });
    assert.equal(result.decision, "deny");
    assert.equal(env.personal.getSnapshot().approvals[0].status, "denied");
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("Fabric guard keeps unrelated canonical Personal approval lifecycle available", async () => {
  const env = await setup();
  try {
    const work = env.personal.create("Existing non-Native workflow");
    const pending = env.personal.requestApproval(work.id, {
      actionId: "other.action",
      toolId: "other-tool",
      toolArtifactSha256: "d".repeat(64),
      effect: "write",
      resourceRef: "other:resource",
      reason: "Non-Native policy review still uses canonical Personal OrdaX.",
    });
    assert.equal(pending.status, "pending");
    const resolved = env.personal.resolveApproval(work.id, pending.id, {
      userDecision: "deny",
    });
    assert.equal(resolved.decision, "deny");
    assert.equal(env.personal.getSnapshot().approvals[0].status, "denied");
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("existing Native Host and Fabric events proactively revoke a stale granted approval", async () => {
  const browserListeners = new Map();
  const browser = {
    navigator: { onLine: true },
    addEventListener(type, listener) { browserListeners.set(type, listener); },
    removeEventListener(type) { browserListeners.delete(type); },
  };
  const host = createNativeSurfaceHost(browser, {
    networkStatusAvailable: true,
  });
  const env = await setup({ surfaceHost: host });
  let notices = 0;
  const unsubscribe = env.fabric.subscribe(() => {
    notices += 1;
    env.personal.reconcileApprovedAuthority();
  });
  try {
    const work = env.personal.create("Provider disappears after user grants");
    const approval = env.personal.requestAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/Proactive" },
    );
    env.personal.approvalConsent.approve(work.id, approval.id);
    assert.equal(env.personal.canExecuteApprovedAction(work.id, approval.id), true);
    host.refresh();
    assert.equal(notices, 0, "unchanged Host must not churn grant state");
    env.setNative(null);
    const removed = env.fabric.refresh();
    assert.equal(removed.entries.some(entry => entry.kind === "native-action"), false);
    assert.equal(notices, 1);
    const snapshot = env.personal.getSnapshot();
    assert.equal(snapshot.approvals[0].status, "revoked",
      "the preexisting Personal grant revoker must fire on catalog change");
    assert.equal(snapshot.attempts.length, 0);
    assert.equal(env.personal.canExecuteApprovedAction(work.id, approval.id), false);
    assert.deepEqual(env.mutations, []);
    env.fabric.refresh();
    assert.equal(notices, 1, "same revision must not emit a second revoke event");
  } finally {
    unsubscribe();
    env.personal.dispose();
    host.dispose();
    assert.equal(browserListeners.size, 0);
  }
});

test("provider artifact change proactively revokes a grant even with identical public actions", async () => {
  const browser = {
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  };
  const host = createNativeSurfaceHost(browser);
  const env = await setup({ surfaceHost: host });
  const unsubscribe = env.fabric.subscribe(() => {
    env.personal.reconcileApprovedAuthority();
  });
  try {
    const work = env.personal.create("Never dispatch through a substituted tool");
    const approval = env.personal.requestAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/Substitute" },
    );
    env.personal.approvalConsent.approve(work.id, approval.id);
    const before = env.fabric.snapshot();
    env.setNative(createPersonalActionCatalog({
      registrations: env.native.actionRegistrations.map(registration => ({
        ...registration,
        entry: { ...registration.entry, toolArtifactSha256: "b".repeat(64) },
      })),
    }));
    const changed = env.fabric.refresh();
    assert.equal(changed.revision, before.revision + 1);
    assert.deepEqual(changed.entries, before.entries,
      "public Native descriptors are unchanged despite private provider drift");
    assert.equal(env.personal.getSnapshot().approvals[0].status, "revoked");
    assert.equal(env.personal.getSnapshot().attempts.length, 0);
    assert.deepEqual(env.mutations, []);
  } finally {
    unsubscribe();
    env.personal.dispose();
    host.dispose();
  }
});

test("a throwing Native discovery source reports Host error and revokes the existing grant without dispatch", async () => {
  const browser = {
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  };
  const host = createNativeSurfaceHost(browser);
  const env = await setup({ surfaceHost: host });
  const failures = [];
  const unsubscribe = env.fabric.subscribe(
    () => env.personal.reconcileApprovedAuthority(),
    error => {
      failures.push(error);
      // Same canonical failure path installed in Native main composition.
      env.personal.reconcileApprovedAuthority();
    },
  );
  try {
    const work = env.personal.create("Must lose Native grant on source read failure");
    const approval = env.personal.requestAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/UnavailableSource" },
    );
    env.personal.approvalConsent.approve(work.id, approval.id);
    assert.equal(env.personal.canExecuteApprovedAction(work.id, approval.id), true);
    env.failNativeRead();
    host.refresh();
    assert.equal(failures.length, 1);
    assert.match(failures[0].message, /Native catalog read unavailable/);
    assert.equal(env.personal.getSnapshot().approvals[0].status, "revoked");
    assert.equal(env.personal.canExecuteApprovedAction(work.id, approval.id), false);
    assert.deepEqual(env.mutations, []);
    env.recoverNativeRead();
    host.refresh();
    assert.equal(env.personal.canExecuteApprovedAction(work.id, approval.id), false,
      "restoring the same provider cannot resurrect a revoked grant");
    const next = env.personal.create("New work after recovery");
    const replacement = env.personal.requestAvailableAction(
      next.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/NewApproval" },
    );
    assert.equal(replacement.status, "pending");
  } finally {
    unsubscribe();
    env.personal.dispose();
    host.dispose();
  }
});

test("Store-driven refresh failure rejects stale Native metadata and canonical reconciliation revokes grant", async () => {
  const env = await setup();
  try {
    const work = env.personal.create("Store update with broken capability source");
    const approval = env.personal.requestAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/StoreFailure" },
    );
    env.personal.approvalConsent.approve(work.id, approval.id);
    const revision = env.fabric.snapshot().revision;
    env.failNativeRead();
    assert.throws(() => env.fabric.refresh(), /Native catalog read unavailable/);
    // The Store subscriber routes this error to the Native composition
    // diagnostic handler, which calls the existing Personal reconciler.
    assert.equal(env.personal.reconcileApprovedAuthority(), true);
    assert.equal(env.personal.getSnapshot().approvals[0].status, "revoked");
    assert.deepEqual(env.mutations, []);
    env.recoverNativeRead();
    assert.equal(env.fabric.snapshot().revision, revision + 1,
      "recovery after a failed read must be a new provider generation");
    assert.equal(env.personal.canExecuteApprovedAction(work.id, approval.id), false);
  } finally {
    env.personal.dispose();
  }
});

test("a pending Native approval stays stale after an unreadable catalog recovers with the same provider", async () => {
  const env = await setup();
  try {
    const work = env.personal.create("Pending Native review before observation gap");
    const before = env.personal.discoverCapabilities();
    const pending = env.personal.requestDiscoveredNativeAction(
      work.id, "system:action.native-file.ensure-directory",
      {
        resourceValue: "/Documentos/PendingBeforeGap",
        expectedRevision: before.revision,
      },
    );
    assert.equal(env.personal.approvalConsent.canApprove(work.id, pending.id), true);
    env.failNativeRead();
    assert.throws(() => env.personal.discoverCapabilities(), /Native catalog read unavailable/);
    assert.equal(env.personal.approvalConsent.canApprove(work.id, pending.id), false);
    env.recoverNativeRead();
    const reattested = env.personal.discoverCapabilities();
    assert.deepEqual(reattested.entries, before.entries);
    assert.ok(reattested.revision > before.revision,
      "an unobservable provider gap must invalidate previously issued revisions");
    assert.equal(env.personal.approvalConsent.canApprove(work.id, pending.id), false);
    assert.throws(
      () => env.personal.approvalConsent.approve(work.id, pending.id),
      /revoked by discovery change/,
    );
    assert.equal(env.personal.getSnapshot().approvals[0].status, "pending");
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("provider identity read failure between discovery and action selection forces reattestation", async () => {
  const env = await setup();
  try {
    const initial = env.fabric.snapshot();
    const registration = env.native.actionRegistrations[0].entry;
    env.failNativeRead();
    assert.throws(
      () => env.fabric.isNativeActionRegistered(registration),
      /Native catalog read unavailable/,
    );
    env.recoverNativeRead();
    const reattested = env.fabric.snapshot();
    assert.deepEqual(reattested.entries, initial.entries);
    assert.ok(reattested.revision > initial.revision,
      "failed action identity reads cannot retain the previous approval revision");
    assert.equal(env.fabric.isNativeActionRegistered(registration), true);
  } finally {
    env.personal.dispose();
  }
});

test("temporary absence during registration identity resolution invalidates previous revision", async () => {
  const env = await setup();
  try {
    const initial = env.fabric.snapshot();
    const registration = env.native.actionRegistrations[0].entry;
    env.setNative(null);
    assert.equal(env.fabric.isNativeActionRegistered(registration), false);
    env.setNative(createPersonalActionCatalog({
      registrations: env.native.actionRegistrations,
    }));
    const recovered = env.fabric.snapshot();
    assert.deepEqual(recovered.entries, initial.entries);
    assert.ok(recovered.revision > initial.revision);
  } finally {
    env.personal.dispose();
  }
});

test("persisted Native approval cannot regain consent when its canonical registration is gone but the old tool resolver still exists", async () => {
  const storage = localStorage();
  const original = await setup({ storage });
  const work = original.personal.create("Old file action must not survive removed registration");
  const pending = original.personal.requestAvailableAction(
    work.id, "native-file.ensure-directory",
    { resourceValue: "/Documentos/RemovedBeforeRestart" },
  );
  assert.equal(pending.status, "pending");
  original.personal.dispose();
  const restored = await setup({
    storage, registeredNativeActionCatalog: false,
  });
  try {
    assert.equal(restored.personal.discoverCapabilities().entries
      .some(item => item.kind === "native-action"), false);
    assert.equal(restored.personal.getSnapshot().approvals[0].status, "pending");
    assert.equal(restored.personal.approvalConsent.canApprove(work.id, pending.id), false);
    assert.throws(
      () => restored.personal.approvalConsent.approve(work.id, pending.id),
      /revoked by discovery change|not current/,
    );
    assert.deepEqual(restored.mutations, []);
  } finally {
    restored.personal.dispose();
  }
});

test("raw Native tool approval requests are denied even when registration is absent but resolver remains loaded", async () => {
  const env = await setup({ registeredNativeActionCatalog: false });
  try {
    const work = env.personal.create("No manual resurrection of removed Native tool");
    const entry = env.native.actionRegistrations[0].entry;
    assert.throws(() => env.personal.requestApproval(work.id, {
      toolId: entry.toolId,
      toolArtifactSha256: entry.toolArtifactSha256,
      actionId: entry.actionId,
      effect: entry.effect,
      resourceRef: "file-space:/Documentos/RawRemoved",
      reason: "Bypass catalog removal",
    }), /Native catalog|current Native discovery/);
    assert.equal(env.personal.getSnapshot().approvals.length, 0);
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("Native registration removed reentrantly during resource validation must not mint a new approval", async () => {
  let env = null;
  const current = await setup({
    onNativeResourceRef() { env.setNative(null); },
  });
  env = current;
  try {
    const work = env.personal.create("Reject stale request before creating approval");
    assert.throws(
      () => env.personal.requestAvailableAction(
        work.id, "native-file.ensure-directory",
        { resourceValue: "/Documentos/ReentrantRemoval" },
      ),
      /stale|revision|registered|current|changed/i,
    );
    assert.deepEqual(env.personal.getSnapshot().approvals, [],
      "resource validation that withdraws the provider must not create a pending authorization");
    assert.deepEqual(env.mutations, []);
  } finally {
    env.personal.dispose();
  }
});

test("Native account switch during request state notification cannot issue a cross-owner approval fence", async () => {
  const env = await setup();
  let changedOwner = false;
  const unsubscribe = env.personal.subscribe(snapshot => {
    if (!changedOwner && snapshot.approvals.some(approval => approval.status === "pending")) {
      changedOwner = true;
      env.account.switchTo("user-b");
    }
  });
  try {
    const work = env.personal.create("No fence from account A into B");
    assert.throws(
      () => env.personal.requestAvailableAction(
        work.id, "native-file.ensure-directory",
        { resourceValue: "/Documentos/ReentrantOwner" },
      ),
      /owner|context|changed|stale/i,
    );
    assert.equal(changedOwner, true);
    assert.deepEqual(env.personal.getSnapshot().approvals, []);
    env.account.switchTo("user-a");
    const pending = env.personal.getSnapshot().approvals;
    assert.equal(pending.length, 1,
      "the runtime may persist A's pending request before a synchronous owner event");
    assert.equal(env.personal.approvalConsent.canApprove(work.id, pending[0].id), false);
    assert.deepEqual(env.mutations, []);
  } finally {
    unsubscribe();
    env.personal.dispose();
  }
});

test("Host subscription startup gap revokes a Native grant removed before listener attachment", async () => {
  const rawHost = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  });
  let duringRegistration = () => {};
  const host = Object.freeze({
    ...rawHost,
    subscribe(listener) {
      duringRegistration();
      return rawHost.subscribe(listener);
    },
  });
  const env = await setup({ surfaceHost: host });
  try {
    const work = env.personal.create("Revoke grant lost during Host subscription setup");
    const pending = env.personal.requestAvailableAction(
      work.id, "native-file.ensure-directory",
      { resourceValue: "/Documentos/RemovedDuringSubscribe" },
    );
    env.personal.approvalConsent.approve(work.id, pending.id);
    assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), true);
    duringRegistration = () => env.setNative(null);
    const received = [];
    const unsubscribe = env.fabric.subscribe(snapshot => {
      received.push(snapshot.revision);
      env.personal.reconcileApprovedAuthority();
    });
    try {
      assert.equal(received.length, 1,
        "subscription catch-up must notify revocation without needing a later Host event");
      assert.equal(env.personal.getSnapshot().approvals[0].status, "revoked");
      assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), false);
      assert.deepEqual(env.mutations, []);
      rawHost.refresh();
      assert.equal(received.length, 1, "subsequent Host events must not duplicate revocation");
    } finally {
      unsubscribe();
    }
  } finally {
    env.personal.dispose();
    rawHost.dispose();
  }
});

test("disposed Surface Personal instance cannot re-expose Native tools or mint an old grant", async () => {
  const env = await setup();
  const work = env.personal.create("Never authorize Native file action after teardown");
  const pending = env.personal.requestAvailableAction(
    work.id, "native-file.ensure-directory",
    { resourceValue: "/Documentos/TeardownFence" },
  );
  env.personal.dispose();
  assert.deepEqual(env.personal.listAvailableActions(), []);
  assert.equal(env.personal.approvalConsent.canApprove(work.id, pending.id), false);
  assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), false);
  assert.throws(() => env.personal.approvalConsent.approve(work.id, pending.id),
    /disposed|unavailable|closed/i);
  assert.throws(() => env.personal.requestAvailableAction(
    work.id, "native-file.ensure-directory",
    { resourceValue: "/Documentos/ForbiddenAfterTeardown" },
  ), /disposed|unavailable|closed/i);
  const original = env.native.actionRegistrations[0].entry;
  assert.throws(() => env.personal.requestApproval(work.id, {
    toolId: original.toolId,
    actionId: original.actionId,
    toolArtifactSha256: original.toolArtifactSha256,
    effect: original.effect,
    resourceRef: "file-space:/Documentos/RawAfterTeardown",
    reason: "Bypass after teardown",
  }), /disposed|unavailable|closed/i);
  await assert.rejects(
    () => env.personal.executeApprovedAction(work.id, pending.id),
    /disposed|unavailable|closed/i,
  );
  assert.deepEqual(env.mutations, []);
  env.personal.dispose();
});
