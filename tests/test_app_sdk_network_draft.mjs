import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { NETWORK_DRAFT_SCHEMA, assertNetworkDraftPort, validateNetworkDraftSnapshot } from "../system/contracts/network-draft.mjs";

const bundle = JSON.parse(readFileSync(new URL("../sdk/app-sdk-v1/bundle.json", import.meta.url), "utf8"));
const source = readFileSync(new URL("../system/contracts/network-draft.mjs", import.meta.url));
const gitBlob = createHash("sha1").update(Buffer.from("blob " + source.length + String.fromCharCode(0))).update(source).digest("hex");

test("Network Draft public SDK 1.17 preserves canonical source and schema", () => {
  const specs = bundle.contracts.filter(entry => entry.schema === NETWORK_DRAFT_SCHEMA);
  assert.equal(bundle.bundle_version, "1.18.0");
  assert.equal(specs.length, 1);
  assert.equal(specs[0].name, "network-draft");
  assert.equal(specs[0].source_path, "system/contracts/network-draft.mjs");
  assert.equal(specs[0].source_git_blob, gitBlob);
  const text = source.toString("utf8");
  for (const forbidden of ["system/services", "adapters/native", "localStorage", "fetch("]) {
    assert.equal(text.includes(forbidden), false);
  }
});

test("Network Draft remains a typed port, not a grant or sender bypass", () => {
  const signedOut = Object.freeze({schema: NETWORK_DRAFT_SCHEMA, state: "signed-out", subjectId: null, currentSpace: null, draft: null});
  assert.equal(validateNetworkDraftSnapshot(signedOut).state, "signed-out");
  const methods = ["getSnapshot","subscribe","begin","setBody","retargetToCurrentSpace","bindSend","clear"];
  const port = Object.fromEntries(methods.map(method => [method, () => null]));
  port.schema = NETWORK_DRAFT_SCHEMA;
  port.getSnapshot = () => signedOut;
  assert.equal(assertNetworkDraftPort(port), port);
  assert.throws(() => assertNetworkDraftPort({...port, bindSend: undefined}), /bindSend/);
  assert.throws(() => validateNetworkDraftSnapshot({...signedOut, state: "drafting"}), /requires subject identity/);
  assert.throws(() => validateNetworkDraftSnapshot({...signedOut, state: "ready", subjectId: "account-1", currentSpace: null}), /requires Space/);
});
