import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { getSystemComponent } from "../system/apps/component-catalog.mjs";
import { EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT, isNativeExternalFirstPartyCurrentSlotBlockedByBundledOwner } from "../system/services/apps/external-first-party-policy.mjs";
test("Files has only the external product source, not a duplicate built-in owner",()=>{
  assert.equal(getSystemComponent("files"),null);
  assert.equal(existsSync(new URL("../system/apps/files",import.meta.url)),false);
  assert.equal(EXTERNAL_FIRST_PARTY_SOURCE_REPOSITORY_BY_COMPONENT.files,"ordaxsystems/ordax-apps");
  assert.equal(isNativeExternalFirstPartyCurrentSlotBlockedByBundledOwner("files"),false);
});
