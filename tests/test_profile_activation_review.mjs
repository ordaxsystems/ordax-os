import assert from "node:assert/strict";
import test from "node:test";

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
