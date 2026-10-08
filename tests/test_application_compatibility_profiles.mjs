import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { peFixture } from "./fixtures/windows-pe.mjs";

import {
  APPLICATION_COMPATIBILITY_PROFILE_PLANNER_SCHEMA,
  assertApplicationCompatibilityProfilePlanner,
  defineApplicationCompatibilityProfile,
  validateApplicationCompatibilityProfilePlan,
} from "../system/contracts/application-compatibility-profile.mjs";
import { createApplicationCompatibilityManager } from "../system/services/compatibility/manager.mjs";
import { createApplicationCompatibilityProfilePlanner } from "../system/services/compatibility/profile-planner.mjs";


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

function digestOf(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const payloadDigest = digestOf(peFixture());

test("profile planning fails closed when no verified runtime exists", async () => {
  const compatibility = createApplicationCompatibilityManager();
  const planner = createApplicationCompatibilityProfilePlanner({ compatibility });
  const inspection = await compatibility.inspectVerified({ name: "editor.exe", bytes: peFixture() });

  const plan = planner.planCreate({
    inspection,
    profileId: "editor",
    payloadDigest,
  });

  assert.equal(plan.ready, false);
  assert.equal(plan.reason, "runtime-unavailable");
  assert.equal(plan.profile, null);
});

test("ready profile plan binds payload identity, runtime and isolated relative storage key", async () => {
  const compatibility = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const planner = createApplicationCompatibilityProfilePlanner({ compatibility });
  const inspection = await compatibility.inspectVerified({ name: "editor.exe", bytes: peFixture() });

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

test("planner independently rejects non-launchable payloads through compatibility manager", async () => {
  const compatibility = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const planner = createApplicationCompatibilityProfilePlanner({ compatibility });
  const dllBytes = peFixture({ dll: true });
  const inspection = await compatibility.inspectVerified({ name: "plugin.dll", bytes: dllBytes });

  const plan = planner.planCreate({
    inspection,
    profileId: "plugin",
    payloadDigest: digestOf(dllBytes),
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.reason, "payload-not-launchable");
});

test("profile identity and payload digest are strict and cannot escape user storage namespace", async () => {
  const compatibility = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const planner = createApplicationCompatibilityProfilePlanner({ compatibility });
  const inspection = await compatibility.inspectVerified({ name: "editor.exe", bytes: peFixture() });

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

test("ready profile-plan contract rejects forged, cloned, and unissued profile objects", () => {
  const profile = defineApplicationCompatibilityProfile({
    id: "editor",
    family: "windows",
    runtimeId: "windows-wine-dev",
    architecture: "x86_64",
    payload: { name: "editor.exe", digest: payloadDigest },
    storageKey: "application-compatibility/windows/editor",
    persistence: "durable-user",
    hostAuthority: "none",
  });
  assert.equal(Object.isFrozen(profile), true);
  const legitimate = validateApplicationCompatibilityProfilePlan({
    ready: true,
    reason: "profile-plan-ready",
    profile,
  });
  assert.equal(legitimate.ready, true);
  assert.equal(legitimate.profile, profile);

  for (const forged of [
    { schema: profile.schema, hostAuthority: "system" },
    { ...profile },
    Object.freeze({ ...profile }),
    { ...profile, payload: { ...profile.payload, digest: `sha256:${"ff".repeat(32)}` },
    { ...profile, storageKey: "../../etc", execute: "wine" },
  ]) {
    assert.throws(
      () => validateApplicationCompatibilityProfilePlan({
        ready: true,
        reason: "profile-plan-ready",
        profile: forged,
      }),
      /canonically issued profile/,
    );
  }

  assert.throws(
    () => validateApplicationCompatibilityProfilePlan({
      ready: false,
      reason: "runtime-unavailable",
      profile,
    }),
    /must not contain a profile/,
  );
  assert.deepEqual(
    validateApplicationCompatibilityProfilePlan({
      ready: false,
      reason: "runtime-unavailable",
      profile: null,
    }),
    {
      schema: "ordax.application-compatibility-profile-plan/1",
      ready: false,
      reason: "runtime-unavailable",
      profile: null,
    },
  );
});
