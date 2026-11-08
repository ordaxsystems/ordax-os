import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
} from "../system/contracts/verified-component-package-source.mjs";
import {
  createNativeStoreCatalogComposition,
} from "../system/composition/native/store-catalog.mjs";
import { createNativeAppLifecycleDelegate } from "../system/adapters/native/app-lifecycle-delegate.mjs";
import { createAppLifecycleRequestService } from "../system/services/apps/store-lifecycle-request-service.mjs";
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
  const nativeMetadataReads = () => calls.filter(
    (call) => String(call.url).includes("/__ordax/native/component-runtime"),
  ).length;
  const expectedReads = listExternalFirstPartyComponentIds().length;
  assert.equal(nativeMetadataReads(), expectedReads,
    "initial Store setup must reuse the one Native metadata sweep");
  await composition.refresh();
  assert.equal(nativeMetadataReads(), expectedReads * 2,
    "one signed catalog refresh must run one additional metadata sweep, not two");
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

test("Native Store revokes install actions and transient current observations while signed catalog refresh is pending", async () => {
  let releaseCatalog;
  let catalogReads = 0;
  const windowRef = {
    async fetch(url) {
      if (url === "/__ordax/native/store-catalog") {
        catalogReads += 1;
        if (catalogReads === 2) {
          return new Promise((resolve) => { releaseCatalog = resolve; });
        }
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
  const initial = composition.port.getSnapshot();
  assert.equal(initial.entries.find((entry) => entry.appId === "notes").installable, true);
  assert.ok(composition.getCurrentObservations().length > 0);

  const updating = composition.refresh();
  assert.equal(catalogReads, 2);
  assert.equal(composition.verifiedCatalogPort.getSnapshot().state, "unavailable");
  assert.equal(
    composition.verifiedCatalogPort.getSnapshot().reason,
    "native-store-catalog-refreshing",
  );
  assert.equal(composition.port.getSnapshot().state, "unavailable");
  assert.deepEqual(composition.port.getSnapshot().entries, []);
  assert.deepEqual(composition.getCurrentObservations(), []);

  releaseCatalog(response(verifiedCatalog()));
  await updating;
  const refreshed = composition.port.getSnapshot();
  assert.equal(refreshed.state, "ready");
  assert.equal(refreshed.entries.find((entry) => entry.appId === "notes").installable, true);
  composition.destroy();
  assert.equal(composition.port.getSnapshot().state, "unavailable");
  assert.equal(composition.verifiedCatalogPort.getSnapshot().state, "unavailable");
});

test("accepted signed Go remove receipt refreshes the SAME Native Store and CURRENT observation without page restart", { timeout: 8000 }, async t => {
  let installed = true;
  let goMutations = 0;
  let storeReads = 0;
  const windowRef = {
    async fetch(url, options = {}) {
      if (url === "/__ordax/native/store-catalog") {
        storeReads += 1;
        return response(verifiedCatalog());
      }
      if (url === "/__ordax/native/store-lifecycle") {
        goMutations += 1;
        const plan = JSON.parse(options.body);
        assert.equal(plan.request.operation, "remove");
        assert.equal(plan.candidate, null);
        assert.deepEqual(plan.expectedActivation, {
          source: "slot", revision: 7, version: "0.4.3", sourceCommit: COMMIT,
        });
        installed = false;
        return response({
          schema: "ordax.app-lifecycle-request-result/1",
          requestId: plan.request.requestId,
          appId: plan.request.appId,
          operation: plan.request.operation,
          source: plan.request.source,
          state: "accepted", reason: null, authority: "none",
        });
      }
      const parsed = new URL(url);
      if (parsed.pathname === "/__ordax/native/component-runtime") {
        const appId = parsed.searchParams.get("component");
        if (appId === "notes") {
          return response(installed ? {
            componentId: appId, state: "current", source: "slot",
            revision: 7, version: "0.4.3", sourceCommit: COMMIT,
            entrypoint: "system/apps/notes/src/runtime.mjs", pendingHealth: null,
          } : {
            componentId: appId, state: "current", source: "removed",
            revision: 8, version: null, sourceCommit: null,
            entrypoint: null, pendingHealth: null,
          });
        }
        return response(metadata(appId));
      }
      return response({}, 404);
    },
  };
  const store = await createNativeStoreCatalogComposition({
    windowRef, componentSource: componentSource(),
  });
  t.after(() => store.destroy());
  const before = store.port.getSnapshot().entries.find(item => item.appId === "notes");
  assert.equal(before.state, "installed");
  assert.equal(before.removable, true);
  assert.equal(store.getCurrentObservations().find(item => item.componentId === "notes").source, "slot");

  let resolveUpdated;
  const updated = new Promise(resolve => { resolveUpdated = resolve; });
  const visibleStates = [];
  const unsubscribe = store.port.subscribe(snapshot => {
    visibleStates.push(snapshot.state);
    const notes = snapshot.entries.find(item => item.appId === "notes");
    if (snapshot.state === "ready" && notes?.installedVersion === null &&
        store.getCurrentObservations().find(item => item.componentId === "notes")?.source === "removed") {
      resolveUpdated();
    }
  });
  t.after(unsubscribe);
  const service = createAppLifecycleRequestService({
    catalogPort: store.port,
    verifiedCatalogPort: store.verifiedCatalogPort,
    getCurrentObservations: () => store.getCurrentObservations(),
    lifecycleDelegate: createNativeAppLifecycleDelegate(windowRef, {
      onAccepted() { return store.refresh(); },
    }),
  });
  const request = {
    schema: "ordax.app-lifecycle-request/1",
    requestId: "store:remove:notes:integrated-observation",
    appId: "notes", operation: "remove", source: "store", authority: "none",
  };
  const receipt = await service.requestLifecycle(request);
  assert.equal(receipt.state, "accepted", JSON.stringify({reason: receipt.reason, goMutations, storeReads, state: store.port.getSnapshot().state}));
  await updated;
  const after = store.port.getSnapshot().entries.find(item => item.appId === "notes");
  assert.equal(after.installedVersion, null);
  assert.equal(after.installable, true, "signed catalog may still offer explicit reinstallation");
  assert.equal(goMutations, 1);
  assert.equal(storeReads, 2, "one bootstrap read and one accepted-receipt refresh");
  assert.ok(visibleStates.includes("unavailable"),
    "the native Store revokes old UI affordances before observing post-Go state");
  assert.equal((await service.requestLifecycle(request)).state, "accepted");
  assert.equal(goMutations, 1, "replaying an identical request cannot mutate again");
  assert.equal(storeReads, 2, "replay cannot start another Store refresh");
});
