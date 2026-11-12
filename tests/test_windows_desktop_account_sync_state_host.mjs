import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesktopAccountSyncStateMiddleware } from "../system/adapters/desktop/account-sync-state-host.mjs";
import { createNativeSyncCheckpointStore } from "../system/adapters/native/sync-checkpoint.mjs";
import { createNativeSyncStateStore } from "../system/adapters/native/sync-state.mjs";

const TOKEN = "a".repeat(64);
const WRONG = "b".repeat(64);
const CHECKPOINT = "/__ordax/native/sync-checkpoint";
const STATE = "/__ordax/native/sync-state";
const newRoot = () => mkdtemp(join(tmpdir(), "ordax-desktop-account-sync-"));

async function start(root, { locked = false } = {}) {
  const native = createDesktopAccountSyncStateMiddleware(root, {
    token: TOKEN,
    sessionLocked: async () => locked,
  });
  const server = createServer((req, res) => native.middleware(req, res, () => {
    res.writeHead(404);
    res.end();
  }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const request = (path, init = {}) => fetch(origin + path, init);
  // Only the OS shell may attach this header. It is not provided to Surface.
  const trusted = (path, init = {}) => request(path, {
    ...init,
    headers: {
      ...(init.method === "POST" ? { Origin: origin } : {}),
      ...init.headers,
      "x-ordax-desktop-state-token": TOKEN,
    },
  });
  const windowRef = { fetch: trusted };
  return {
    origin, request, trusted, windowRef,
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

test("Windows Native checkpoint recovers the same durable subject, revisions and cursor", async () => {
  const root = await newRoot();
  let host;
  try {
    host = await start(root);
    assert.equal((await host.request(CHECKPOINT)).status, 401);
    assert.equal((await host.trusted(CHECKPOINT + "?untrusted=1")).status, 400);
    assert.deepEqual(await (await host.trusted(CHECKPOINT)).json(), { checkpoint: null });
    const checkpoint = await createNativeSyncCheckpointStore(host.windowRef);
    assert.equal(checkpoint.scope, "device");
    assert.equal(checkpoint.load(), null);
    const desired = {
      subjectId: "account-1", cursor: 17,
      revisions: { "preferences/surface": 4, "workspace/portable": 7 },
    };
    assert.equal(checkpoint.save(desired), true);
    assert.equal(await checkpoint.flush(), true);
    assert.deepEqual(checkpoint.load(), desired);
    const stored = await readFile(join(root, "desktop-account-sync-checkpoint.json"), "utf8");
    assert.doesNotMatch(stored, /token|password|secret|authorization/i);
    assert.deepEqual(JSON.parse(stored).checkpoint, desired);
    await host.close();
    host = await start(root);
    const recovered = await createNativeSyncCheckpointStore(host.windowRef);
    assert.equal(recovered.scope, "device");
    assert.deepEqual(recovered.load(), desired);
    assert.equal(recovered.save(null), true);
    assert.equal(await recovered.flush(), true);
    assert.deepEqual(await (await host.trusted(CHECKPOINT)).json(), { checkpoint: null });
  } finally {
    if (host) await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Windows sync-state uses one canonical bounded string port across restarts", async () => {
  const root = await newRoot();
  let host;
  try {
    host = await start(root);
    assert.deepEqual(await (await host.trusted(STATE)).json(), { payload: null });
    const sync = await createNativeSyncStateStore(host.windowRef);
    assert.equal(sync.scope, "device");
    const data = JSON.stringify({ schema: "ordax.sync-state/1", namespace: "appearance" });
    assert.equal(sync.save(data), true);
    assert.equal(await sync.flush(), true);
    await host.close();
    host = await start(root);
    const restored = await createNativeSyncStateStore(host.windowRef);
    assert.equal(restored.load(), data);
    assert.equal((await host.trusted(STATE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "x".repeat(65537) }),
    })).status, 400);
    assert.equal((await (await host.trusted(STATE)).json()).payload, data);
  } finally {
    if (host) await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Native sync writes reject forged grants, invalid bodies, foreign origins and lock", async () => {
  const root = await newRoot();
  let host;
  try {
    host = await start(root);
    const valid = { checkpoint: { subjectId: "account-1", cursor: 1, revisions: {} } };
    assert.equal((await host.request(CHECKPOINT, {
      method: "POST", body: JSON.stringify(valid),
      headers: { "Content-Type": "application/json", Origin: host.origin },
    })).status, 401);
    assert.equal((await host.request(CHECKPOINT, {
      method: "POST", body: JSON.stringify(valid),
      headers: { "Content-Type": "application/json", Origin: host.origin,
        "x-ordax-desktop-state-token": WRONG },
    })).status, 401);
    assert.equal((await host.trusted(CHECKPOINT, {
      method: "POST", body: JSON.stringify(valid),
      headers: { "Content-Type": "application/json", Origin: "https://evil.invalid" },
    })).status, 403);
    assert.equal((await host.trusted(CHECKPOINT, {
      method: "POST", body: JSON.stringify({ wrong: valid.checkpoint }),
      headers: { "Content-Type": "application/json" },
    })).status, 400);
    assert.equal((await host.trusted(CHECKPOINT, {
      method: "POST", body: JSON.stringify({ checkpoint: { ...valid.checkpoint, cursor: -1 } }),
      headers: { "Content-Type": "application/json" },
    })).status, 400);
    assert.equal((await host.trusted(CHECKPOINT, {
      method: "POST", body: JSON.stringify(valid), headers: { "Content-Type": "text/plain" },
    })).status, 415);
    assert.equal((await host.trusted(CHECKPOINT, { method: "DELETE" })).status, 405);
    assert.deepEqual(await (await host.trusted(CHECKPOINT)).json(), { checkpoint: null });
    await host.close();
    host = await start(root, { locked: true });
    assert.equal((await host.trusted(CHECKPOINT)).status, 423);
    assert.equal((await host.trusted(STATE, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: "blocked" }),
    })).status, 423);
  } finally {
    if (host) await host.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Malformed existing sync state fails closed instead of resetting the last durable record", async () => {
  const root = await newRoot();
  let host;
  try {
    await writeFile(join(root, "desktop-account-sync-checkpoint.json"), '{"checkpoint":"broken"}');
    host = await start(root);
    assert.equal((await host.trusted(CHECKPOINT)).status, 503);
    assert.equal((await host.trusted(CHECKPOINT, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkpoint: null }),
    })).status, 503);
    assert.match(await readFile(join(root, "desktop-account-sync-checkpoint.json"), "utf8"), /broken/);
    await host.close();
    host = null;
    await rm(join(root, "desktop-account-sync-checkpoint.json"));
    try {
      await symlink(join(root, "outside-file"), join(root, "desktop-account-sync-checkpoint.json"));
      host = await start(root);
      assert.equal((await host.trusted(CHECKPOINT)).status, 503);
      assert.equal((await host.trusted(CHECKPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkpoint: null }),
      })).status, 503);
    } catch (error) {
      if (!["EPERM", "EACCES"].includes(error?.code)) throw error;
    }
  } finally {
    if (host) await host.close();
    await rm(root, { recursive: true, force: true });
  }
});
