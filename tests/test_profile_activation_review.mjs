import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { assertMvpZeroComponentProfileReview } from "../system/surface/ui/profile-activation-review.mjs";

const digest = "a".repeat(64);
const safePreview = () => ({
  expectedRevision: 2,
  permissionDiffSha256: digest,
  permissionDiff: {
    schema: "ordax.profile-permission-diff/1",
    componentAdds: [],
    componentRemovals: [],
    authorityChanges: [],
    requiresExplicitReview: false,
  },
});

test("MVP Profile review accepts only a digest-bound zero-component diff", () => {
  assert.equal(assertMvpZeroComponentProfileReview(safePreview()), digest);
});

test("MVP Profile review fails closed for components, authority expansion and consent-needed previews", () => {
  for (const changes of [
    { componentAdds: [{ id: "knowledge.example" }] },
    { componentRemovals: [{ id: "knowledge.example" }] },
    { authorityChanges: [{ id: "privileged" }] },
    { requiresExplicitReview: true },
  ]) {
    const preview = safePreview();
    Object.assign(preview.permissionDiff, changes);
    assert.throws(() => assertMvpZeroComponentProfileReview(preview), /unsupported review/);
  }
});

test("MVP Profile review rejects forged or incomplete revisions and digests", () => {
  for (const changes of [
    { expectedRevision: -1 },
    { expectedRevision: 0.5 },
    { permissionDiffSha256: "invalid" },
    { permissionDiffSha256: "A".repeat(64) },
    { permissionDiff: null },
  ]) {
    assert.throws(
      () => assertMvpZeroComponentProfileReview({ ...safePreview(), ...changes }),
      /unsupported review/,
    );
  }
});


test("Account binds the Native confirmation to the preview revision", () => {
  const accountPath = new URL("../system/surface/ui/account-overview-controls.mjs", import.meta.url);
  const source = readFileSync(fileURLToPath(accountPath), "utf8");
  assert.match(source, /const preview = await profileActivationPort\.previewActivation\(intent\)/);
  assert.match(source, /const acceptedDigest = assertMvpZeroComponentProfileReview\(preview\)/);
  assert.match(source, /expectedRevision: preview\.expectedRevision/);
  assert.match(source, /acceptedPermissionDiffSha256: acceptedDigest/);
});
