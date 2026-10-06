import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createNativeVerifiedComponentPackageSource } from "../system/adapters/native/verified-component-package-source.mjs";
import {
  EXTERNAL_FIRST_PARTY_SEMANTIC_APP_IDS,
  loadVerifiedFirstPartyApplicationSemantics,
  loadVerifiedFirstPartyApplicationActionManifests,
  loadVerifiedFirstPartyIntelligenceManifests,
  overlayVerifiedFirstPartyApplications,
} from "../system/services/intelligence/verified-app-semantics.mjs";

const SHA = "7".repeat(40);

function windowRef() {
  return { location: { href: "http://127.0.0.1:43121/" } };
}

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

function slotMetadata(appId = "notes", version = "0.4.1") {
  return {
    componentId: appId,
    state: "current",
    source: "slot",
    revision: 5,
    version,
    sourceCommit: SHA,
    entrypoint: `system/apps/${appId}/src/runtime.mjs`,
    pendingHealth: null,
  };
}

function appManifest(appId = "notes", version = "0.4.1", overrides = {}) {
  return {
    schema: "ordax.component-manifest/1",
    id: appId,
    title: appId === "notes" ? "Notas" : "ORDAX Studio",
    kind: "app",
    version,
    releaseMode: "component-slot",
    criticality: "optional",
    failureDomain: "app",
    restartScope: "component",
    healthMode: "runtime",
    owner: "washingtonmsdj/ordax-apps",
    dependencies: [],
    ...overrides,
  };
}

function semantics(appId = "notes", version = "0.4.1") {
  return {
    schema: "ordax.app-intelligence-manifest/1",
    appId,
    appVersion: version,
    authority: "none",
    execution: "declarative-only",
    instructions: ["Use somente as capacidades declaradas pelo app verificado."],
    intents: [
      {
        id: `${appId}.create-note`,
        description: "Criar uma nota.",
        effect: "write",
        confirmation: "policy",
        parameters: [],
        examples: ["Crie uma nota."],
      },
    ],
  };
}


function actions(appId = "notes", version = "0.4.1", overrides = {}) {
  return {
    schema: "ordax.application-action-manifest/1",
    appId,
    appVersion: version,
    authority: "none",
    execution: "proposal-only",
    capabilities: [
      {
        schema: "ordax.application-action-capability/1",
        appId,
        actionId: `${appId}.create-note`,
        title: "Criar nota",
        description: "Criar uma nota.",
        sourceClass: "first-party",
        platform: "ordax",
        provider: {
          kind: "first-party-native",
          adapterId: `${appId}-native`,
          revision: "1",
        },
        binding: { payloadSha256: null },
        parameters: [],
        riskClass: "local-change",
        confirmation: "policy-gated",
        executionAuthorized: false,
        modelDirectExecutionAuthorized: false,
        provenance: `ordax-apps:${appId}/actions/manifest.json`,
      },
    ],
    ...overrides,
  };
}

function verifiedEntry(appId = "notes", version = "0.4.1") {
  const component = appManifest(appId, version);
  return {
    application: {
      id: component.id,
      title: component.title,
      component,
    },
    intelligenceManifest: semantics(appId, version),
    actionManifest: actions(appId, version),
    sourceCommit: SHA,
    revision: 5,
  };
}

function verifiedFetch({
  appId = "notes",
  version = "0.4.1",
  app = null,
  ai = null,
  actionManifest = null,
  actionStatus = 200,
} = {}) {
  const calls = [];
  return {
    calls,
    async fetchImpl(url, options) {
      calls.push({ url, options });
      const parsed = new URL(url);
      if (parsed.pathname === "/__ordax/native/component-runtime") {
        return jsonResponse(slotMetadata(appId, version));
      }
      const prefix =
        `/__ordax/native/component-module/${appId}/current/${version}/`
        + SHA
        + `/system/apps/${appId}/`;
      assert.equal(parsed.pathname.startsWith(prefix), true);
      if (parsed.pathname.endsWith("/app.json")) {
        return jsonResponse(app ?? appManifest(appId, version));
      }
      if (parsed.pathname.endsWith("/ai/manifest.json")) {
        return jsonResponse(ai ?? semantics(appId, version));
      }
      if (parsed.pathname.endsWith("/actions/manifest.json")) {
        if (actionStatus === 404) return jsonResponse({}, 404);
        return jsonResponse(actionManifest ?? actions(appId, version));
      }
      throw new Error(`unexpected verified package path: ${parsed.pathname}`);
    },
  };
}

test("external semantic app projection matches canonical runtime component source policy", async () => {
  const policy = JSON.parse(
    await readFile(
      new URL("../docs/contracts/runtime-component-package.json", import.meta.url),
      "utf8",
    ),
  );
  const external = policy.canonical_external_source_repository_by_component;
  assert.deepEqual(
    [...EXTERNAL_FIRST_PARTY_SEMANTIC_APP_IDS].sort(),
    Object.keys(external).sort(),
  );
  for (const appId of EXTERNAL_FIRST_PARTY_SEMANTIC_APP_IDS) {
    assert.equal(external[appId], "washingtonmsdj/ordax-apps");
  }
});

