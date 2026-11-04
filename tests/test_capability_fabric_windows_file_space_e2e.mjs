import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, readdir, stat } from "node:fs/promises";

import { IDENTITY_SESSION_SCHEMA } from "../system/contracts/identity-session.mjs";
import { createNativeSurfaceHost } from "../system/adapters/native/runtime.mjs";
import { createDesktopFileSpaceMiddleware } from
  "../system/adapters/desktop/file-space-host.mjs";
import { createNativeFileSpace } from
  "../system/adapters/native/file-space.mjs";
import { createNativePersonalOrdaxFileActions } from
  "../system/adapters/native/personal-ordax-file-actions.mjs";
import { createNativePersonalOrdaxComposition } from
  "../system/composition/native/personal-ordax.mjs";
import { createCapabilityDiscovery } from
  "../system/services/system-foundation/capability-discovery.mjs";
import { createPersonalActionCatalog } from
  "../system/services/personal-ordax/action-catalog.mjs";
import { createIntelligenceToolGrantAuthority } from
  "../system/services/intelligence/tool-grants.mjs";

const CAPABILITY_ID = "system:action.native-file.ensure-directory";

function memoryStore() {
  const map = new Map();
  return {
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
  };
}

async function physicalWindowsFixture(t, { exposeGrantAuthority = false } = {}) {
  // This tests the production Windows HTTP middleware and real native disk
  // adapter, not a fake File Space response or a mocked directory mutation.
  const isolated = await mkdtemp(join(tmpdir(), "ordax-fabric-win-"));
  const folder = join(isolated, "Files");
  const token = "a".repeat(64);
  const middleware = createDesktopFileSpaceMiddleware(folder, { token });
  let loseMutationResponse = false;
  let holdCommittedMutation = null;
  const server = createServer((req, res) => {
    if (holdCommittedMutation !== null && req.method === "POST" &&
        req.url?.split("?")[0] === "/__ordax/native/files") {
      const hold = holdCommittedMutation;
      holdCommittedMutation = null;
      const originalEnd = res.end.bind(res);
      res.end = (...args) => {
        // The actual Windows middleware has already committed its disk
        // operation. Delay only its transport reply, never the mutation.
        hold.committed();
        void hold.releasePromise.then(() => originalEnd(...args));
        return res;
      };
    }
    if (loseMutationResponse && req.method === "POST" &&
        req.url?.split("?")[0] === "/__ordax/native/files") {
      // Induce transport uncertainty ONLY after the real host sends the
      // mutation result: the folder is committed but the client gets no receipt.
      res.end = function loseReply() {
        loseMutationResponse = false;
        this.socket?.destroy();
        return this;
      };
    }
    return middleware(req, res, () => {
      res.writeHead(404);
      res.end("not found");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await rm(isolated, { recursive: true, force: true });
  });
  const origin = "http://127.0.0.1:" + server.address().port;
  const windowRef = {
    fetch(path, options = {}) {
      return fetch(origin + path, {
        ...options,
        headers: {
          ...(options.headers ?? {}),
          "X-OrdaX-File-Token": token,
          ...(options.method === "POST" ? { Origin: origin } : {}),
        },
      });
    },
  };
  const fileSpace = await createNativeFileSpace(windowRef);
  const fileActions = await createNativePersonalOrdaxFileActions({
    windowRef, fileSpace,
    artifactIdentity: async () => "e".repeat(64),
  });
  const catalog = createPersonalActionCatalog({
    registrations: fileActions.actionRegistrations,
  });
  let currentCatalog = catalog;
  let registeredCatalog = catalog;
  let beforeNextAdapterResolve = null;
  const nativeHost = createNativeSurfaceHost({
    navigator: { onLine: true },
    addEventListener() {},
    removeEventListener() {},
  });
  t.after(() => nativeHost.dispose());
  const fabric = createCapabilityDiscovery({
    getSurfaceHost: () => nativeHost,
    getApplicationActions: () => null,
    getNativeActions: () => currentCatalog,
  });
  let currentSubject = "test-physical-windows";
  const identityListeners = new Set();
  const identity = {
    schema: IDENTITY_SESSION_SCHEMA,
    getSnapshot() {
      return {
        state: "signed-in",
        subjectId: currentSubject,
        displayName: "Native Windows Test",
      };
    },
    subscribe(listener) {
      identityListeners.add(listener);
      return () => identityListeners.delete(listener);
    },
  };
  const storage = memoryStore();
  const grantAuthority = exposeGrantAuthority ? createIntelligenceToolGrantAuthority() : null;
  if (grantAuthority !== null) t.after(() => grantAuthority.dispose());
  const composePersonal = () => createNativePersonalOrdaxComposition({
    windowRef: { localStorage: storage },
    identitySession: identity,
    intelligence: null,
    actionCatalog: registeredCatalog,
    toolResolver: fileActions.toolResolver,
    adapterResolver(...args) {
      const callback = beforeNextAdapterResolve;
      beforeNextAdapterResolve = null;
      callback?.();
      return fileActions.adapterResolver(...args);
    },
    getCapabilityDiscovery: () => fabric,
    ...(grantAuthority === null ? {} : { grantAuthority }),
  });
  let personal = composePersonal();
  t.after(() => personal.dispose());
  return {
    folder, origin, fabric, fileSpace,
    get personal() { return personal; },
    revokeGrantSilently(grantRef) {
      if (grantAuthority === null) throw new Error("No external authority in this fixture");
      return grantAuthority.issuer.revoke(grantRef);
    },
    switchOwner(subjectId) {
      currentSubject = subjectId;
      for (const listener of [...identityListeners]) {
        listener(identity.getSnapshot());
      }
    },
    restartPersonal() {
      personal.dispose();
      personal = composePersonal();
      return personal;
    },
    disableProvider() { currentCatalog = null; },
    interceptNextAdapterResolution(callback) {
      beforeNextAdapterResolve = callback;
    },
    removeNativeRegistration() {
      registeredCatalog = createPersonalActionCatalog({ registrations: [] });
      currentCatalog = registeredCatalog;
    },
    loseMutationResponse() { loseMutationResponse = true; },
    holdNextCommittedMutation() {
      if (holdCommittedMutation !== null) {
        throw new Error("Only one isolated HTTP mutation may be held");
      }
      let committed;
      let release;
      const committedPromise = new Promise(resolve => { committed = resolve; });
      const releasePromise = new Promise(resolve => { release = resolve; });
      holdCommittedMutation = { committed, releasePromise };
      return Object.freeze({ committed: committedPromise, release });
    },
  };
}

function requestReview(env, name) {
  const work = env.personal.create("Create physical Windows folder " + name);
  const revision = env.fabric.snapshot().revision;
  const pending = env.personal.requestDiscoveredNativeAction(
    work.id, CAPABILITY_ID, {
      resourceValue: "/" + name,
      expectedRevision: revision,
    },
  );
  return { work, pending };
}

test("Windows physical host: consent -> typed executor -> real directory -> receipt", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "FabricPhysical");
  assert.equal(pending.status, "pending");
  assert.deepEqual(await readdir(env.folder), []);
  assert.equal(env.personal.approvalConsent.canApprove(work.id, pending.id), true);
  env.personal.approvalConsent.approve(work.id, pending.id);
  assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), true);
  const receipt = await env.personal.executeApprovedAction(work.id, pending.id);
  assert.equal(receipt.status, "succeeded");
  assert.equal((await stat(join(env.folder, "FabricPhysical"))).isDirectory(), true);
  assert.deepEqual(await readdir(env.folder), ["FabricPhysical"]);
  assert.equal(env.personal.getSnapshot().approvals[0].status, "executed");
  assert.equal(env.personal.getSnapshot().attempts[0].status, "succeeded");
  assert.equal(env.personal.getSnapshot().results.length, 0);
  await assert.rejects(
    () => env.personal.executeApprovedAction(work.id, pending.id),
    /unconsumed|revoked by discovery change/,
  );
  assert.deepEqual(await readdir(env.folder), ["FabricPhysical"]);
});

