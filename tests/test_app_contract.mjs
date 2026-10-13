import assert from "node:assert/strict";
import test from "node:test";

import { FIRST_PARTY_APP_SCHEMA, defineFirstPartyApp } from "../system/contracts/first-party-app.mjs";
import { getFirstPartyApp } from "../system/apps/catalog.mjs";
import { COMPONENT_LOCALIZATION_SCHEMA } from "../system/contracts/localization-pack.mjs";
import { validateFileListing } from "../system/contracts/file-space.mjs";

function baseSpec(panel) {
  return {
    id: "example",
    title: "Example",
    description: "Example app",
    monogram: "EX",
    singleton: true,
    component: {
      id: "example",
      title: "Example",
      kind: "app",
      version: "0.1.0",
      releaseMode: "bundled",
      criticality: "optional",
      failureDomain: "app",
      restartScope: "surface",
      healthMode: "surface",
      owner: "tests/example",
      dependencies: [],
    },
    localization: {
      sourceLocale: "pt-BR",
      bundledLocales: ["pt-BR", "en-US"],
      packPolicy: "component-scoped",
    },
    requiredCapabilities: [],
    panels: [panel],
  };
}

test("app contract accepts a bounded extension slot", () => {
  const app = defineFirstPartyApp(baseSpec({
    kind: "extension",
    extensionId: "file-space",
    label: "Files",
    title: "Files",
    body: "Fallback",
  }));
  assert.equal(app.panels[0].extensionId, "file-space");
  assert.equal(Object.isFrozen(app.panels[0]), true);
});

test("app contract requires canonical component-scoped localization metadata", () => {
  const spec = baseSpec({
    kind: "extension",
    extensionId: "example-workspace",
    label: "Example",
    title: "Example",
    body: "Fallback",
  });
  const app = defineFirstPartyApp(spec);
  assert.equal(app.localization.schema, COMPONENT_LOCALIZATION_SCHEMA);
  assert.equal(app.localization.targetId, "example");
  assert.equal(app.localization.sourceLocale, "pt-BR");
  assert.deepEqual(app.localization.bundledLocales, ["pt-BR", "en-US"]);
  assert.deepEqual(app.localization.optionalLocales, []);
  assert.equal(app.localization.allowAppOverride, true);
  assert.equal(app.localization.packPolicy, "component-scoped");
  assert.equal(Object.isFrozen(app.localization), true);
  assert.equal(Object.isFrozen(app.localization.bundledLocales), true);
  assert.equal(Object.isFrozen(app.localization.optionalLocales), true);

  const missing = { ...spec };
  delete missing.localization;
  assert.throws(() => defineFirstPartyApp(missing), /missing localization metadata/);
});

test("app localization must bundle the source locale and reject duplicates", () => {
  const panel = {
    kind: "extension",
    extensionId: "example-workspace",
    label: "Example",
    title: "Example",
    body: "Fallback",
  };
  assert.throws(
    () => defineFirstPartyApp({
      ...baseSpec(panel),
      localization: {
        sourceLocale: "pt-BR",
        bundledLocales: ["en-US"],
        packPolicy: "component-scoped",
      },
    }),
    /Bundled locales must include the source locale/,
  );
  assert.throws(
    () => defineFirstPartyApp({
      ...baseSpec(panel),
      localization: {
        sourceLocale: "pt-BR",
        bundledLocales: ["pt-BR", "pt-BR"],
        packPolicy: "component-scoped",
      },
    }),
    /Bundled locales must contain unique locales/,
  );
});

test("app contract models optional host capabilities without changing availability requirements", () => {
  const spec = baseSpec({
    kind: "extension",
    extensionId: "example-workspace",
    label: "Example",
    title: "Example",
    body: "Fallback",
  });
  spec.requiredCapabilities = ["surface.render"];
  spec.optionalCapabilities = ["filesystem.user-space"];
  const app = defineFirstPartyApp(spec);

  assert.deepEqual(app.requiredCapabilities, ["surface.render"]);
  assert.deepEqual(app.optionalCapabilities, ["filesystem.user-space"]);
  assert.equal(Object.isFrozen(app.optionalCapabilities), true);
});

test("app contract defaults optional capabilities to an empty frozen list", () => {
  const app = defineFirstPartyApp(baseSpec({
    kind: "extension",
    extensionId: "example-workspace",
    label: "Example",
    title: "Example",
    body: "Fallback",
  }));
  assert.deepEqual(app.optionalCapabilities, []);
  assert.equal(Object.isFrozen(app.optionalCapabilities), true);
});

test("app contract rejects duplicated and overlapping optional capabilities", () => {
  const panel = {
    kind: "extension",
    extensionId: "example-workspace",
    label: "Example",
    title: "Example",
    body: "Fallback",
  };

  assert.throws(
    () => defineFirstPartyApp({
      ...baseSpec(panel),
      optionalCapabilities: ["filesystem.user-space", "filesystem.user-space"],
    }),
    /invalid optional capabilities/,
  );

  assert.throws(
    () => defineFirstPartyApp({
      ...baseSpec(panel),
      requiredCapabilities: ["filesystem.user-space"],
      optionalCapabilities: ["filesystem.user-space"],
    }),
    /cannot require and optionally consume the same capability/,
  );
});

test("app contract rejects invalid extension identifiers", () => {
  assert.throws(
    () => defineFirstPartyApp(baseSpec({
      kind: "extension",
      extensionId: "../native",
      label: "Invalid",
      title: "Invalid",
    })),
    /valid extensionId/,
  );
});

test("app owner exposes validated component identity", () => {
  const app = defineFirstPartyApp(baseSpec({
    kind: "extension",
    extensionId: "example-workspace",
    label: "Example",
    title: "Example",
    body: "Fallback",
  }));
  assert.equal(app.component.id, "example");
  assert.equal(app.component.kind, "app");
  assert.equal(app.component.version, "0.1.0");
  assert.equal(app.component.releaseMode, "bundled");
  assert.equal(Object.isFrozen(app.component), true);
});

test("Projects has no bundled fallback after remove-first Gate A", () => {
  assert.equal(getFirstPartyApp("projects"), null);
});


test("Internet stays absent from the OS app catalog after remove-first Gate A", () => {
  assert.equal(getFirstPartyApp("internet"), null);
  assert.equal(getFirstPartyApp("projects"), null);
});

test("app contract rejects obsolete identity-specific panel kinds", () => {
  for (const kind of ["identity-session", "identity-actions"]) {
    assert.throws(
      () => defineFirstPartyApp(baseSpec({
        kind,
        label: "Legacy identity panel",
        title: "Legacy",
      })),
      /unsupported panel kind/,
    );
  }
});

test("file-space contract accepts the logical root path", () => {
  const listing = validateFileListing({ path: "/", entries: [] });
  assert.equal(listing.path, "/");
  assert.deepEqual(listing.entries, []);
});

test("canonical first-party app schema has a single public owner", () => {
  assert.equal(FIRST_PARTY_APP_SCHEMA, "ordax.first-party-app/1");
});
