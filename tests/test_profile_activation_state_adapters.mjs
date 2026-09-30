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
    schema: "ordax.profile-activation-state/2",
    revision: 2,
    persistence: "device",
    spaces: [{
      subjectId: "user-1",
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
          schema: "ordax.profile-activation-state/2",
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
    schema: "ordax.profile-activation-state/2",
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
          schema: "ordax.profile-activation-state/2",
          revision: 1,
          persistence: "device",
          spaces: [{
            subjectId: body.subjectId,\n            spaceId: body.spaceId,
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
    schema: "ordax.profile-activation-state/2",
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