test("Windows physical host: same directory through separate approved Work is idempotent", async t => {
  const env = await physicalWindowsFixture(t);
  for (let count = 0; count < 2; count += 1) {
    const { work, pending } = requestReview(env, "SamePhysical");
    env.personal.approvalConsent.approve(work.id, pending.id);
    const receipt = await env.personal.executeApprovedAction(work.id, pending.id);
    assert.equal(receipt.status, "succeeded");
    assert.equal(env.personal.getSnapshot().attempts.at(-1).status, "succeeded");
  }
  assert.deepEqual(await readdir(env.folder), ["SamePhysical"]);
  assert.equal((await stat(join(env.folder, "SamePhysical"))).isDirectory(), true);
});

test("Windows physical host: provider removal after grant revokes before disk mutation", async t => {
  const env = await physicalWindowsFixture(t);
  const unsubscribe = env.fabric.subscribe(() => env.personal.reconcileApprovedAuthority());
  t.after(unsubscribe);
  const { work, pending } = requestReview(env, "MustNotExist");
  env.personal.approvalConsent.approve(work.id, pending.id);
  env.disableProvider();
  env.fabric.refresh();
  const approval = env.personal.getSnapshot().approvals.find(entry => entry.id === pending.id);
  assert.equal(approval.status, "revoked");
  assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), false);
  await assert.rejects(
    () => env.personal.executeApprovedAction(work.id, pending.id),
    /revoked by discovery change/,
  );
  assert.deepEqual(await readdir(env.folder), []);
});

