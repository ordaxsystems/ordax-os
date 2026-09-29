import assert from "node:assert/strict";
import test from "node:test";

import { getFirstPartyApp } from "../system/apps/catalog.mjs";
import {
  INSTALLED_APPLICATION_SCHEMA,
  toInstalledApplicationPresentation,
  validateInstalledApplication,
} from "../system/contracts/installed-application.mjs";
import { createInstalledApplicationCatalog } from "../system/services/apps/installed-catalog.mjs";

function record(overrides = {}) {
  return {
    schema: INSTALLED_APPLICATION_SCHEMA,
    id: "installed-example",
    title: "Example",
    description: "User-installed Windows application",
    monogram: "EX",
    origin: {
      platform: "windows",
      source: "local-file",
      payloadSha256: "a".repeat(64),
      publisher: null,
    },
    launch: {
      kind: "compatibility-profile",
      profileId: "profile-example",
      runtimeId: "wine-runtime",
      entrypointId: "main",
    },
    lifecycle: {
      installState: "installed",
      uninstallable: true,
      updateMode: "unknown",
    },
    trust: {
      nativeTrust: false,
      runtimeGrantsTrust: false,
    },
    ...overrides,
  };
}

test("installed Windows app remains outside trusted first-party catalog", () => {
  const app = validateInstalledApplication(record());
  assert.equal(app.id, "installed-example");
  assert.equal(getFirstPartyApp(app.id), null);
});

test("presentation is normal app metadata with compatibility disclosed only as detail metadata", () => {
  const presentation = toInstalledApplicationPresentation(record());
  assert.deepEqual(presentation, {
    id: "installed-example",
    title: "Example",
    description: "User-installed Windows application",
    monogram: "EX",
    sourceClass: "installed",
    platform: "windows",
    compatibilityManaged: true,
    detailDisclosure: "compatibility-runtime",
  });
  assert.equal(Object.hasOwn(presentation, "wine"), false);
  assert.equal(Object.hasOwn(presentation, "command"), false);
  assert.equal(Object.hasOwn(presentation, "prefixPath"), false);
});

test("catalog is read-only and rejects duplicate installed identities", () => {
  const catalog = createInstalledApplicationCatalog([record()]);
  assert.equal(catalog.list().length, 1);
  assert.equal(catalog.get("installed-example")?.title, "Example");
  assert.equal(typeof catalog.register, "undefined");
  assert.equal(typeof catalog.install, "undefined");
  assert.equal(typeof catalog.launch, "undefined");
  assert.throws(
    () => createInstalledApplicationCatalog([record(), record()]),
    /duplicated/,
  );
});

test("foreign app cannot obtain native trust through runtime metadata", () => {
  assert.throws(
    () => validateInstalledApplication(record({
      trust: { nativeTrust: true, runtimeGrantsTrust: false },
    })),
    /cannot grant native trust/,
  );
  assert.throws(
    () => validateInstalledApplication(record({
      trust: { nativeTrust: false, runtimeGrantsTrust: true },
    })),
    /cannot grant native trust/,
  );
});

test("catalog entry exposes opaque compatibility binding rather than host paths or commands", () => {
  assert.throws(
    () => validateInstalledApplication(record({
      launch: {
        kind: "compatibility-profile",
        profileId: "profile-example",
        runtimeId: "wine-runtime",
        entrypointId: "/windows/c/program-files/example.exe",
      },
    })),
    /entrypoint id is invalid/,
  );
  assert.throws(
    () => validateInstalledApplication({ ...record(), command: "wine example.exe" }),
    /incompatible fields/,
  );
});

test("only committed and uninstallable records enter installed catalog", () => {
  assert.throws(
    () => validateInstalledApplication(record({
      lifecycle: { installState: "installing", uninstallable: true, updateMode: "unknown" },
    })),
    /committed installed applications/,
  );
  assert.throws(
    () => validateInstalledApplication(record({
      lifecycle: { installState: "installed", uninstallable: false, updateMode: "unknown" },
    })),
    /explicit uninstall lifecycle/,
  );
});
