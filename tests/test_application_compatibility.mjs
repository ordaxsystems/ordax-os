import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { peFixture } from "./fixtures/windows-pe.mjs";

import {
  APPLICATION_COMPATIBILITY_SCHEMA,
  defineApplicationCompatibilityRuntime,
} from "../system/contracts/application-compatibility.mjs";
import { createApplicationCompatibilityManager } from "../system/services/compatibility/manager.mjs";
import { createApplicationCompatibilityProfilePlanner } from "../system/services/compatibility/profile-planner.mjs";


function msiCandidateFixture() {
  const bytes = new Uint8Array(64);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  return bytes;
}

function runtime(overrides = {}) {
  return {
    id: "windows-wine-test",
    family: "windows",
    engine: "wine",
    version: "1.0.0",
    architectures: ["x86_64"],
    source: {
      identity: "fixture://verified/windows-wine-test",
      digest: `sha256:${"01".repeat(32)}`,
    },
    available: true,
    executionEnabled: true,
    sandboxed: true,
    ...overrides,
  };
}

test("Windows PE detection trusts bytes rather than executable-looking extension", () => {
  const manager = createApplicationCompatibilityManager();
  const architectures = [
    [0x014c, 0x010b, "x86"],
    [0x8664, 0x020b, "x86_64"],
    [0xaa64, 0x020b, "aarch64"],
  ];

  for (const [machine, optionalMagic, expected] of architectures) {
    const inspection = manager.inspect({
      name: "payload.bin",
      bytes: peFixture({ machine, optionalMagic }),
    });
    assert.equal(inspection.family, "windows");
    assert.equal(inspection.kind, "windows-pe");
    assert.equal(inspection.architecture, expected);
    assert.equal(inspection.role, "executable");
    assert.equal(inspection.launchable, true);
  }

  const fakeExe = manager.inspect({ name: "fake.exe", bytes: new Uint8Array([1, 2, 3, 4]) });
  assert.equal(fakeExe.kind, "unknown");
  assert.equal(fakeExe.launchable, false);
});

test("DLLs and malformed PE optional headers are never launchable", () => {
  const manager = createApplicationCompatibilityManager();
  const dll = manager.inspect({ name: "library.dll", bytes: peFixture({ dll: true }) });
  assert.equal(dll.kind, "windows-pe");
  assert.equal(dll.role, "library");
  assert.equal(dll.launchable, false);

  const malformed = manager.inspect({
    name: "broken.exe",
    bytes: peFixture({ optionalMagic: 0x9999 }),
  });
  assert.equal(malformed.kind, "windows-pe");
  assert.equal(malformed.launchable, false);
  assert.ok(malformed.evidence.includes("invalid-optional-header"));
});

test("Windows PE rejects truncated, undersized and architecture-mismatched optional headers before planning", () => {
  const manager = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const invalidFiles = [
    ["truncated-header-bytes", peFixture({ fileSize: 256 })],
    ["declared-header-too-short", peFixture({ optionalHeaderSize: 2 })],
    ["x64-with-pe32", peFixture({ machine: 0x8664, optionalMagic: 0x010b })],
    ["x86-with-pe32-plus", peFixture({ machine: 0x014c, optionalMagic: 0x020b })],
    ["arm64-with-pe32", peFixture({ machine: 0xaa64, optionalMagic: 0x010b })],
  ];

  for (const [name, bytes] of invalidFiles) {
    const inspection = manager.inspect({ name: `${name}.exe`, bytes });
    assert.equal(inspection.kind, "windows-pe", name);
    assert.equal(inspection.launchable, false, name);
    assert.ok(inspection.evidence.includes("invalid-optional-header"), name);
    assert.deepEqual(manager.planLaunch({ inspection }), {
      schema: "ordax.application-compatibility-plan/1",
      ready: false,
      runtimeId: null,
      reason: "payload-not-launchable",
    }, name);
  }

  const overlapping = manager.inspect({
    name: "overlapping-dos-header.exe",
    bytes: peFixture({ peOffset: 0x20 }),
  });
  assert.equal(overlapping.kind, "unknown");
  assert.equal(overlapping.launchable, false);
  assert.equal(manager.planLaunch({ inspection: overlapping }).ready, false);
});

