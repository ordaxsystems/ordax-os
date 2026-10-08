import assert from "node:assert/strict";
import test from "node:test";

import { createNativeProfileActivationState } from "../system/adapters/native/profile-activation-state.mjs";
import { assertMutableProfileActivationStatePort } from "../system/contracts/profile-activation-state.mjs";

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

test("Native Profile activation adapter is read-only and device-persistent", async () => {
  const requests = [];
  const snapshot = {
    schema: "ordax.profile-activation-state/1",
    revision: 2,
    persistence: "device",
    spaces: [{
      spaceId: "space-1",
      spaceKind: "professional",
      current: {
        profile: { slug: "developer", version: 1 },
        components: [],
        activatedAt: 1000,
      },
      previous: null,
    }],
  };
  const windowRef = {
    async fetch(path, options) {
      requests.push({ path, options });
      return response(snapshot);
    },
  };
  const port = await createNativeProfileActivationState(windowRef);
  assert.equal(assertMutableProfileActivationStatePort(port), port);
  assert.equal(port.getSnapshot().revision, 2);
  assert.equal(port.getSnapshot().persistence, "device");
  assert.equal(requests[0].path, "/__ordax/native/profile-activation-state");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(typeof port.previewActivation, "function");
  assert.equal(typeof port.activate, "function");
  assert.equal(typeof port.deactivate, "function");
  assert.equal(typeof port.rollback, "function");
  assert.equal(typeof port.save, "undefined");

  await port.refresh();
  assert.equal(requests.length, 2);
  port.dispose();
  await assert.rejects(() => port.refresh(), /disposed/);
});

test("Native Profile activation adapter rejects non-device state and transport failure", async () => {
  await assert.rejects(
    () => createNativeProfileActivationState({
      async fetch() {
        return response({
          schema: "ordax.profile-activation-state/1",
          revision: 0,
          persistence: "session",
          spaces: [],
        });
      },
    }),
    /device-persistent/,
  );

  await assert.rejects(
    () => createNativeProfileActivationState({
      async fetch() {
        return response({}, false, 503);
      },
    }),
    /503/,
  );
});


test("Native Profile activation commands require session token and expected revision", async () => {
  const requests = [];
  let state = {
    schema: "ordax.profile-activation-state/1",
    revision: 0,
    persistence: "device",
    spaces: [],
  };
  const windowRef = {
    async fetch(path, options) {
      requests.push({ path, options });
      if (path === "/__ordax/native/profile-activation-state") return response(state);
      if (path === "/__ordax/native/session") {
        return response({
          profileActivationAvailable: true,
          profileActivationToken: "t".repeat(32),
        });
      }
      if (path === "/__ordax/native/profile-activation-command") {
        const body = JSON.parse(options.body);
        assert.equal(body.schema, "ordax.profile-activation-command/1");
        assert.equal(body.expectedRevision, 0);
        assert.equal(options.headers["X-OrdaX-Profile-Activation-Token"], "t".repeat(32));
        state = {
          schema: "ordax.profile-activation-state/1",
          revision: 1,
          persistence: "device",
          spaces: [{
            spaceId: body.spaceId,
            spaceKind: body.spaceKind,
            current: {
              profile: body.profile,
              components: body.components,
              activatedAt: body.activatedAt,
            },
            previous: null,
          }],
        };
        return response({ state });
      }
      throw new Error("unexpected request");
    },
  };
  const port = await createNativeProfileActivationState(windowRef);
  await port.activate({
    spaceId: "space-1",
    spaceKind: "professional",
    profile: { slug: "developer", version: 1 },
    activatedAt: 1234,
  });
  assert.equal(port.getSnapshot().revision, 1);
  assert.equal(requests.at(-1).options.method, "POST");
});


