import assert from "node:assert/strict";
import test from "node:test";

import { createNativeProfileActivationState } from "../system/adapters/native/profile-activation-state.mjs";

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
  assert.equal(port.getSnapshot().revision, 2);
  assert.equal(port.getSnapshot().persistence, "device");
  assert.equal(requests[0].path, "/__ordax/native/profile-activation-state");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(typeof port.activate, "undefined");
  assert.equal(typeof port.rollback, "undefined");
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