test("MSI is only recognized as an installer candidate until a real database verifier exists", () => {
  const manager = createApplicationCompatibilityManager();
  const inspection = manager.inspect({ name: "setup.msi", bytes: msiCandidateFixture() });
  assert.equal(inspection.family, "windows");
  assert.equal(inspection.kind, "windows-msi");
  assert.equal(inspection.role, "installer");
  assert.equal(inspection.launchable, false);
  assert.ok(inspection.evidence.includes("msi-database-verification-pending"));

  const sameBytesWrongName = manager.inspect({ name: "archive.bin", bytes: msiCandidateFixture() });
  assert.equal(sameBytesWrongName.kind, "unknown");
});

test("unknown PE machine fails closed rather than guessing architecture", () => {
  const manager = createApplicationCompatibilityManager();
  const inspection = manager.inspect({ name: "future.exe", bytes: peFixture({ machine: 0x1337 }) });
  assert.equal(inspection.family, "windows");
  assert.equal(inspection.architecture, "unknown");
  assert.equal(inspection.launchable, false);
});

test("manager has no fake Wine provider and exposes no execution or installation authority", () => {
  const manager = createApplicationCompatibilityManager();
  assert.equal(manager.schema, APPLICATION_COMPATIBILITY_SCHEMA);
  assert.deepEqual(manager.listRuntimes(), []);
  assert.equal("execute" in manager, false);
  assert.equal("install" in manager, false);
  assert.equal("spawn" in manager, false);

  const inspection = manager.inspect({ name: "hello.exe", bytes: peFixture() });
  assert.deepEqual(manager.planLaunch({ inspection }), {
    schema: "ordax.application-compatibility-plan/1",
    ready: false,
    runtimeId: null,
    reason: "runtime-unavailable",
  });
});

test("only an explicit verified runtime descriptor can satisfy launch planning", () => {
  const manager = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const inspection = manager.inspect({ name: "hello.exe", bytes: peFixture() });
  assert.deepEqual(manager.planLaunch({ inspection }), {
    schema: "ordax.application-compatibility-plan/1",
    ready: true,
    runtimeId: "windows-wine-test",
    reason: "runtime-available",
  });

  assert.equal(manager.listRuntimes({ family: "windows" }).length, 1);
  assert.equal(manager.listRuntimes({ family: "linux" }).length, 0);

  const requestedMissing = manager.planLaunch({ inspection, runtimeId: "windows-other" });
  assert.equal(requestedMissing.ready, false);
  assert.equal(requestedMissing.reason, "requested-runtime-unavailable");
});

test("multiple compatible runtimes require explicit selection regardless of inventory order", async () => {
  const wine = runtime();
  const proton = runtime({
    id: "windows-proton-test",
    engine: "proton",
    version: "2.0.0",
    source: {
      identity: "fixture://verified/windows-proton-test",
      digest: `sha256:${"02".repeat(32)}`,
    },
  });

  for (const runtimes of [[wine, proton], [proton, wine]]) {
    const manager = createApplicationCompatibilityManager({ runtimes });
    const bytes = peFixture();
    const inspection = await manager.inspectVerified({ name: "editor.exe", bytes });
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    assert.deepEqual(manager.planLaunch({ inspection }), {
      schema: "ordax.application-compatibility-plan/1",
      ready: false,
      runtimeId: null,
      reason: "runtime-selection-required",
    });
    const planner = createApplicationCompatibilityProfilePlanner({ compatibility: manager });
    assert.deepEqual(planner.planCreate({
      inspection,
      profileId: "editor",
      payloadDigest: digest,
    }), {
      schema: "ordax.application-compatibility-profile-plan/1",
      ready: false,
      reason: "runtime-selection-required",
      profile: null,
    });
    for (const requested of ["windows-wine-test", "windows-proton-test"]) {
      const selected = manager.planLaunch({ inspection, runtimeId: requested });
      assert.equal(selected.ready, true);
      assert.equal(selected.runtimeId, requested);
      const profilePlan = planner.planCreate({
        inspection,
        runtimeId: requested,
        profileId: "editor",
        payloadDigest: digest,
      });
      assert.equal(profilePlan.ready, true);
      assert.equal(profilePlan.profile.runtimeId, requested);
    }
  }
});

