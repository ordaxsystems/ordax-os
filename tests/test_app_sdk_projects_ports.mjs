import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
} from "../system/contracts/device-capabilities.mjs";
import {
  PROJECT_CLOUD_LINKS_SCHEMA,
} from "../system/contracts/project-cloud-links-data.mjs";
import {
  PROJECT_CLOUD_LINKS_READER_SCHEMA,
  assertProjectCloudLinksReaderPort,
} from "../system/contracts/project-cloud-links-reader.mjs";
import {
  createProjectCloudLinksReader,
} from "../system/services/projects/cloud-links-reader.mjs";

const rootUrl = new URL("../", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), "utf8"));
}

test("App SDK 1.14 preserves the read-only Projects host boundary without raw Device Agent execution", async () => {
  const bundle = await json("sdk/app-sdk-v1/bundle.json");
  assert.equal(bundle.bundle_version, "1.16.0");
  assert.equal(bundle.authority, "none");

  const byName = new Map(bundle.contracts.map((contract) => [contract.name, contract]));
  assert.equal(byName.get("project-catalog")?.schema, "ordax.project-catalog/1");
  assert.equal(byName.get("project-cloud-links-data")?.schema, PROJECT_CLOUD_LINKS_SCHEMA);
  assert.equal(byName.get("project-cloud-links-reader")?.schema, PROJECT_CLOUD_LINKS_READER_SCHEMA);
  assert.equal(
    bundle.contracts.some((contract) => contract.source_path === "system/contracts/project-cloud-links.mjs"),
    false,
  );
  assert.equal(byName.get("device-capability-reader")?.schema, DEVICE_AGENT_CAPABILITY_READER_SCHEMA);
  assert.equal(byName.get("device-capabilities")?.schema, DEVICE_AGENT_CAPABILITIES_SCHEMA);

  assert.equal(bundle.contracts.some((contract) => contract.schema === "ordax.device-agent/1"), false);
  assert.equal(
    bundle.contracts.some((contract) => contract.source_path === "system/contracts/device-agent.mjs"),
    false,
  );
});

test("Projects receives a narrowed cloud-links reader without link/unlink authority", () => {
  const snapshot = {
    schema: "ordax.project-cloud-links/1",
    persistence: "session",
    links: [],
  };
  const mutablePort = {
    schema: "ordax.project-cloud-links/1",
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    link: () => {},
    unlink: () => {},
    destroy: () => {},
  };

  const reader = createProjectCloudLinksReader(mutablePort);
  assert.equal(assertProjectCloudLinksReaderPort(reader), reader);
  assert.equal(reader.schema, PROJECT_CLOUD_LINKS_READER_SCHEMA);
  assert.equal("link" in reader, false);
  assert.equal("unlink" in reader, false);
  assert.equal("destroy" in reader, false);
  assert.equal("execute" in reader, false);
});
