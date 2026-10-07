import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
  VERIFIED_APP_STORE_CATALOG_SCHEMA,
} from "../system/contracts/verified-app-store-catalog.mjs";
import {
  VERIFIED_APP_STORE_CATALOG_WATERMARK_SCHEMA,
  VERIFIED_APP_STORE_CATALOG_WATERMARK_STORE_SCHEMA,
  createVerifiedAppStoreCatalogReplayGuard,
} from "../system/services/apps/verified-store-catalog-replay-guard.mjs";

function entry() {
  return {
    appId: "notes",
    title: "Notas",
    version: "0.4.3",
    releaseMode: "component-slot",
    sourceCommit: "b".repeat(40),
    artifacts: {
      package: { name: "notes.zip", sha256: "c".repeat(64), size: 123 },
      release: { name: "notes.release.json", sha256: "d".repeat(64), size: 124 },
      compatibility: { name: "notes.compatibility.json", sha256: "e".repeat(64), size: 125 },
    },
  };
}

function snapshot(sequence = 7, digest = "f".repeat(64)) {
  return {
    schema: VERIFIED_APP_STORE_CATALOG_SCHEMA,
    state: "ready",
    sequence,
    catalogSha256: digest,
    source: {
      repository: "washingtonmsdj/ordax-apps",
      commit: "b".repeat(40),
    },
    trust: {
      domain: "runtime-components",
      keyId: "ordax-runtime-components-v1",
    },
    entries: [entry()],
    reason: null,
    authority: "none",
  };
}

function source(initial) {
  let current = initial;
  const listeners = new Set();
  return {
    port: Object.freeze({
      schema: VERIFIED_APP_STORE_CATALOG_PORT_SCHEMA,
      authority: "none",
      getSnapshot() { return current; },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    publish(next) {
      current = next;
      for (const listener of [...listeners]) listener(current);
    },
  };
}

function watermarkStore(initial = null, {
  failSave = false,
  failLoad = false,
  races = 0,
} = {}) {
  let watermark = initial;
  let revision = initial === null ? 0 : 1;
  let raceCount = 0;
  return {
    store: Object.freeze({
      schema: VERIFIED_APP_STORE_CATALOG_WATERMARK_STORE_SCHEMA,
      async load() {
        if (failLoad) throw new Error("disk unavailable");
        return { revision, watermark };
      },
      async compareAndSwap(expectedRevision, next) {
        if (failSave) throw new Error("disk unavailable");
        if (raceCount < races) {
          raceCount += 1;
          return false;
        }
        if (revision !== expectedRevision) return false;
        revision += 1;
        watermark = next;
        return true;
      },
    }),
    read() { return { revision, watermark }; },
  };
}

function watermark(sequence, digest) {
  return {
    schema: VERIFIED_APP_STORE_CATALOG_WATERMARK_SCHEMA,
    sequence,
    catalogSha256: digest,
  };
}

test("replay guard starts unavailable and persists first accepted catalog before exposing it", async () => {
  const upstream = source(snapshot(7, "f".repeat(64)));
  const persistence = watermarkStore();
  const guard = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: upstream.port,
    watermarkStore: persistence.store,
  });
  assert.equal(guard.port.getSnapshot().state, "unavailable");

  await guard.refresh();
  assert.equal(guard.port.getSnapshot().state, "ready");
  assert.deepEqual(persistence.read(), {
    revision: 1,
    watermark: watermark(7, "f".repeat(64)),
  });
  guard.destroy();
});

test("same sequence and digest is an idempotent retry without another durable revision", async () => {
  const digest = "f".repeat(64);
  const upstream = source(snapshot(7, digest));
  const persistence = watermarkStore(watermark(7, digest));
  const guard = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: upstream.port,
    watermarkStore: persistence.store,
  });
  await guard.refresh();
  assert.equal(guard.port.getSnapshot().sequence, 7);
  assert.equal(guard.port.getSnapshot().catalogSha256, digest);
  assert.equal(persistence.read().revision, 1);
  guard.destroy();
});