test("verified app semantics binds identity, AI and Actions to the exact current slot", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch();
  const entries = await loadVerifiedFirstPartyApplicationSemantics({
    appIds: ["notes"],
    source,
    fetchImpl: fixture.fetchImpl,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].application.id, "notes");
  assert.equal(entries[0].application.title, "Notas");
  assert.equal(entries[0].application.component.version, "0.4.1");
  assert.equal(entries[0].application.component.releaseMode, "component-slot");
  assert.equal(entries[0].application.component.owner, "washingtonmsdj/ordax-apps");
  assert.equal(entries[0].intelligenceManifest.appId, "notes");
  assert.equal(entries[0].intelligenceManifest.appVersion, "0.4.1");
  assert.equal(entries[0].intelligenceManifest.authority, "none");
  assert.equal(entries[0].intelligenceManifest.execution, "declarative-only");
  assert.equal(entries[0].actionManifest.appId, "notes");
  assert.equal(entries[0].actionManifest.appVersion, "0.4.1");
  assert.equal(entries[0].actionManifest.authority, "none");
  assert.equal(entries[0].actionManifest.execution, "proposal-only");
  assert.equal(entries[0].actionManifest.capabilities[0].actionId, "notes.create-note");
  assert.equal(entries[0].sourceCommit, SHA);
  assert.equal(entries[0].revision, 5);
  assert.equal(fixture.calls.length, 4);
  assert.equal(
    new URL(fixture.calls[1].url).pathname.endsWith("/system/apps/notes/app.json"),
    true,
  );
  assert.equal(
    new URL(fixture.calls[2].url).pathname.endsWith("/system/apps/notes/ai/manifest.json"),
    true,
  );
  assert.equal(
    new URL(fixture.calls[3].url).pathname.endsWith("/system/apps/notes/actions/manifest.json"),
    true,
  );
  for (const call of fixture.calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.redirect, "error");
  }
});

test("verified external app identity replaces same-id development app and appends externalized apps", () => {
  const base = [
    {
      id: "studio",
      title: "ORDAX Studio",
      component: {
        id: "studio",
        title: "ORDAX Studio",
        kind: "app",
        version: "0.4.0",
        releaseMode: "git-app",
        criticality: "optional",
        failureDomain: "app",
        restartScope: "component",
        healthMode: "runtime",
        owner: "system/apps/studio",
        dependencies: ["surface-shell"],
      },
    },
    {
      id: "files",
      title: "Arquivos",
      component: {
        id: "files",
        title: "Arquivos",
        kind: "app",
        version: "0.1.0",
        releaseMode: "bundled",
        criticality: "optional",
        failureDomain: "app",
        restartScope: "surface",
        healthMode: "surface",
        owner: "system/apps/files",
        dependencies: ["surface-shell"],
      },
    },
  ];
  const overlaid = overlayVerifiedFirstPartyApplications(
    base,
    [verifiedEntry("studio", "0.4.3"), verifiedEntry("notes", "0.4.1")],
  );
  assert.deepEqual(overlaid.map((app) => app.id), ["studio", "files", "notes"]);
  assert.equal(overlaid[0].component.releaseMode, "component-slot");
  assert.equal(overlaid[0].component.version, "0.4.3");
  assert.equal(overlaid[2].component.owner, "washingtonmsdj/ordax-apps");
});

test("verified application overlay rejects arbitrary or incompletely verified replacements", () => {
  const foreignId = verifiedEntry("notes");
  foreignId.application.id = "files";
  foreignId.application.component = appManifest("files", "0.4.1");
  foreignId.intelligenceManifest = semantics("files", "0.4.1");
  assert.throws(
    () => overlayVerifiedFirstPartyApplications([], [foreignId]),
    /not an allowed external first-party app/,
  );

  const ownerDrift = verifiedEntry("notes");
  ownerDrift.application.component = appManifest("notes", "0.4.1", {
    owner: "system/apps/notes",
  });
  assert.throws(
    () => overlayVerifiedFirstPartyApplications([], [ownerDrift]),
    /overlay identity drifted/,
  );

  const versionDrift = verifiedEntry("notes");
  versionDrift.intelligenceManifest = semantics("notes", "9.9.9");
  assert.throws(
    () => overlayVerifiedFirstPartyApplications([], [versionDrift]),
    /appVersion mismatch/,
  );

  const badSource = verifiedEntry("notes");
  badSource.sourceCommit = "deadbeef";
  assert.throws(
    () => overlayVerifiedFirstPartyApplications([], [badSource]),
    /sourceCommit/,
  );
});

test("verified application overlay rejects duplicate identities instead of choosing implicitly", () => {
  assert.throws(
    () => overlayVerifiedFirstPartyApplications(
      [{ id: "studio" }, { id: "studio" }],
      [],
    ),
    /base catalog duplicates app/,
  );
  assert.throws(
    () => overlayVerifiedFirstPartyApplications(
      [],
      [verifiedEntry("notes"), verifiedEntry("notes")],
    ),
    /overlay duplicates app/,
  );
});

