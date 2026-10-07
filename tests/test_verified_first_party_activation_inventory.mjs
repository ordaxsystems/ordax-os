import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
} from "../system/contracts/verified-component-package-source.mjs";
import {
  FIRST_PARTY_APP_ACTIVATION_INVENTORY_SCHEMA,
  FIRST_PARTY_APP_ACTIVATION_RECORD_SCHEMA,
  readVerifiedFirstPartyAppActivationInventory,
} from "../system/services/apps/verified-activation-inventory.mjs";

function source() {
  return Object.freeze({
    schema: VERIFIED_COMPONENT_PACKAGE_SOURCE_SCHEMA,
    metadataUrl(appId, state) {
      return `https://ordax.invalid/meta?component=${appId}&state=${state}`;
    },
    fileUrl() {
      throw new Error("inventory must not read package files");
    },
  });
}

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
  };
}

function slot(appId, version = "0.4.3", revision = 8) {
  return {
    componentId: appId,
    state: "current",
    source: "slot",
    revision,
    version,
    sourceCommit: "a".repeat(40),
    entrypoint: `system/apps/${appId}/src/runtime.mjs`,
    pendingHealth: null,
  };
}

function absent(appId, revision = 7) {
  return {
    componentId: appId,
    state: "current",
    source: "absent",
    revision,
    version: null,
    sourceCommit: null,
    entrypoint: null,
    pendingHealth: null,
  };
}

test("verified activation inventory derives installed truth only from current activation references", async () => {
  const seen = [];
  const inventory = await readVerifiedFirstPartyAppActivationInventory({
    appIds: ["notes", "studio"],
    source: source(),
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      const appId = new URL(url).searchParams.get("component");
      return response(appId === "notes" ? slot("notes") : absent("studio"));
    },
  });

  assert.equal(inventory.schema, FIRST_PARTY_APP_ACTIVATION_INVENTORY_SCHEMA);
  assert.equal(inventory.authority, "none");
  assert.deepEqual(inventory.records, [
    {
      schema: FIRST_PARTY_APP_ACTIVATION_RECORD_SCHEMA,
      appId: "notes",
      installed: true,
      version: "0.4.3",
      sourceCommit: "a".repeat(40),
      revision: 8,
      authority: "none",
    },
    {
      schema: FIRST_PARTY_APP_ACTIVATION_RECORD_SCHEMA,
      appId: "studio",
      installed: false,
      version: null,
      sourceCommit: null,
      revision: 7,
      authority: "none",
    },
  ]);
  assert.equal(seen.length, 2);
  for (const item of seen) {
    assert.equal(item.options.method, "GET");
    assert.equal(item.options.cache, "no-store");
    assert.equal(item.options.credentials, "same-origin");
    assert.equal(item.options.redirect, "error");
    assert.match(item.url, /state=current/);
  }
});

test("inventory never uses immutable cache presence or package files as installed truth", async () => {
  const packageSource = source();
  let metadataCalls = 0;
  const inventory = await readVerifiedFirstPartyAppActivationInventory({
    appIds: ["notes"],
    source: packageSource,
    fetchImpl: async () => {
      metadataCalls += 1;
      return response(absent("notes", 42));
    },
  });
  assert.equal(metadataCalls, 1);
  assert.equal(inventory.records[0].installed, false);
  assert.equal(inventory.records[0].revision, 42);
});

test("bundled resolution fails closed for an external independently delivered first-party app", async () => {
  await assert.rejects(
    () => readVerifiedFirstPartyAppActivationInventory({
      appIds: ["notes"],
      source: source(),
      fetchImpl: async () => response({
        componentId: "notes",
        state: "current",
        source: "bundled",
        revision: 1,
        version: null,
        sourceCommit: null,
        entrypoint: null,
        pendingHealth: null,
      }),
    }),
    /unexpectedly resolved to bundled source/,
  );
});

test("slot identity mismatches and malformed absent records fail closed", async () => {
  await assert.rejects(
    () => readVerifiedFirstPartyAppActivationInventory({
      appIds: ["notes"],
      source: source(),
      fetchImpl: async () => response(slot("studio")),
    }),
    /identity is inconsistent/,
  );

  await assert.rejects(
    () => readVerifiedFirstPartyAppActivationInventory({
      appIds: ["notes"],
      source: source(),
      fetchImpl: async () => response({ ...absent("notes"), version: "0.4.3" }),
    }),
    /absent activation identity is inconsistent/,
  );
});

test("inventory requires unique bounded ids and verified metadata availability", async () => {
  await assert.rejects(
    () => readVerifiedFirstPartyAppActivationInventory({
      appIds: ["notes", "notes"],
      source: source(),
      fetchImpl: async () => response(absent("notes")),
    }),
    /must be unique/,
  );
  await assert.rejects(
    () => readVerifiedFirstPartyAppActivationInventory({
      appIds: ["notes"],
      source: source(),
      fetchImpl: async () => response({}, 503),
    }),
    /HTTP 503/,
  );
});
