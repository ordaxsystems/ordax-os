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

function watermarkStore(initial = null, { failSave = false, race = false } = {}) {
  let current = initial;
  return {
    store: Object.freeze({
      schema: VERIFIED_APP_STORE_CATALOG_WATERMARK_STORE_SCHEMA,
      load() { return current; },
      compareAndSwap(expected, next) {
        if (failSave) throw new Error("disk unavailable");
        if (race) return false;
        assert.deepEqual(current, expected);
        current = next;
        return true;
      },
    }),
    read() { return current; },
  };
}

function watermark(sequence, digest) {
  return {
    schema: VERIFIED_APP_STORE_CATALOG_WATERMARK_SCHEMA,
    sequence,
    catalogSha256: digest,
  };
}

test("replay guard persists first accepted catalog before exposing it", () => {
  const upstream = source(snapshot(7, "f".repeat(64)));
  const persistence = watermarkStore();
  const guard = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: upstream.port,
    watermarkStore: persistence.store,
  });
  assert.equal(guard.getSnapshot().state, "ready");
  assert.deepEqual(persistence.read(), watermark(7, "f".repeat(64)));
  guard.destroy();
});

test("same sequence and digest is an idempotent retry", () => {
  const digest = "f".repeat(64);
  const upstream = source(snapshot(7, digest));
  const persistence = watermarkStore(watermark(7, digest));
  const guard = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: upstream.port,
    watermarkStore: persistence.store,
  });
  assert.equal(guard.getSnapshot().sequence, 7);
  assert.equal(guard.getSnapshot().catalogSha256, digest);
  guard.destroy();
});

test("lower sequence is rejected as rollback and equal sequence with another digest as equivocation", () => {
  const persistence = watermarkStore(watermark(8, "8".repeat(64)));

  const rollback = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: source(snapshot(7, "7".repeat(64))).port,
    watermarkStore: persistence.store,
  });
  assert.equal(rollback.getSnapshot().state, "unavailable");
  assert.equal(rollback.getSnapshot().reason, "catalog-sequence-rollback");
  rollback.destroy();

  const equivocation = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: source(snapshot(8, "9".repeat(64))).port,
    watermarkStore: persistence.store,
  });
  assert.equal(equivocation.getSnapshot().state, "unavailable");
  assert.equal(equivocation.getSnapshot().reason, "catalog-sequence-equivocation");
  equivocation.destroy();
});

test("higher sequence advances watermark and live subscription keeps replay protection", () => {
  const upstream = source(snapshot(7, "7".repeat(64)));
  const persistence = watermarkStore(watermark(7, "7".repeat(64)));
  const guard = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: upstream.port,
    watermarkStore: persistence.store,
  });
  const seen = [];
  const unsubscribe = guard.subscribe((value) => seen.push(value));

  upstream.publish(snapshot(8, "8".repeat(64)));
  assert.equal(guard.getSnapshot().sequence, 8);
  assert.deepEqual(persistence.read(), watermark(8, "8".repeat(64)));

  upstream.publish(snapshot(7, "7".repeat(64)));
  assert.equal(guard.getSnapshot().state, "unavailable");
  assert.equal(guard.getSnapshot().reason, "catalog-sequence-rollback");
  assert.equal(seen.length, 2);

  unsubscribe();
  guard.destroy();
});

test("new catalog fails closed if persistent anti-replay watermark cannot commit", () => {
  for (const options of [{ failSave: true }, { race: true }]) {
    const persistence = watermarkStore(watermark(7, "7".repeat(64)), options);
    const guard = createVerifiedAppStoreCatalogReplayGuard({
      sourcePort: source(snapshot(8, "8".repeat(64))).port,
      watermarkStore: persistence.store,
    });
    assert.equal(guard.getSnapshot().state, "unavailable");
    assert.match(
      guard.getSnapshot().reason,
      /catalog-watermark-(persistence-failed|race)/,
    );
    guard.destroy();
  }
});

test("invalid persisted watermark fails closed rather than resetting replay history", () => {
  const persistence = watermarkStore({
    schema: VERIFIED_APP_STORE_CATALOG_WATERMARK_SCHEMA,
    sequence: 9,
    catalogSha256: "INVALID",
  });
  const guard = createVerifiedAppStoreCatalogReplayGuard({
    sourcePort: source(snapshot(10, "a".repeat(64))).port,
    watermarkStore: persistence.store,
  });
  assert.equal(guard.getSnapshot().state, "unavailable");
  assert.equal(guard.getSnapshot().reason, "catalog-watermark-unavailable");
  guard.destroy();
});
