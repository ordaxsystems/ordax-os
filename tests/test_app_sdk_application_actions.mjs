import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA,
  APPLICATION_ACTION_CAPABILITY_SCHEMA,
  APPLICATION_ACTION_PROPOSAL_SCHEMA,
  assertApplicationActionCapabilityRegistryPort,
  validateApplicationActionCapability,
  validateApplicationActionProposal,
} from "../system/contracts/application-action-capability.mjs";

const rootUrl = new URL("../", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), "utf8"));
}

test("App SDK 1.10 publishes Application Action contracts from one canonical authority-free source", async () => {
  const bundle = await json("sdk/app-sdk-v1/bundle.json");
  assert.equal(bundle.bundle_version, "1.10.0");
  assert.equal(bundle.authority, "none");

  const byName = new Map(bundle.contracts.map((contract) => [contract.name, contract]));
  const expected = new Map([
    ["application-action-capability", APPLICATION_ACTION_CAPABILITY_SCHEMA],
    ["application-action-capability-registry", APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA],
    ["application-action-proposal", APPLICATION_ACTION_PROPOSAL_SCHEMA],
  ]);
  const blobs = new Set();
  for (const [name, schema] of expected) {
    const published = byName.get(name);
    assert.ok(published, `missing App SDK contract ${name}`);
    assert.equal(published.schema, schema);
    assert.equal(published.major, 1);
    assert.equal(published.source_path, "system/contracts/application-action-capability.mjs");
    assert.match(published.source_git_blob, /^[0-9a-f]{40}$/);
    blobs.add(published.source_git_blob);
  }
  assert.equal(blobs.size, 1);

  for (const required of [
    "project-cloud-links-data",
    "project-cloud-links-reader",
    "studio-runtime-v3",
  ]) {
    assert.ok(byName.has(required), `App SDK 1.10 must preserve 1.9 contract ${required}`);
  }

  assert.equal(
    bundle.contracts.some((contract) => /broker|executor|grant|authorization/.test(contract.name)),
    false,
  );
});

test("published Application Action contracts remain proposal-only and cannot mint execution authority", () => {
  const capability = validateApplicationActionCapability({
    schema: APPLICATION_ACTION_CAPABILITY_SCHEMA,
    appId: "notes",
    actionId: "notes.create-note",
    title: "Criar nota",
    description: "Descreve a criação de uma nota sem autorizar a execução.",
    sourceClass: "first-party",
    platform: "ordax",
    provider: {
      kind: "first-party-native",
      adapterId: "notes-native",
      revision: "1",
    },
    binding: { payloadSha256: null },
    parameters: [{
      id: "title",
      type: "string",
      required: false,
      maxLength: 240,
    }],
    riskClass: "local-change",
    confirmation: "policy-gated",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
    provenance: "ordax-app-sdk-test",
  });
  assert.equal(capability.executionAuthorized, false);
  assert.equal(capability.modelDirectExecutionAuthorized, false);

  const proposal = validateApplicationActionProposal({
    schema: APPLICATION_ACTION_PROPOSAL_SCHEMA,
    appId: "notes",
    actionId: "notes.create-note",
    arguments: { title: "Ideias" },
    riskClass: "local-change",
    confirmation: "policy-gated",
    capabilitySha256: "a".repeat(64),
    capabilityProvenance: "ordax-app-sdk-test",
    executionAuthorized: false,
    modelDirectExecutionAuthorized: false,
  });
  assert.equal(proposal.executionAuthorized, false);
  assert.equal(proposal.modelDirectExecutionAuthorized, false);

  const registry = {
    schema: APPLICATION_ACTION_CAPABILITY_REGISTRY_PORT_SCHEMA,
    list() { return []; },
    get() { return null; },
    listForApp() { return []; },
    propose() { return proposal; },
    contextItem() {
      return {
        id: "ordax-application-action-capabilities",
        scope: "system",
        text: "{}",
        provenance: "test",
      };
    },
  };
  assert.equal(assertApplicationActionCapabilityRegistryPort(registry), registry);

  for (const method of ["execute", "invoke", "run", "launch", "grant", "authorize", "confirm"]) {
    assert.throws(
      () => assertApplicationActionCapabilityRegistryPort({ ...registry, [method]() {} }),
      new RegExp(method),
    );
  }
});