test("Native Profile adapter previews permission diff before accepted activation", async () => {
  const requests = [];
  const state = {
    schema: "ordax.profile-activation-state/1",
    revision: 4,
    persistence: "device",
    spaces: [],
  };
  const digest = "a".repeat(64);
  const windowRef = {
    async fetch(path, options) {
      requests.push({ path, options });
      if (path === "/__ordax/native/profile-activation-state") return response(state);
      if (path === "/__ordax/native/session") {
        return response({
          profileActivationAvailable: true,
          profileActivationToken: "t".repeat(32),
        });
      }
      if (path === "/__ordax/native/profile-activation-command") {
        const body = JSON.parse(options.body);
        if (body.action === "preview-activate") {
          return response({
            state,
            permissionDiff: {
              schema: "ordax.profile-permission-diff/1",
              componentAdds: [{ id: "knowledge.example" }],
              componentRemovals: [],
              authorityChanges: [],
              requiresExplicitReview: true,
            },
            permissionDiffSha256: digest,
          });
        }
        assert.equal(body.acceptedPermissionDiffSha256, digest);
        return response({ state, permissionDiff: null, permissionDiffSha256: digest });
      }
      throw new Error("unexpected request");
    },
  };
  const port = await createNativeProfileActivationState(windowRef);
  const preview = await port.previewActivation({
    spaceId: "space-1",
    spaceKind: "professional",
    profile: { slug: "developer", version: 1 },
    components: [{
      id: "knowledge.example",
      kind: "knowledge-pack",
      version: "1.0.0",
      sha256: "a".repeat(64),
      receiptSha256: "b".repeat(64),
      installedAt: 1,
    }],
  });
  assert.equal(preview.permissionDiffSha256, digest);
  await port.activate({
    spaceId: "space-1",
    spaceKind: "professional",
    profile: { slug: "developer", version: 1 },
    components: [{
      id: "knowledge.example",
      kind: "knowledge-pack",
      version: "1.0.0",
      sha256: "a".repeat(64),
      receiptSha256: "b".repeat(64),
      installedAt: 1,
    }],
    acceptedPermissionDiffSha256: preview.permissionDiffSha256,
  });
  assert.equal(requests.at(-1).options.method, "POST");
});

test("Native Profile adapter refreshes a stale revision on conflict without replaying the action", async () => {
  let state = {
    schema: "ordax.profile-activation-state/1",
    revision: 1,
    persistence: "device",
    spaces: [],
  };
  let reads = 0;
  const attemptedRevisions = [];
  const windowRef = {
    async fetch(path, options) {
      if (path === "/__ordax/native/profile-activation-state") {
        reads += 1;
        return response(state);
      }
      if (path === "/__ordax/native/session") {
        return response({
          profileActivationAvailable: true,
          profileActivationToken: "t".repeat(32),
        });
      }
      if (path === "/__ordax/native/profile-activation-command") {
        const body = JSON.parse(options.body);
        attemptedRevisions.push(body.expectedRevision);
        if (attemptedRevisions.length === 1) {
          state = { ...state, revision: 2 };
          return response({}, false, 409);
        }
        return response({
          state,
          permissionDiff: {
            schema: "ordax.profile-permission-diff/1",
            componentAdds: [],
            componentRemovals: [],
            authorityChanges: [],
            requiresExplicitReview: false,
          },
          permissionDiffSha256: "c".repeat(64),
        });
      }
      throw new Error("unexpected request");
    },
  };

  const port = await createNativeProfileActivationState(windowRef);
  const intent = {
    spaceId: "space-1",
    spaceKind: "professional",
    profile: { slug: "pizzaria-br", version: 1 },
    components: [],
  };
  await assert.rejects(() => port.previewActivation(intent), (error) => error.status === 409);
  assert.equal(port.getSnapshot().revision, 2);
  assert.equal(reads, 2);
  assert.deepEqual(attemptedRevisions, [1]);

  const preview = await port.previewActivation(intent);
  assert.equal(preview.expectedRevision, 2);
  assert.deepEqual(attemptedRevisions, [1, 2]);
});

