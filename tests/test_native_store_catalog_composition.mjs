import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
} from "../system/contracts/verified-component-package-source.mjs";
import {
  createNativeStoreCatalogComposition,
} from "../system/composition/native/store-catalog.mjs";
import { listFirstRunDefaultAppIds, planFirstRunAppSelectionFromStore } from "../system/services/apps/first-run-selection.mjs";
import { listExternalFirstPartyComponentIds } from "../system/services/apps/external-first-party-policy.mjs";

const COMMIT = "a".repeat(40);

function artifact(name, char) {
  return { name, sha256: char.repeat(64), size: 123 };
}

function verifiedCatalog() {
  return {
    schema: "ordax.verified-app-store-catalog/1",
    state: "ready",
    sequence: 3,
    catalogSha256: "f".repeat(64),
    source: {
      repository: "ordaxsystems/ordax-apps",
      commit: COMMIT,
    },
    trust: {
      domain: "runtime-components",
      keyId: "ordax-runtime-components-v1",
    },
    entries: [
      {
        appId: "notes",
        title: "Notas",
        version: "0.4.3",
        releaseMode: "component-slot",
        sourceCommit: COMMIT,
        artifacts: {
          package: artifact("notes.zip", "b"),
          release: artifact("notes.release.json", "c"),
          compatibility: artifact("notes.compatibility.json", "d"),
      componentEnvelope: artifact("notes.runtime-component-envelope.json", "6"),
        },
      },
    ],
    reason: null,
    authority: "none",
  };
}

function componentSource() {
  return Object.freeze({
    schema: VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
    metadataUrl(appId, state) {
      return `https://surface.test/__ordax/native/component-runtime?component=${appId}&state=${state}`;
    },
    fileUrl() {
      throw new Error("Store catalog composition must not read package files");
    },
  });
}

function metadata(appId) {
  return {
    componentId: appId,
    state: "current",
    source: "absent",
    revision: 1,
    version: null,
    sourceCommit: null,
    entrypoint: null,
    pendingHealth: null,
  };
}

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

test("Native Store composition derives installability only from verified catalog plus activation SSOT", async () => {
  const calls = [];
  const windowRef = {
    async fetch(url, options) {
      calls.push({ url, options });
      if (url === "/__ordax/native/store-catalog") {
        return response(verifiedCatalog());
      }
      const parsed = new URL(url);
      if (parsed.pathname === "/__ordax/native/component-runtime") {
        return response(metadata(parsed.searchParams.get("component")));
      }
      return response({}, 404);
    },
  };

  const composition = await createNativeStoreCatalogComposition({
    windowRef,
    componentSource: componentSource(),
  });
  const snapshot = composition.port.getSnapshot();
  const notes = snapshot.entries.find((entry) => entry.appId === "notes");

  assert.notEqual(composition.verifiedCatalogPort, null);
  assert.equal(composition.verifiedCatalogPort.getSnapshot().state, "ready");
  assert.equal(composition.verifiedCatalogPort.getSnapshot().sequence, 3);
  assert.equal(snapshot.state, "ready");
  assert.equal(notes.state, "available");
  assert.equal(notes.installable, true);
  assert.equal(notes.availableVersion, "0.4.3");
  assert.equal(notes.artifactIdentityVerified, true);
  assert.equal(notes.provenanceVerified, true);
  assert.equal(
    calls.some((call) => call.url === "/__ordax/native/store-catalog"),
    true,
  );
  assert.equal(
    calls.some((call) => String(call.url).includes("/__ordax/native/component-runtime")),
    true,
  );
  const readsBefore = calls.length;
  const observations = composition.getCurrentObservations();
  assert.equal(calls.length, readsBefore, "First Run reuses existing Native metadata without refetch");
  assert.deepEqual(observations.map(item => item.componentId).sort(), [...listExternalFirstPartyComponentIds()].sort());
  assert.equal(observations.find(item => item.componentId === "notes").source, "absent");
  assert.equal(Object.isFrozen(observations), true);
  composition.destroy();
  assert.deepEqual(composition.getCurrentObservations(), []);
});

test("Native Store composition preserves unavailable state without inventing catalog entries", async () => {
  const composition = await createNativeStoreCatalogComposition({
    windowRef: {
      async fetch(url) {
        if (url === "/__ordax/native/store-catalog") {
          return response({
            schema: "ordax.verified-app-store-catalog/1",
            state: "unavailable",
            sequence: null,
            catalogSha256: null,
            source: null,
            trust: null,
            entries: [],
            reason: "catalog-envelope-unavailable",
            authority: "none",
          });
        }
        throw new Error("activation metadata must not be read without verified catalog");
      },
    },
    componentSource: componentSource(),
  });

  const snapshot = composition.port.getSnapshot();
  assert.equal(snapshot.state, "unavailable");
  assert.deepEqual(snapshot.entries, []);
  assert.deepEqual(composition.getCurrentObservations(), []);
  composition.destroy();
});

test("Native Store composition has an authority-free fallback when browser transport is absent", async () => {
  const composition = await createNativeStoreCatalogComposition({
    windowRef: {},
    componentSource: componentSource(),
  });
  const snapshot = composition.port.getSnapshot();
  assert.equal(snapshot.state, "unavailable");
  assert.deepEqual(snapshot.entries, []);
  assert.equal(composition.port.authority, "none");
  assert.equal(composition.verifiedCatalogPort, null);
  assert.deepEqual(composition.getCurrentObservations(), []);
  composition.destroy();
});

test("Native first-run selection shares Store current-state reads and never restores an explicitly removed app", async () => {
  let nativeSource = "absent";
  let nativeReads = 0;
  const composition = await createNativeStoreCatalogComposition({
    windowRef: {
      async fetch(url) {
        if (url === "/__ordax/native/store-catalog") return response(verifiedCatalog());
        const parsed = new URL(url);
        if (parsed.pathname === "/__ordax/native/component-runtime") {
          nativeReads += 1;
          const appId = parsed.searchParams.get("component");
          return response({ ...metadata(appId), source: appId === "notes" ? nativeSource : "absent" });
        }
        return response({}, 404);
      },
    },
    componentSource: componentSource(),
  });
  const observe = (initialProvisioning) => planFirstRunAppSelectionFromStore({
    initialProvisioning,
    explicitlyRemovedAppIds: [],
    storeCatalogSnapshot: composition.port.getSnapshot(),
    nativeCurrentMetadata: composition.getCurrentObservations()
      .filter(item => listFirstRunDefaultAppIds().includes(item.componentId)),
  });
  const count = nativeReads;
  assert.deepEqual(observe(true).eligibleCandidateAppIds, ["notes"]);
  assert.equal(nativeReads, count, "first-run plan must not issue another Native read");

  nativeSource = "removed";
  await composition.refresh();
  const removed = observe(true);
  assert.deepEqual(removed.eligibleCandidateAppIds, []);
  assert.ok(removed.suppressedAppIds.includes("notes"));
  assert.deepEqual(observe(false).eligibleCandidateAppIds, []);
  assert.ok(observe(false).suppressedAppIds.includes("notes"));
  composition.destroy();
});
