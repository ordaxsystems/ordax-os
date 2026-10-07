import assert from "node:assert/strict";
import test from "node:test";
import { validateFileAssociationManifest } from "../system/contracts/file-association-manifest.mjs";

const manifest = {
  schema: "ordax.file-association-manifest/1",
  appId: "pdf-viewer",
  appVersion: "0.1.0",
  authority: "none",
  role: "viewer",
  extensions: ["pdf"],
};

test("file association manifest validates canonical owner metadata", () => {
  const value = validateFileAssociationManifest(manifest, {
    appId: "pdf-viewer",
    appVersion: "0.1.0",
  });
  assert.equal(value.appId, "pdf-viewer");
  assert.deepEqual(value.extensions, ["pdf"]);
});

test("file association manifest rejects authority and identity drift", () => {
  assert.throws(
    () => validateFileAssociationManifest({ ...manifest, authority: "host" }),
    /must not carry authority/,
  );
  assert.throws(
    () => validateFileAssociationManifest(manifest, { appId: "image-viewer" }),
    /identity drifted/,
  );
});

test("file association manifest requires sorted unique extensions", () => {
  assert.throws(
    () => validateFileAssociationManifest({ ...manifest, extensions: ["png", "jpg"] }),
    /must be sorted/,
  );
  assert.throws(
    () => validateFileAssociationManifest({ ...manifest, extensions: ["pdf", "pdf"] }),
    /must be unique/,
  );
});