test("Windows physical host: traversal and raw HTTP requests fail before side effect", async t => {
  const env = await physicalWindowsFixture(t);
  const work = env.personal.create("Prevent filesystem traversal");
  const revision = env.fabric.snapshot().revision;
  assert.throws(() => env.personal.requestDiscoveredNativeAction(
    work.id, CAPABILITY_ID, {
      resourceValue: "/../outside", expectedRevision: revision,
    },
  ), /invalid|path|traversal/);
  const rawResponse = await fetch(env.origin + "/__ordax/native/files?path=%2F");
  assert.equal(rawResponse.status, 401);
  assert.equal(env.personal.getSnapshot().approvals.length, 0);
  assert.deepEqual(await readdir(env.folder), []);
});

test("Windows physical host: lost receipt after committed disk mutation remains uncertain without retry", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "CommitWithoutReceipt");
  env.personal.approvalConsent.approve(work.id, pending.id);
  env.loseMutationResponse();
  await assert.rejects(
    () => env.personal.executeApprovedAction(work.id, pending.id),
    /fetch failed|failed|socket|terminated|disconnect/i,
  );
  // The Windows host wrote to the real disk before the socket was lost.
  assert.equal((await stat(join(env.folder, "CommitWithoutReceipt"))).isDirectory(), true);
  const snapshot = env.personal.getSnapshot();
  assert.equal(snapshot.attempts.length, 1);
  assert.equal(snapshot.attempts[0].status, "uncertain");
  assert.equal(snapshot.approvals[0].status, "revoked");
  assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), false);
  await assert.rejects(
    () => env.personal.executeApprovedAction(work.id, pending.id),
    /revoked by discovery change|approved|queued|unconsumed/i,
  );
  assert.deepEqual(await readdir(env.folder), ["CommitWithoutReceipt"]);
  const restored = env.restartPersonal();
  const afterRestart = restored.getSnapshot();
  assert.equal(afterRestart.attempts.length, 1,
    "the uncertain attempt must survive rebuilding the Personal composition");
  assert.equal(afterRestart.attempts[0].status, "uncertain");
  assert.equal(afterRestart.approvals[0].status, "revoked");
  assert.equal(restored.canExecuteApprovedAction(work.id, pending.id), false);
  await assert.rejects(
    () => restored.executeApprovedAction(work.id, pending.id),
    /revoked by discovery change|approved|queued|unconsumed/i,
  );
  assert.deepEqual(await readdir(env.folder), ["CommitWithoutReceipt"],
    "restart must not silently repeat a disk mutation");
});

test("Windows physical host: explicit consent denial never touches disk", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "DeniedByUser");
  assert.equal(env.personal.approvalConsent.canApprove(work.id, pending.id), true);
  const decision = env.personal.approvalConsent.deny(work.id, pending.id);
  assert.equal(decision.decision, "deny");
  assert.equal(env.personal.getSnapshot().approvals[0].status, "denied");
  assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), false);
  assert.deepEqual(await readdir(env.folder), []);
});

