import assert from "node:assert/strict";
import test from "node:test";

import { defineComponentManifest } from "../system/contracts/component-manifest.mjs";
import { createComponentManager } from "../system/services/components/manager.mjs";

function baseManifest() {
  return defineComponentManifest({
    id: "ordax-base",
    title: "Base",
    kind: "base",
    version: "0.1.0",
    releaseMode: "base-ab",
    criticality: "boot-critical",
    failureDomain: "boot",
    restartScope: "reboot",
    healthMode: "boot",
    owner: "test/base",
    dependencies: [],
  });
}

function slotService() {
  return defineComponentManifest({
    id: "slot-service",
    title: "Slot Service",
    kind: "service",
    version: "1.0.0",
    releaseMode: "component-slot",
    criticality: "system",
    failureDomain: "service",
    restartScope: "component",
    healthMode: "process",
    owner: "test/slot-service",
    dependencies: ["ordax-base"],
  });
}

test("normal candidate staging is forward-only and rollback remains explicit", () => {
  let tick = 1;
  const manager = createComponentManager({
    manifests: [baseManifest(), slotService()],
    now: () => tick++,
  });

  assert.throws(
    () => manager.stageCandidate("slot-service", "0.9.9"),
    /must be newer than current; use explicit rollback for downgrade/,
  );
  assert.throws(
    () => manager.stageCandidate("slot-service", "1.0.0"),
    /must be newer than current; use explicit rollback for downgrade/,
  );

  manager.stageCandidate("slot-service", "1.1.0");
  manager.markPendingHealthy("slot-service");
  manager.promotePending("slot-service");
  let entry = manager.getSnapshot().components.find((item) => item.manifest.id === "slot-service").state;
  assert.equal(entry.currentVersion, "1.1.0");
  assert.equal(entry.previousVersion, "1.0.0");

  manager.rollback("slot-service");
  entry = manager.getSnapshot().components.find((item) => item.manifest.id === "slot-service").state;
  assert.equal(entry.currentVersion, "1.0.0");
  assert.equal(entry.rejectedVersion, "1.1.0");
});

test("pending candidate cannot be silently replaced", () => {
  const manager = createComponentManager({
    manifests: [baseManifest(), slotService()],
    now: () => 10,
  });

  manager.stageCandidate("slot-service", "1.1.0");
  assert.throws(
    () => manager.stageCandidate("slot-service", "1.2.0"),
    /already has a pending candidate; promote or reject it first/,
  );

  let entry = manager.getSnapshot().components.find((item) => item.manifest.id === "slot-service").state;
  assert.equal(entry.pendingVersion, "1.1.0");

  manager.rejectPending("slot-service");
  manager.stageCandidate("slot-service", "1.2.0");
  entry = manager.getSnapshot().components.find((item) => item.manifest.id === "slot-service").state;
  assert.equal(entry.pendingVersion, "1.2.0");
});