test("Native Profile observers see successful mutations immediately and never see stale reads", async () => {
  const original = {
    schema: "ordax.profile-activation-state/1",
    revision: 1,
    persistence: "device",
    spaces: [],
  };
  const updated = {
    ...original,
    revision: 2,
    spaces: [{
      spaceId: "space-1",
      spaceKind: "professional",
      current: {
        profile: { slug: "pizzaria-br", version: 1 },
        components: [],
        activatedAt: 100,
      },
      previous: null,
    }],
  };
  let getCount = 0;
  let finishStaleRead;
  const windowRef = {
    async fetch(path) {
      if (path === "/__ordax/native/profile-activation-state") {
        getCount++;
        if (getCount === 1) return response(original);
        return new Promise((resolve) => { finishStaleRead = resolve; });
      }
      if (path === "/__ordax/native/session") return response({
        profileActivationAvailable: true,
        profileActivationToken: "t".repeat(32),
      });
      if (path === "/__ordax/native/profile-activation-command") {
        return response({ state: updated });
      }
      throw new Error("Unexpected Native Profile path");
    },
  };
  const port = await createNativeProfileActivationState(windowRef);
  const observed = [];
  const unsubscribe = port.subscribe((state) => observed.push(state.revision));
  assert.deepEqual(observed, [1]);
  const delayed = port.refresh();
  await port.activate({
    spaceId: "space-1",
    spaceKind: "professional",
    profile: { slug: "pizzaria-br", version: 1 },
    activatedAt: 100,
  });
  assert.equal(port.getSnapshot().revision, 2);
  finishStaleRead(response(original));
  await delayed;
  assert.equal(port.getSnapshot().revision, 2);
  assert.deepEqual(observed, [1, 2]);
  unsubscribe();
  port.dispose();
});

test("Native Profile state rejects equal-revision contradictory snapshots and detaches observers", async () => {
  const original = {
    schema: "ordax.profile-activation-state/1",
    revision: 4,
    persistence: "device",
    spaces: [],
  };
  let next = original;
  const windowRef = { async fetch() { return response(next); } };
  const port = await createNativeProfileActivationState(windowRef);
  let changes = 0;
  const unsubscribe = port.subscribe(() => { changes++; });
  assert.equal(changes, 1);
  next = { ...original, persistence: "device", spaces: [{
    spaceId: "space-1", spaceKind: "work",
    current: {
      profile: { slug: "developer", version: 1 },
      components: [], activatedAt: 101,
    },
    previous: null,
  }] };
  await assert.rejects(() => port.refresh(), /without a revision/);
  assert.deepEqual(port.getSnapshot().spaces, []);
  assert.equal(changes, 1);
  unsubscribe();
  port.dispose();
  assert.equal(changes, 1);
  const detach = port.subscribe(() => { changes++; });
  detach();
  assert.equal(changes, 1); // disposed port does not announce stale snapshots
});


test("Native preview refuses stale consent when another mutation wins while it is in flight", async () => {
  const state1 = {
    schema: "ordax.profile-activation-state/1",
    revision: 1,
    persistence: "device",
    spaces: [],
  };
  const state2 = { ...state1, revision: 2 };
  let current = state1;
  let signalPreview;
  let releasePreview;
  const previewStarted = new Promise((resolve) => { signalPreview = resolve; });
  const delayedPreview = new Promise((resolve) => { releasePreview = resolve; });
  const sentRevisions = [];
  const windowRef = {
    async fetch(path, options) {
      if (path === "/__ordax/native/profile-activation-state") return response(current);
      if (path === "/__ordax/native/session") return response({
        profileActivationAvailable: true,
        profileActivationToken: "t".repeat(32),
      });
      if (path === "/__ordax/native/profile-activation-command") {
        const body = JSON.parse(options.body);
        sentRevisions.push(body.expectedRevision);
        if (body.action === "preview-activate") {
          signalPreview();
          await delayedPreview;
          return response({
            state: state1,
            permissionDiff: {
              schema: "ordax.profile-permission-diff/1",
              componentAdds: [], componentRemovals: [], authorityChanges: [],
              requiresExplicitReview: false,
            },
            permissionDiffSha256: "c".repeat(64),
          });
        }
        assert.equal(body.action, "activate");
        current = state2;
        return response({ state: state2 });
      }
      throw new Error("Unexpected Native path");
    },
  };
  const port = await createNativeProfileActivationState(windowRef);
  const intent = {
    spaceId: "space-1",
    spaceKind: "professional",
    profile: { slug: "pizzaria-br", version: 1 },
    components: [],
  };
  const preview = port.previewActivation(intent);
  await previewStarted;
  await port.activate(intent);
  releasePreview();
  await assert.rejects(preview, (error) => error.status === 409);
  assert.deepEqual(sentRevisions, [1, 1]);
  assert.equal(port.getSnapshot().revision, 2);
  port.dispose();
});