test("Windows physical host: duplicate concurrent foreground execution commits one disk action", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "ConcurrentOnce");
  env.personal.approvalConsent.approve(work.id, pending.id);
  const results = await Promise.allSettled([
    env.personal.executeApprovedAction(work.id, pending.id),
    env.personal.executeApprovedAction(work.id, pending.id),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.equal(results.find(result => result.status === "fulfilled").value.status, "succeeded");
  assert.equal(env.personal.getSnapshot().attempts.length, 1);
  assert.equal(env.personal.getSnapshot().attempts[0].status, "succeeded");
  assert.deepEqual(await readdir(env.folder), ["ConcurrentOnce"]);
});

test("Windows physical host: removed Native registration cannot revive persisted consent or write on disk after restart", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "StaleAfterRemoval");
  assert.equal(env.personal.approvalConsent.canApprove(work.id, pending.id), true);
  assert.deepEqual(await readdir(env.folder), []);
  env.removeNativeRegistration();
  const restored = env.restartPersonal();
  assert.equal(restored.discoverCapabilities().entries
    .some(entry => entry.kind === "native-action"), false);
  assert.equal(restored.getSnapshot().approvals[0].status, "pending");
  assert.equal(restored.approvalConsent.canApprove(work.id, pending.id), false);
  assert.throws(
    () => restored.approvalConsent.approve(work.id, pending.id),
    /revoked by discovery change/,
  );
  assert.equal(restored.canExecuteApprovedAction(work.id, pending.id), false);
  assert.deepEqual(await readdir(env.folder), [],
    "no filesystem mutation may happen through a removed native registration");
});

test("Windows physical host: an approved but unexecuted Native action cannot survive Surface restart", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "RestartBeforeDispatch");
  assert.deepEqual(await readdir(env.folder), []);
  env.personal.approvalConsent.approve(work.id, pending.id);
  assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), true);
  // Restart the real Personal composition over the same persisted owner
  // journal. The provider is still installed; only the session-local
  // discovery attestation and grant issuer are new.
  const restored = env.restartPersonal();
  assert.equal(restored.canExecuteApprovedAction(work.id, pending.id), false,
    "previously approved action is not authorized by a new Surface session");
  const historical = restored.getSnapshot().approvals.find(item => item.id === pending.id);
  assert.equal(historical?.status, "revoked");
  await assert.rejects(
    () => restored.executeApprovedAction(work.id, pending.id),
    /revoked|not approved|no longer current|unavailable/i,
  );
  assert.deepEqual(await readdir(env.folder), [],
    "boot must not automatically replay a previously approved pending mutation");
});

test("Windows physical host: old Surface instance cannot mutate after remount, new consent works", async t => {
  const env = await physicalWindowsFixture(t);
  const previous = env.personal;
  const old = requestReview(env, "ClosedSurface");
  previous.approvalConsent.approve(old.work.id, old.pending.id);
  assert.equal(previous.canExecuteApprovedAction(old.work.id, old.pending.id), true);
  const mounted = env.restartPersonal();
  assert.notEqual(mounted, previous);
  assert.deepEqual(previous.listAvailableActions(), []);
  assert.equal(previous.canExecuteApprovedAction(old.work.id, old.pending.id), false);
  await assert.rejects(
    () => previous.executeApprovedAction(old.work.id, old.pending.id),
    /disposed/i,
  );
  assert.deepEqual(await readdir(env.folder), [],
    "old approved action may not write after Surface remount");
  const fresh = requestReview(env, "NewSurface");
  assert.equal(mounted.approvalConsent.canApprove(fresh.work.id, fresh.pending.id), true);
  mounted.approvalConsent.approve(fresh.work.id, fresh.pending.id);
  const receipt = await mounted.executeApprovedAction(fresh.work.id, fresh.pending.id);
  assert.equal(receipt.status, "succeeded");
  assert.deepEqual(await readdir(env.folder), ["NewSurface"],
    "the new session can still execute after a NEW explicit approval");
});