test("runtime descriptors reject placeholders, unsandboxed providers and hidden command authority", () => {
  for (const overrides of [
    { available: false },
    { executionEnabled: false },
    { sandboxed: false },
    { source: { identity: "fixture://runtime", digest: "sha256:not-a-digest" } },
  ]) {
    assert.throws(() => defineApplicationCompatibilityRuntime(runtime(overrides)));
  }

  assert.throws(
    () => defineApplicationCompatibilityRuntime({ ...runtime(), command: "wine" }),
    /fields are incompatible/,
  );
});

test("launch and profile plans reject forged, copied, and cross-manager inspections", () => {
  const manager = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const anotherManager = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const legitimate = manager.inspect({ name: "safe.exe", bytes: peFixture() });
  assert.equal(Object.isFrozen(legitimate), true);
  assert.equal(manager.planLaunch({ inspection: legitimate }).ready, true);

  const unknown = manager.inspect({ name: "fake.exe", bytes: new Uint8Array([0, 1, 2]) });
  const forged = Object.freeze({
    ...unknown,
    family: "windows",
    kind: "windows-pe",
    role: "executable",
    architecture: "x86_64",
    launchable: true,
  });
  const invalid = [
    forged,
    { ...legitimate },
    anotherManager.inspect({ name: "other.exe", bytes: peFixture() }),
    { schema: legitimate.schema, family: "windows", architecture: "x86_64", launchable: true },
  ];

  const planner = createApplicationCompatibilityProfilePlanner({ compatibility: manager });
  for (const inspection of invalid) {
    assert.throws(
      () => manager.planLaunch({ inspection }),
      /inspection issued by this compatibility manager/,
    );
    assert.throws(
      () => planner.planCreate({
        inspection,
        profileId: "safe",
        payloadDigest: `sha256:${"11".repeat(32)}`,
      }),
      /payload digest is not verified/,
    );
  }
  assert.equal(manager.planLaunch({ inspection: unknown }).ready, false);
});

test("profile planning requires exact SHA-256 of the manager-inspected bytes", async () => {
  const manager = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const planner = createApplicationCompatibilityProfilePlanner({ compatibility: manager });
  const bytes = peFixture();
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const unchecked = manager.inspect({ name: "unverified.exe", bytes });
  assert.throws(
    () => planner.planCreate({ inspection: unchecked, profileId: "editor", payloadDigest: digest }),
    /payload digest is not verified/,
  );

  const verified = await manager.inspectVerified({ name: "verified.exe", bytes });
  bytes[0] ^= 0xff; // Caller mutation after inspection must not alter the pinned identity.
  assert.equal(planner.planCreate({ inspection: verified, profileId: "editor", payloadDigest: digest }).ready, true);

  const forgedDigest = `sha256:${"ff".repeat(32)}`;
  assert.throws(
    () => planner.planCreate({ inspection: verified, profileId: "editor", payloadDigest: forgedDigest }),
    /payload digest is not verified/,
  );

  const alternate = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const crossManagerInspection = await alternate.inspectVerified({ name: "verified.exe", bytes: peFixture() });
  assert.throws(
    () => planner.planCreate({
      inspection: crossManagerInspection,
      profileId: "editor",
      payloadDigest: digest,
    }),
    /payload digest is not verified/,
  );
});

test("runtime descriptors reject mismatched engine families and unknown architectures", () => {
  const invalid = [
    { family: "windows", engine: "native-linux" },
    { family: "linux", engine: "wine" },
    { family: "linux", engine: "proton" },
    { architectures: ["unknown"] },
    { architectures: ["x86_64", "unknown"] },
  ];
  for (const override of invalid) {
    assert.throws(
      () => defineApplicationCompatibilityRuntime(runtime(override)),
      /engine and family are incompatible|runtime architectures contains an unsupported value/,
    );
    assert.throws(() => createApplicationCompatibilityManager({ runtimes: [runtime(override)] }));
  }

  for (const descriptor of [
    runtime({ family: "windows", engine: "wine" }),
    runtime({ family: "windows", engine: "proton" }),
    runtime({ family: "windows", engine: "other" }),
    runtime({ family: "linux", engine: "native-linux" }),
    runtime({ family: "linux", engine: "other" }),
  ]) {
    assert.equal(defineApplicationCompatibilityRuntime(descriptor).family, descriptor.family);
  }
});