test("Reviewed Profile revision must be used verbatim; stale confirmation never issues POST", async () => {
  const state1 = {
    schema: "ordax.profile-activation-state/1",
    revision: 3,
    persistence: "device",
    spaces: [],
  };
  let current = state1;
  const bodies = [];
  const windowRef = {
    async fetch(path, options) {
      if (path === "/__ordax/native/profile-activation-state") return response(current);
      if (path === "/__ordax/native/session") return response({
        profileActivationAvailable: true,
        profileActivationToken: "t".repeat(32),
      });
      if (path === "/__ordax/native/profile-activation-command") {
        const body = JSON.parse(options.body);
        bodies.push(body);
        if (body.action === "preview-activate") {
          return response({
            state: state1,
            permissionDiff: {
              schema: "ordax.profile-permission-diff/1",
              componentAdds: [], componentRemovals: [], authorityChanges: [],
              requiresExplicitReview: false,
            },
            permissionDiffSha256: "d".repeat(64),
          });
        }
        return response({ state: { ...state1, revision: 5 } });
      }
      throw new Error("Unexpected Native path");
    },
  };
  const port = await createNativeProfileActivationState(windowRef);
  const intent = {
    spaceId: "space-1",
    spaceKind: "professional",
    profile: { slug: "impressao-3d-br", version: 1 },
    components: [],
  };
  const preview = await port.previewActivation(intent);
  assert.equal(preview.expectedRevision, 3);
  current = { ...state1, revision: 4 };
  await port.refresh();
  await assert.rejects(
    () => port.activate({
      ...intent,
      expectedRevision: preview.expectedRevision,
      acceptedPermissionDiffSha256: preview.permissionDiffSha256,
    }),
    (error) => error.status === 409,
  );
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].action, "preview-activate");
  assert.equal(port.getSnapshot().revision, 4);
  port.dispose();
});

test("Reviewed Profile activation sends exactly the previewed revision on success", async () => {
  const initial = {
    schema: "ordax.profile-activation-state/1",
    revision: 8,
    persistence: "device",
    spaces: [],
  };
  const requests = [];
  const windowRef = {
    async fetch(path, options) {
      if (path === "/__ordax/native/profile-activation-state") return response(initial);
      if (path === "/__ordax/native/session") return response({
        profileActivationAvailable: true,
        profileActivationToken: "t".repeat(32),
      });
      if (path === "/__ordax/native/profile-activation-command") {
        const body = JSON.parse(options.body);
        requests.push(body);
        if (body.action === "preview-activate") {
          return response({
            state: initial,
            permissionDiff: {
              schema: "ordax.profile-permission-diff/1",
              componentAdds: [], componentRemovals: [], authorityChanges: [],
              requiresExplicitReview: false,
            },
            permissionDiffSha256: "e".repeat(64),
          });
        }
        return response({ state: { ...initial, revision: 9 } });
      }
      throw new Error("Unexpected Native path");
    },
  };
  const port = await createNativeProfileActivationState(windowRef);
  const intent = {
    spaceId: "space-1", spaceKind: "professional",
    profile: { slug: "pizzaria-br", version: 1 }, components: [],
  };
  const preview = await port.previewActivation(intent);
  await port.activate({
    ...intent,
    expectedRevision: preview.expectedRevision,
    acceptedPermissionDiffSha256: preview.permissionDiffSha256,
  });
  assert.deepEqual(requests.map((body) => body.expectedRevision), [8, 8]);
  assert.equal(requests[1].acceptedPermissionDiffSha256, "e".repeat(64));
  assert.equal(port.getSnapshot().revision, 9);
  port.dispose();
});
