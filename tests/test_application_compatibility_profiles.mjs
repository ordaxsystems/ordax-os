import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_COMPATIBILITY_PROFILE_PLANNER_SCHEMA,
  assertApplicationCompatibilityProfilePlanner,
  defineApplicationCompatibilityProfile,
} from "../system/contracts/application-compatibility-profile.mjs";
import { createApplicationCompatibilityManager } from "../system/services/compatibility/manager.mjs";
import { createApplicationCompatibilityProfilePlanner } from "../system/services/compatibility/profile-planner.mjs";

function peFixture({ machine = 0x8664, dll = false, optionalMagic = 0x020b } = {}) {
  const bytes = new Uint8Array(256);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  const peOffset = 0x80;
  bytes[0x3c] = peOffset;
  bytes[peOffset] = 0x50;
  bytes[peOffset + 1] = 0x45;
  bytes[peOffset + 4] = machine & 0xff;
  bytes[peOffset + 5] = (machine >> 8) & 0xff;
  bytes[peOffset + 20] = 0x70;
  bytes[peOffset + 22] = dll ? 0x02 : 0x00;
  bytes[peOffset + 23] = dll ? 0x20 : 0x00;
  bytes[peOffset + 24] = optionalMagic & 0xff;
  bytes[peOffset + 25] = (optionalMagic >> 8) & 0xff;
  return bytes;
}

function runtime(overrides = {}) {
  return {
    id: "windows-wine-dev",
    family: "windows",
    engine: "wine",
    version: "1.0.0",
    architectures: ["x86_64"],
    source: {
      identity: "fixture://verified/windows-wine-dev",
      digest: `sha256:${"11".repeat(32)}`,
    },
    available: true,
    executionEnabled: true,
    sandboxed: true,
    ...overrides,
  };
}

const payloadDigest = `sha256:${"22".repeat(32)}`;

test("profile planning fails closed when no verified runtime exists", () => {
  const compatibility = createApplicationCompatibilityManager();
  const planner = createApplicationCompatibilityProfilePlanner({ compatibility });
  const inspection = compatibility.inspect({ name: "editor.exe", bytes: peFixture() });

  const plan = planner.planCreate({
    inspection,
    profileId: "editor",
    payloadDigest,
  });

  assert.equal(plan.ready, false);
  assert.equal(plan.reason, "runtime-unavailable");
  assert.equal(plan.profile, null);
});

test("ready profile plan binds payload identity, runtime and isolated relative storage key", () => {
  const compatibility = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const planner = createApplicationCompatibilityProfilePlanner({ compatibility });
  const inspection = compatibility.inspect({ name: "editor.exe", bytes: peFixture() });

  const plan = planner.planCreate({
    inspection,
    profileId: "editor",
    payloadDigest,
  });

  assert.equal(plan.ready, true);
  assert.equal(plan.reason, "profile-plan-ready");
  assert.deepEqual(plan.profile, {
    schema: "ordax.application-compatibility-profile/1",
    id: "editor",
    family: "windows",
    runtimeId: "windows-wine-dev",
    architecture: "x86_64",
    payload: {
      name: "editor.exe",
      digest: payloadDigest,
    },
    storageKey: "application-compatibility/windows/editor",
    persistence: "durable-user",
    hostAuthority: "none",
  });
  assert.equal(plan.profile.storageKey.startsWith("/"), false);
  assert.equal(plan.profile.storageKey.includes(".."), false);
});

test("planner independently rejects non-launchable payloads through compatibility manager", () => {
  const compatibility = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const planner = createApplicationCompatibilityProfilePlanner({ compatibility });
  const inspection = compatibility.inspect({ name: "plugin.dll", bytes: peFixture({ dll: true }) });

  const plan = planner.planCreate({
    inspection,
    profileId: "plugin",
    payloadDigest,
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.reason, "payload-not-launchable");
});

test("profile identity and payload digest are strict and cannot escape user storage namespace", () => {
  const compatibility = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const planner = createApplicationCompatibilityProfilePlanner({ compatibility });
  const inspection = compatibility.inspect({ name: "editor.exe", bytes: peFixture() });

  for (const profileId of ["../escape", "/absolute", "Editor", "", "a/child"]) {
    assert.throws(
      () => planner.planCreate({ inspection, profileId, payloadDigest }),
      /profile id is invalid/i,
    );
  }
  assert.throws(
    () => planner.planCreate({ inspection, profileId: "editor", payloadDigest: "sha256:not-a-digest" }),
    /payload digest/i,
  );

  assert.throws(
    () => defineApplicationCompatibilityProfile({
      id: "editor",
      family: "windows",
      runtimeId: "windows-wine-dev",
      architecture: "x86_64",
      payload: { name: "editor.exe", digest: payloadDigest },
      storageKey: "../escape",
      persistence: "durable-user",
      hostAuthority: "none",
    }),
    /safe relative POSIX key/,
  );
});

test("profile planner exposes planning only and no mutation or execution authority", () => {
  const compatibility = createApplicationCompatibilityManager();
  const planner = createApplicationCompatibilityProfilePlanner({ compatibility });
  assert.equal(planner.schema, APPLICATION_COMPATIBILITY_PROFILE_PLANNER_SCHEMA);
  assert.equal(assertApplicationCompatibilityProfilePlanner(planner), planner);
  for (const method of ["create", "delete", "execute", "install", "spawn", "writeFile"]) {
    assert.equal(method in planner, false);
  }
});
