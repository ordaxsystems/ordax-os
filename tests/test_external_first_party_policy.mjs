import assert from "node:assert/strict";
import test from "node:test";

import {
  EXTERNAL_FIRST_PARTY_COMPONENT_IDS,
  EXTERNAL_FIRST_PARTY_OWNER,
  EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT,
  isExternalFirstPartyComponentId,
  listExternalFirstPartyComponentIds,
} from "../system/services/apps/external-first-party-policy.mjs";

test("generated external first-party runtime policy exposes one canonical owner mapping", () => {
  assert.equal(EXTERNAL_FIRST_PARTY_OWNER, "ordaxsystems/ordax-apps");
  assert.deepEqual(
    EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT,
    {
      notes: EXTERNAL_FIRST_PARTY_OWNER,
      studio: EXTERNAL_FIRST_PARTY_OWNER,
    },
  );
  assert.deepEqual([...EXTERNAL_FIRST_PARTY_COMPONENT_IDS], ["notes", "studio"]);
  assert.strictEqual(listExternalFirstPartyComponentIds(), EXTERNAL_FIRST_PARTY_COMPONENT_IDS);
  assert.equal(isExternalFirstPartyComponentId("notes"), true);
  assert.equal(isExternalFirstPartyComponentId("studio"), true);
  assert.equal(isExternalFirstPartyComponentId("../notes"), false);
  assert.equal(isExternalFirstPartyComponentId("unknown"), false);
});
