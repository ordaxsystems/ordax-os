import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { APP_DATA_SCHEMA } from "../system/contracts/app-data.mjs";

const rootUrl = new URL("../", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), "utf8"));
}

test("current App SDK preserves App Data contract metadata without transport authority", async () => {
  const bundle = await json("sdk/app-sdk-v1/bundle.json");
  const version = bundle.bundle_version.split(".").map((part) => Number.parseInt(part, 10));
  assert.equal(version.length, 3);
  assert.ok(
    version[0] > 1 || (version[0] === 1 && (version[1] > 6 || (version[1] === 6 && version[2] >= 0))),
    "current App SDK must not predate App Data publication in 1.6.0",
  );
  assert.equal(bundle.authority, "none");

  const appData = bundle.contracts.find((contract) => contract.name === "app-data");
  assert.ok(appData, "App SDK must publish the App Data contract");
  assert.equal(appData.schema, APP_DATA_SCHEMA);
  assert.equal(appData.major, 1);
  assert.equal(appData.source_path, "system/contracts/app-data.mjs");

  const serialized = JSON.stringify(bundle);
  for (const forbidden of [
    "/__ordax/native/app-data/",
    "native-app-data-port-bootstrap",
    "verified-app-install-identity",
    "receiptSha256",
    "bindingToken",
    "service_role",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `SDK leaked private App Data detail: ${forbidden}`);
  }
});