test("a Linux-native runtime cannot be misrepresented as Windows to satisfy launch planning", () => {
  assert.throws(
    () => createApplicationCompatibilityManager({
      runtimes: [runtime({ family: "windows", engine: "native-linux" })],
    }),
    /engine and family are incompatible/,
  );
  const manager = createApplicationCompatibilityManager({
    runtimes: [runtime({ id: "linux-test", family: "linux", engine: "native-linux" })],
  });
  const inspection = manager.inspect({ name: "windows.exe", bytes: peFixture() });
  assert.equal(manager.planLaunch({ inspection }).ready, false);
  assert.equal(manager.planLaunch({ inspection }).reason, "runtime-unavailable");
});

test("Windows PE requires executable-image COFF flag and a complete bounded section table", () => {
  const manager = createApplicationCompatibilityManager({ runtimes: [runtime()] });
  const invalid = [
    ["no-image-flag", peFixture({ executable: false }), "missing-executable-image-characteristic"],
    ["zero-sections", peFixture({ sections: 0 }), "invalid-section-table"],
    ["too-many-sections", peFixture({ sections: 97 }), "invalid-section-table"],
    ["truncated-section-table", peFixture({ sections: 2, fileSize: 430 }), "invalid-section-table"],
  ];
  for (const [name, bytes, reason] of invalid) {
    const inspection = manager.inspect({ name: `${name}.exe`, bytes });
    assert.equal(inspection.kind, "windows-pe", name);
    assert.equal(inspection.launchable, false, name);
    assert.ok(inspection.evidence.includes(reason), name);
    assert.deepEqual(manager.planLaunch({ inspection }), {
      schema: "ordax.application-compatibility-plan/1",
      ready: false,
      runtimeId: null,
      reason: "payload-not-launchable",
    }, name);
  }

  const complete = manager.inspect({ name: "complete.exe", bytes: peFixture() });
  assert.equal(complete.launchable, true);
  assert.ok(complete.evidence.includes("valid-section-table"));
  assert.ok(complete.evidence.includes("executable-image-characteristic"));

  const dll = manager.inspect({ name: "component.dll", bytes: peFixture({ dll: true }) });
  assert.equal(dll.role, "library");
  assert.equal(dll.launchable, false);
  assert.ok(dll.evidence.includes("executable-image-characteristic"));
  assert.ok(dll.evidence.includes("dll-characteristic"));
});

function linuxElfFixture({
  bits = 64, machine = bits === 32 ? 3 : 62, type = 2,
  interpreter = false, appImage = false,
} = {}) {
  const bytes = new Uint8Array(256);
  const dv = new DataView(bytes.buffer);
  const is64 = bits === 64;
  const put16 = (at, v) => dv.setUint16(at, v, true);
  const put32 = (at, v) => dv.setUint32(at, v, true);
  const putWord = (at, v) => is64 ? dv.setBigUint64(at, BigInt(v), true) : put32(at, v);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, is64 ? 2 : 1, 1, 1]);
  if (appImage) bytes.set([0x41, 0x49, 2], 8);
  put16(16, type);
  put16(18, machine);
  put32(20, 1);
  putWord(24, type === 3 ? 0x1010 : 0x400010);
  putWord(is64 ? 32 : 28, is64 ? 64 : 52);
  put16(is64 ? 52 : 40, is64 ? 64 : 52);
  put16(is64 ? 54 : 42, is64 ? 56 : 32);
  put16(is64 ? 56 : 44, interpreter ? 2 : 1);
  const load = is64 ? 64 : 52;
  put32(load, 1); // PT_LOAD
  put32(load + (is64 ? 4 : 24), 5); // PF_R | PF_X
  putWord(load + (is64 ? 8 : 4), 0);
  putWord(load + (is64 ? 16 : 8), type === 3 ? 0x1000 : 0x400000);
  putWord(load + (is64 ? 32 : 16), bytes.length);
  putWord(load + (is64 ? 40 : 20), bytes.length);
  if (interpreter) {
    const ph = load + (is64 ? 56 : 32);
    const text = new TextEncoder().encode("/lib/ld.so\0");
    put32(ph, 3); // PT_INTERP
    putWord(ph + (is64 ? 8 : 4), 200);
    putWord(ph + (is64 ? 32 : 16), text.length);
    bytes.set(text, 200);
  }
  return bytes;
}