test("Windows physical host: silent provider withdrawal before committed HTTP reply cannot report success", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "WithdrawAfterCommit");
  env.personal.approvalConsent.approve(work.id, pending.id);
  const hold = env.holdNextCommittedMutation();
  t.after(() => hold.release());
  const execution = env.personal.executeApprovedAction(work.id, pending.id);
  await hold.committed;
  assert.equal((await stat(join(env.folder, "WithdrawAfterCommit"))).isDirectory(), true,
    "the real Windows middleware committed before the delayed response");
  // Deliberately no Host event: completion must revalidate the live Fabric
  // even if the UI never received a removal notification.
  env.disableProvider();
  hold.release();
  await assert.rejects(execution, /revoked|changed|uncertain|stale|authority/i);
  const state = env.personal.getSnapshot();
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].status, "uncertain",
    "the committed side effect cannot become a succeeded receipt under stale authority");
  assert.equal(state.approvals[0].status, "revoked");
  assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), false);
  assert.deepEqual(await readdir(env.folder), ["WithdrawAfterCommit"]);
  const restored = env.restartPersonal();
  assert.equal(restored.getSnapshot().attempts[0].status, "uncertain");
  await assert.rejects(() => restored.executeApprovedAction(work.id, pending.id));
  assert.deepEqual(await readdir(env.folder), ["WithdrawAfterCommit"],
    "interrupted action must not replay when the Surface starts again");
});

test("Windows physical host: remount during committed HTTP response preserves uncertain attempt without replay", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "RemountAfterCommit");
  env.personal.approvalConsent.approve(work.id, pending.id);
  const previous = env.personal;
  const hold = env.holdNextCommittedMutation();
  t.after(() => hold.release());
  const execution = previous.executeApprovedAction(work.id, pending.id);
  await hold.committed;
  assert.equal((await stat(join(env.folder, "RemountAfterCommit"))).isDirectory(), true);
  const mounted = env.restartPersonal();
  const recovered = mounted.getSnapshot();
  assert.equal(recovered.attempts.length, 1);
  assert.equal(recovered.attempts[0].status, "uncertain");
  assert.equal(recovered.approvals[0].status, "revoked");
  hold.release();
  await assert.rejects(execution, /disposed|receipt|runtime/i);
  assert.equal(mounted.getSnapshot().attempts[0].status, "uncertain");
  assert.equal(mounted.canExecuteApprovedAction(work.id, pending.id), false);
  assert.deepEqual(await readdir(env.folder), ["RemountAfterCommit"]);
  await assert.rejects(() => mounted.executeApprovedAction(work.id, pending.id));
  assert.deepEqual(await readdir(env.folder), ["RemountAfterCommit"]);
});

test("Windows physical host: account A-B-A during committed reply cannot consume the old grant", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "OwnerRoundTripCommit");
  env.personal.approvalConsent.approve(work.id, pending.id);
  const hold = env.holdNextCommittedMutation();
  t.after(() => hold.release());
  const execution = env.personal.executeApprovedAction(work.id, pending.id);
  await hold.committed;
  assert.equal((await stat(join(env.folder, "OwnerRoundTripCommit"))).isDirectory(), true);
  env.switchOwner("another-owner");
  assert.deepEqual(env.personal.getSnapshot().approvals, [],
    "the new owner must never see the previous owner's approval");
  env.switchOwner("test-physical-windows");
  hold.release();
  await assert.rejects(execution, /authority|changed|uncertain|revoked|context/i);
  const saved = env.personal.getSnapshot();
  assert.equal(saved.attempts.length, 1);
  assert.equal(saved.attempts[0].status, "uncertain");
  assert.equal(saved.approvals[0].status, "revoked");
  assert.equal(env.personal.canExecuteApprovedAction(work.id, pending.id), false);
  assert.deepEqual(await readdir(env.folder), ["OwnerRoundTripCommit"]);
  const restored = env.restartPersonal();
  assert.equal(restored.getSnapshot().attempts[0].status, "uncertain");
  await assert.rejects(() => restored.executeApprovedAction(work.id, pending.id));
  assert.deepEqual(await readdir(env.folder), ["OwnerRoundTripCommit"],
    "an account round trip does not replay a committed side effect");
});

test("Windows physical host: provider silently disappears during durable attempt publication before adapter dispatch", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "MustNotDispatch");
  env.personal.approvalConsent.approve(work.id, pending.id);
  let withdrew = 0;
  const unsubscribe = env.personal.subscribe(snapshot => {
    if (withdrew !== 0) return;
    if (snapshot.attempts.some(attempt =>
      attempt.approvalId === pending.id && attempt.status === "started"
    )) {
      withdrew++;
      // Deliberately do not signal Host or Store. This happens inside the
      // synchronous journal event emitted by startActionExecution().
      env.disableProvider();
    }
  });
  t.after(unsubscribe);
  await assert.rejects(
    () => env.personal.executeApprovedAction(work.id, pending.id),
    /revoked|changed|authority|current/i,
  );
  assert.equal(withdrew, 1, "test must reach the gap before typed adapter entry");
  assert.deepEqual(await readdir(env.folder), [],
    "revocation before adapter entry must not write on the real Windows disk");
  const state = env.personal.getSnapshot();
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].status, "failed",
    "no physical adapter was entered; an unexecuted attempt must not be uncertain");
  assert.equal(state.approvals[0].status, "revoked");
  const restored = env.restartPersonal();
  assert.equal(restored.getSnapshot().attempts[0].status, "failed");
  assert.deepEqual(await readdir(env.folder), []);
});