test("lower sequence is rejected as rollback and equal sequence with another digest as equivocation", async () => {
  const persistence = watermarkStore(watermark(8, "8".repeat(64)));

  const rollback = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: source(snapshot(7, "7".repeat(64))).port,
    watermarkStore: persistence.store,
  });
  await rollback.refresh();
  assert.equal(rollback.port.getSnapshot().state, "unavailable");
  assert.equal(rollback.port.getSnapshot().reason, "catalog-sequence-rollback");
  rollback.destroy();

  const equivocation = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: source(snapshot(8, "9".repeat(64))).port,
    watermarkStore: persistence.store,
  });
  await equivocation.refresh();
  assert.equal(equivocation.port.getSnapshot().state, "unavailable");
  assert.equal(equivocation.port.getSnapshot().reason, "catalog-sequence-equivocation");
  equivocation.destroy();
});

test("higher sequence advances watermark and live subscription keeps replay protection", async () => {
  const upstream = source(snapshot(7, "7".repeat(64)));
  const persistence = watermarkStore(watermark(7, "7".repeat(64)));
  const guard = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: upstream.port,
    watermarkStore: persistence.store,
  });
  await guard.refresh();
  const seen = [];
  const unsubscribe = guard.port.subscribe((value) => seen.push(value));

  upstream.publish(snapshot(8, "8".repeat(64)));
  await guard.refresh();
  assert.equal(guard.port.getSnapshot().sequence, 8);
  assert.deepEqual(persistence.read(), {
    revision: 2,
    watermark: watermark(8, "8".repeat(64)),
  });

  upstream.publish(snapshot(7, "7".repeat(64)));
  await guard.refresh();
  assert.equal(guard.port.getSnapshot().state, "unavailable");
  assert.equal(guard.port.getSnapshot().reason, "catalog-sequence-rollback");
  assert.equal(seen.some((value) => value.sequence === 8), true);
  assert.equal(seen.at(-1).reason, "catalog-sequence-rollback");

  unsubscribe();
  guard.destroy();
});

test("async revision CAS retries bounded races without exposing an unpersisted catalog", async () => {
  const persistence = watermarkStore(watermark(7, "7".repeat(64)), { races: 2 });
  const guard = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: source(snapshot(8, "8".repeat(64))).port,
    watermarkStore: persistence.store,
  });
  await guard.refresh();
  assert.equal(guard.port.getSnapshot().state, "ready");
  assert.deepEqual(persistence.read(), {
    revision: 2,
    watermark: watermark(8, "8".repeat(64)),
  });
  guard.destroy();
});

test("new catalog fails closed if persistent anti-replay watermark cannot load or commit", async () => {
  for (const [options, reason] of [
    [{ failLoad: true }, "catalog-watermark-unavailable"],
    [{ failSave: true }, "catalog-watermark-persistence-failed"],
    [{ races: 3 }, "catalog-watermark-race"],
  ]) {
    const persistence = watermarkStore(watermark(7, "7".repeat(64)), options);
    const guard = createVerifiedAppStoreCatalogReplayGuard({
      sourcePort: source(snapshot(8, "8".repeat(64))).port,
      watermarkStore: persistence.store,
    });
    await guard.refresh();
    assert.equal(guard.port.getSnapshot().state, "unavailable");
    assert.equal(guard.port.getSnapshot().reason, reason);
    guard.destroy();
  }
});

test("invalid persisted watermark record fails closed rather than resetting replay history", async () => {
  const guard = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: source(snapshot(10, "a".repeat(64))).port,
    watermarkStore: Object.freeze({
      schema: VERIFIED_APP_STORE_CATALOG_WATERMARK_STORE_SCHEMA,
      async load() {
        return {
          revision: 9,
          watermark: {
            schema: VERIFIED_APP_STORE_CATALOG_WATERMARK_SCHEMA,
            sequence: 9,
            catalogSha256: "INVALID",
          },
        };
      },
      async compareAndSwap() {
        throw new Error("must not write invalid state");
      },
    }),
  });
  await guard.refresh();
  assert.equal(guard.port.getSnapshot().state, "unavailable");
  assert.equal(guard.port.getSnapshot().reason, "catalog-watermark-unavailable");
  guard.destroy();
});