test("Linux ELF recognition shares the canonical manager and never invents a native provider", async () => {
  for (const [bits, machine, architecture] of [[32, 3, "x86"], [64, 62, "x86_64"], [64, 183, "aarch64"]]) {
    const bytes = linuxElfFixture({ bits, machine });
    const manager = createApplicationCompatibilityManager();
    const inspection = manager.inspect({ name: "program.exe", bytes }); // name is not authority
    assert.equal(inspection.family, "linux");
    assert.equal(inspection.kind, "linux-elf");
    assert.equal(inspection.architecture, architecture);
    assert.equal(inspection.role, "executable");
    assert.equal(inspection.launchable, true);
    assert.equal(manager.planLaunch({ inspection }).reason, "runtime-unavailable");

    const native = createApplicationCompatibilityManager({
      runtimes: [runtime({
        id: "native-linux-test", family: "linux", engine: "native-linux",
        architectures: [architecture],
      })],
    });
    const checked = await native.inspectVerified({ name: "program.bin", bytes });
    assert.equal(native.planLaunch({ inspection: checked }).runtimeId, "native-linux-test");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const planner = createApplicationCompatibilityProfilePlanner({ compatibility: native });
    const plan = planner.planCreate({ inspection: checked, payloadDigest: digest, profileId: "native-tool" });
    assert.equal(plan.ready, true);
    assert.equal(plan.profile.family, "linux");
  }
});

test("malformed ELF inputs and shared libraries remain nonlaunchable", () => {
  const manager = createApplicationCompatibilityManager();
  const cases = [
    linuxElfFixture({ type: 3 }), // ET_DYN without PT_INTERP: ambiguous shared object
    linuxElfFixture({ machine: 999 }),
    linuxElfFixture({ bits: 64, machine: 3 }), // class/machine mismatch
    linuxElfFixture({ type: 1 }), // ET_REL
    linuxElfFixture({ appImage: true }), // Type 2 needs a separate container verifier
    linuxElfFixture().slice(0, 48),
  ];
  const bigEndian = linuxElfFixture();
  bigEndian[5] = 2;
  cases.push(bigEndian);
  const outOfBounds = linuxElfFixture();
  new DataView(outOfBounds.buffer).setBigUint64(32, 0xffffffffffffffffn, true);
  cases.push(outOfBounds);
  const invalidSegment = linuxElfFixture();
  new DataView(invalidSegment.buffer).setBigUint64(64 + 32, 5000n, true);
  cases.push(invalidSegment);
  const noExecFlag = linuxElfFixture();
  new DataView(noExecFlag.buffer).setUint32(64 + 4, 4, true);
  cases.push(noExecFlag);
  for (const bytes of cases) {
    const inspection = manager.inspect({ name: "anything", bytes });
    assert.equal(inspection.family, "linux");
    assert.equal(inspection.launchable, false);
    assert.equal(manager.planLaunch({ inspection }).reason, "payload-not-launchable");
  }
  const nonElf = manager.inspect({ name: "fake.AppImage", bytes: new Uint8Array([1, 2, 3, 4]) });
  assert.equal(nonElf.kind, "unknown");
});

test("dynamic PIE ELF requires bounded interpreter; AppImage remains a nonlaunchable candidate", () => {
  const manager = createApplicationCompatibilityManager();
  const pie = manager.inspect({ name: "application", bytes: linuxElfFixture({ type: 3, interpreter: true }) });
  assert.equal(pie.kind, "linux-elf");
  assert.equal(pie.launchable, true);
  const appImage = manager.inspect({ name: "portable.AppImage", bytes: linuxElfFixture({ appImage: true }) });
  assert.equal(appImage.kind, "linux-appimage");
  assert.equal(appImage.launchable, false);
  assert.ok(appImage.evidence.includes("appimage-type2-verification-pending"));
});

test("legacy AppImage Type 1 marker never authorizes launch", () => {
  const data = linuxElfFixture({ appImage: true });
  data[10] = 1;
  const manager = createApplicationCompatibilityManager({ runtimes: [
    runtime({ id: "native-linux-test", family: "linux", engine: "native-linux" }),
  ] });
  const inspection = manager.inspect({ name: "legacy.AppImage", bytes: data });
  assert.equal(inspection.kind, "linux-appimage");
  assert.equal(inspection.launchable, false);
  assert.ok(inspection.evidence.includes("appimage-type1-verification-pending"));
  assert.equal(manager.planLaunch({ inspection }).reason, "payload-not-launchable");
});