test("Windows physical host: provider withdrawal inside adapter resolution cannot enter the adapter", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "AdapterResolutionGap");
  env.personal.approvalConsent.approve(work.id, pending.id);
  let intercepted = 0;
  env.interceptNextAdapterResolution(() => {
    intercepted++;
    // This happens after the Product grant gateway decision and while the
    // canonical typed adapter is being resolved, without a Host event.
    env.disableProvider();
  });
  await assert.rejects(
    () => env.personal.executeApprovedAction(work.id, pending.id),
    /preflight|authority|changed|current|revoked|adapter/i,
  );
  assert.equal(intercepted, 1);
  assert.deepEqual(await readdir(env.folder), [],
    "a stale provider must never enter the real Windows File Space adapter");
  const state = env.personal.getSnapshot();
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].status, "failed");
  assert.equal(state.approvals[0].status, "revoked");
  const restored = env.restartPersonal();
  assert.equal(restored.getSnapshot().attempts[0].status, "failed");
  assert.deepEqual(await readdir(env.folder), []);
});

test("Windows physical host: a grant revoked during adapter resolution cannot mutate disk", async t => {
  const env = await physicalWindowsFixture(t);
  const { work, pending } = requestReview(env, "GrantRevokedAtAdapter");
  env.personal.approvalConsent.approve(work.id, pending.id);
  let intercepted = 0;
  env.interceptNextAdapterResolution(() => {
    intercepted++;
    // Simulates the canonical runtime revoking exactly this approved grant
    // after the original gateway decision but before adapter.execute().
    env.personal.revokeApprovedAction(work.id, pending.id);
  });
  await assert.rejects(
    () => env.personal.executeApprovedAction(work.id, pending.id),
    /authority|grant|revoked|adapter|current|preflight|no longer valid/i,
  );
  assert.equal(intercepted, 1);
  assert.deepEqual(await readdir(env.folder), [],
    "a revoked grant must never enter the physical File Space adapter");
  const state = env.personal.getSnapshot();
  assert.equal(state.approvals[0].status, "revoked");
  assert.equal(state.attempts.length, 1);
  assert.notEqual(state.attempts[0].status, "succeeded");
  const restored = env.restartPersonal();
  assert.notEqual(restored.getSnapshot().attempts[0].status, "succeeded");
  assert.deepEqual(await readdir(env.folder), []);
});

test("Windows physical host: silent grant loss during adapter resolution denies disk effect without Host event", async t => {
  const env = await physicalWindowsFixture(t, { exposeGrantAuthority: true });
  const { work, pending } = requestReview(env, "SilentGrantLost");
  env.personal.approvalConsent.approve(work.id, pending.id);
  const grantRef = env.personal.getSnapshot().approvals[0].grantRef;
  assert.equal(typeof grantRef, "string");
  let withdrawn = 0;
  env.interceptNextAdapterResolution(() => {
    withdrawn++;
    assert.equal(env.revokeGrantSilently(grantRef), true);
    // No Personal or Native Host event: only the canonical grant registry
    // knows the exact grant has ceased to exist at this instant.
  });
  await assert.rejects(
    () => env.personal.executeApprovedAction(work.id, pending.id),
    /authority|grant|revoked|adapter|current|preflight|uncertain/i,
  );
  assert.equal(withdrawn, 1);
  assert.deepEqual(await readdir(env.folder), [],
    "silent revocation must prevent entry into the real Windows adapter");
  const snapshot = env.personal.getSnapshot();
  assert.equal(snapshot.approvals[0].status, "revoked");
  assert.equal(snapshot.attempts.length, 1);
  assert.equal(snapshot.attempts[0].status, "failed",
    "a pre-effect silent grant loss is not an uncertain physical outcome");
});
