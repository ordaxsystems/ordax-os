import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXTERNAL_FIRST_PARTY_OWNER,
} from "../system/services/apps/external-first-party-policy.mjs";

test("Native Application Action provider composition consumes verified owner SSOT", async () => {
  const source = await readFile(
    new URL("../system/composition/native/main.mjs", import.meta.url),
    "utf8",
  );

  assert.equal(EXTERNAL_FIRST_PARTY_OWNER, "ordaxsystems/ordax-apps");
  assert.match(
    source,
    /expectedApplicationActionProviderOwner:\s*EXTERNAL_FIRST_PARTY_OWNER/,
  );
  assert.equal(
    source.includes('expectedApplicationActionProviderOwner: "ordaxsystems/ordax-apps"'),
    false,
  );
});
