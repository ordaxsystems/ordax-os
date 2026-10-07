import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXTERNAL_FIRST_PARTY_COMPONENT_IDS,
  EXTERNAL_FIRST_PARTY_OWNER,
  isExternalFirstPartyComponentId,
  listExternalFirstPartyComponentIds,
} from "../system/services/apps/external-first-party-policy.mjs";

test("external first-party runtime policy has one JS owner locked to component package policy", async () => {
  const policy = JSON.parse(
    await readFile(
      new URL("../docs/contracts/runtime-component-package.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(EXTERNAL_FIRST_PARTY_OWNER, "washingtonmsdj/ordax-apps");
  assert.deepEqual(
    [...EXTERNAL_FIRST_PARTY_COMPONENT_IDS].sort(),
    Object.keys(policy.canonical_external_source_repository_by_component).sort(),
  );
  for (const appId of EXTERNAL_FIRST_PARTY_COMPONENT_IDS) {
    assert.equal(
      policy.canonical_external_source_repository_by_component[appId],
      EXTERNAL_FIRST_PARTY_OWNER,
    );
  }
  assert.strictEqual(listExternalFirstPartyComponentIds(), EXTERNAL_FIRST_PARTY_COMPONENT_IDS);
  assert.equal(isExternalFirstPartyComponentId("notes"), true);
  assert.equal(isExternalFirstPartyComponentId("../notes"), false);
});
