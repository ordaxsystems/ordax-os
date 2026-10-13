import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  EXTERNAL_FIRST_PARTY_COMPONENT_IDS,
  EXTERNAL_FIRST_PARTY_OWNER,
  EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS,
  EXTERNAL_FIRST_PARTY_NATIVE_PROBATION_IDS,
  hasNativeExternalFirstPartyProbation,
  hasNativeExternalFirstPartyModuleRead,
  EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT,
  isExternalFirstPartyComponentId,
  listExternalFirstPartyComponentIds,
} from "../system/services/apps/external-first-party-policy.mjs";

test("generated external first-party runtime policy exposes one canonical owner mapping", () => {
  assert.equal(EXTERNAL_FIRST_PARTY_OWNER, "ordaxsystems/ordax-apps");
  const packagePolicy = JSON.parse(readFileSync(
    new URL("../docs/contracts/runtime-component-package.json", import.meta.url),
    "utf8",
  ));
  const canonicalSources = packagePolicy.canonical_package_source_repository_by_component;
  const expected = Object.fromEntries(
    Object.entries(canonicalSources).sort(([a], [b]) => a.localeCompare(b)),
  );
  assert.deepEqual(EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT, expected);
  assert.deepEqual([...EXTERNAL_FIRST_PARTY_COMPONENT_IDS], Object.keys(expected));
  assert.equal(EXTERNAL_FIRST_PARTY_COMPONENT_IDS.length >= 14, true,
    "the 13 package candidates and Studio must not silently disappear");
  for (const [appId, owner] of Object.entries(canonicalSources)) {
    assert.equal(owner, EXTERNAL_FIRST_PARTY_OWNER, appId);
    assert.equal(isExternalFirstPartyComponentId(appId), true, appId);
  }
  const moduleRead = packagePolicy.native_loopback_broker_supported_components;
  const expectedModuleRead = Object.keys(canonicalSources)
    .filter((appId) => moduleRead.includes(appId))
    .sort();
  assert.deepEqual(EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS, expectedModuleRead);
  assert.equal(hasNativeExternalFirstPartyModuleRead("notes"), true);
  assert.equal(hasNativeExternalFirstPartyModuleRead("studio"), true);
  assert.equal(hasNativeExternalFirstPartyModuleRead("calculator"), true);
  assert.deepEqual(EXTERNAL_FIRST_PARTY_NATIVE_PROBATION_IDS, ["notes"]);
  assert.equal(hasNativeExternalFirstPartyProbation("notes"), true);
  assert.equal(hasNativeExternalFirstPartyProbation("calculator"), false);
  assert.equal(hasNativeExternalFirstPartyProbation("studio"), false);
  assert.equal(hasNativeExternalFirstPartyProbation("unknown"), false);
  assert.equal(hasNativeExternalFirstPartyModuleRead("clock"), false);
  assert.equal(hasNativeExternalFirstPartyModuleRead("unknown"), false);
  assert.equal(hasNativeExternalFirstPartyModuleRead("../notes"), false);
  assert.strictEqual(listExternalFirstPartyComponentIds(), EXTERNAL_FIRST_PARTY_COMPONENT_IDS);
  assert.equal(isExternalFirstPartyComponentId("notes"), true);
  assert.equal(isExternalFirstPartyComponentId("studio"), true);
  assert.equal(isExternalFirstPartyComponentId("../notes"), false);
  assert.equal(isExternalFirstPartyComponentId("unknown"), false);
});
