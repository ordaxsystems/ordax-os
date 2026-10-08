// Consumer-side guard for the Stable/MVP zero-component Profile flow.
// The Native host remains authoritative for manifests, revisions and policy.
const SHA256_HEX = /^[0-9a-f]{64}$/;

export function assertMvpZeroComponentProfileReview(preview) {
  const diff = preview?.permissionDiff;
  if (
    !Number.isSafeInteger(preview?.expectedRevision)
    || preview.expectedRevision < 0
    || diff?.schema !== "ordax.profile-permission-diff/1"
    || diff.requiresExplicitReview !== false
    || !Array.isArray(diff.componentAdds) || diff.componentAdds.length !== 0
    || !Array.isArray(diff.componentRemovals) || diff.componentRemovals.length !== 0
    || !Array.isArray(diff.authorityChanges) || diff.authorityChanges.length !== 0
    || typeof preview.permissionDiffSha256 !== "string"
    || !SHA256_HEX.test(preview.permissionDiffSha256)
  ) {
    throw new Error("Profile activation preview requires unsupported review");
  }
  return preview.permissionDiffSha256;
}