test("manifest-only compatibility helper is derived from verified application semantics", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch();
  const manifests = await loadVerifiedFirstPartyIntelligenceManifests({
    appIds: ["notes"],
    source,
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].appId, "notes");
  assert.equal(manifests[0].appVersion, "0.4.1");
});

test("legacy verified package without Action manifest keeps Intelligence semantics but exposes no capabilities", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch({ actionStatus: 404 });
  const entries = await loadVerifiedFirstPartyApplicationSemantics({
    appIds: ["notes"],
    source,
    fetchImpl: fixture.fetchImpl,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].application.id, "notes");
  assert.equal(entries[0].intelligenceManifest.appId, "notes");
  assert.equal(entries[0].actionManifest, null);
  assert.equal(fixture.calls.length, 4);

  const actionFixture = verifiedFetch({ actionStatus: 404 });
  const actionManifests = await loadVerifiedFirstPartyApplicationActionManifests({
    appIds: ["notes"],
    source,
    fetchImpl: actionFixture.fetchImpl,
  });
  assert.deepEqual(actionManifests, []);
});

test("action-manifest compatibility helper is derived from the same verified application semantics", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch();
  const actionManifests = await loadVerifiedFirstPartyApplicationActionManifests({
    appIds: ["notes"],
    source,
    fetchImpl: fixture.fetchImpl,
  });
  assert.equal(actionManifests.length, 1);
  assert.equal(actionManifests[0].appId, "notes");
  assert.equal(actionManifests[0].appVersion, "0.4.1");
  assert.equal(actionManifests[0].capabilities[0].actionId, "notes.create-note");
});

test("absent external app is skipped without reading app identity, AI or Actions", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  let calls = 0;
  const entries = await loadVerifiedFirstPartyApplicationSemantics({
    appIds: ["notes"],
    source,
    async fetchImpl(url) {
      calls += 1;
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/__ordax/native/component-runtime");
      return jsonResponse({
        componentId: "notes",
        state: "current",
        source: "absent",
        revision: 7,
        version: null,
        sourceCommit: null,
        entrypoint: null,
        pendingHealth: null,
      });
    },
  });
  assert.deepEqual(entries, []);
  assert.equal(calls, 1);
});

test("app.json identity must match exact verified slot and external first-party policy", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  for (const [label, app, expected] of [
    ["schema", appManifest("notes", "0.4.1", { schema: "other/9" }), /schema drifted/],
    ["version", appManifest("notes", "0.4.2"), /identity drifted/],
    ["release mode", appManifest("notes", "0.4.1", { releaseMode: "git-app" }), /identity drifted/],
    ["owner", appManifest("notes", "0.4.1", { owner: "system/apps/notes" }), /identity drifted/],
  ]) {
    await assert.rejects(
      () => {
        const fixture = verifiedFetch({ app });
        return loadVerifiedFirstPartyApplicationSemantics({
          appIds: ["notes"],
          source,
          fetchImpl: fixture.fetchImpl,
        });
      },
      expected,
      label,
    );
  }
});

test("AI manifest version must match component identity from the same verified slot", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  const fixture = verifiedFetch({ ai: semantics("notes", "0.4.2") });
  await assert.rejects(
    () => loadVerifiedFirstPartyApplicationSemantics({
      appIds: ["notes"],
      source,
      fetchImpl: fixture.fetchImpl,
    }),
    /appVersion mismatch/,
  );
});

test("Application Action manifest version and semantic binding must match the same verified slot", async () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());

  await assert.rejects(
    () => {
      const fixture = verifiedFetch({
        actionManifest: actions("notes", "0.4.2"),
      });
      return loadVerifiedFirstPartyApplicationSemantics({
        appIds: ["notes"],
        source,
        fetchImpl: fixture.fetchImpl,
      });
    },
    /appVersion mismatch/,
  );

  const missingIntent = actions("notes", "0.4.1");
  missingIntent.capabilities[0].actionId = "notes.unknown";
  await assert.rejects(
    () => {
      const fixture = verifiedFetch({ actionManifest: missingIntent });
      return loadVerifiedFirstPartyApplicationSemantics({
        appIds: ["notes"],
        source,
        fetchImpl: fixture.fetchImpl,
      });
    },
    /no matching Intelligence intent/,
  );

  const weakConfirmation = actions("notes", "0.4.1");
  weakConfirmation.capabilities[0].confirmation = "none";
  await assert.rejects(
    () => {
      const fixture = verifiedFetch({ actionManifest: weakConfirmation });
      return loadVerifiedFirstPartyApplicationSemantics({
        appIds: ["notes"],
        source,
        fetchImpl: fixture.fetchImpl,
      });
    },
    /confirmation is weaker/,
  );
});

test("verified package source never exposes mutation or execution methods", () => {
  const source = createNativeVerifiedComponentPackageSource(windowRef());
  for (const method of [
    "execute",
    "invoke",
    "run",
    "install",
    "uninstall",
    "promote",
    "rollback",
    "writeFile",
  ]) {
    assert.equal(source[method], undefined);
  }
});
