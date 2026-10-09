import test from "node:test";
import assert from "node:assert/strict";

import {
  validateListingForRequest,
  validateTextForRequest,
} from "../system/surface/ui/file-space-response-identity.mjs";

test("listing identity must match requested logical folder before UI use", () => {
  const payload = { path: "/Documentos", entries: [{ name: "a.txt", kind: "file", size: 2, modifiedAt: 10 }] };
  const listing = validateListingForRequest(payload, "/Documentos");
  assert.equal(listing.path, "/Documentos");
  assert.equal(listing.entries[0].name, "a.txt");
  assert.throws(() => validateListingForRequest(payload, "/Downloads"), /response identity/);
  assert.throws(() => validateListingForRequest(payload, "/Documentos/../Downloads"), /invalid segment/);
});

test("root listing and bounded empty directory remain valid", () => {
  assert.deepEqual(validateListingForRequest({ path: "/", entries: [] }, "/").entries, []);
  assert.throws(() => validateListingForRequest({ path: "/Fotos", entries: "not-list" }, "/Fotos"), /listing is invalid/);
});

test("text response must identify exactly the requested file", () => {
  const file = { path: "/Documentos/nota.txt", size: 3, text: "abc" };
  assert.equal(validateTextForRequest(file, file.path).text, "abc");
  assert.throws(() => validateTextForRequest(file, "/Documentos/outro.txt"), /response identity/);
  assert.throws(() => validateTextForRequest({ ...file, text: "\u0000" }, file.path), /valid text/);
  assert.throws(() => validateTextForRequest(file, "C:\\temp\\nota.txt"), /absolute logical path/);
});
