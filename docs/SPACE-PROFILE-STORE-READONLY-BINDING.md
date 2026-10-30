# Space ↔ Profile Pack ↔ Store: read-only binding

The canonical Space contract already carries `profilePack` identifiers such as `pizzaria-br@1`. The same shape is used by the Space type catalog (`creation_default_profile` carries the slug/version separately). **Do not introduce a redundant Profile version field on Space.**

`system/services/spaces/profile-store-status.mjs` composes the existing canonical Store projector `projectProfileStoreAppStatus` and the validated published Profile Pack catalog:

- No selected Space: `no-space`; no linked Profile: `no-profile`.
- Archived Space: `space-inactive`; no Profile or device Store observations are exposed.
- A legacy/unpinned bare slug: `profile-unpinned`. A single published version is not sufficient evidence to bind it.
- An invalid `slug@version` or unsafe integer: `profile-invalid-binding`.
- An exact pinned published version absent from the catalog: `profile-not-listed` (no silent fallback).
- A Profile of the wrong Space kind: `profile-kind-mismatch`.
- A valid exact match: project the Profile's canonical app IDs against the **Store's own** verified snapshot.
- An unavailable Store catalog: `store-unavailable` with unknown statuses, never fake installation, absence, permission, or entitlement.
- Invalid or duplicate published Profile entries fail closed through `validateProfilePackCatalogList`.

The projector is pure and read-only. It creates no independent package catalog, install/update/rollback capability, new version field, persistence, or authorization route.

## Integration gate

This stage adds a version-safe domain projection and tests. It does **not** yet wire a live Space-scoped app list into Web/Native. The Surface must consume both the **authorized active Space** and the **published validated Profile catalog**, and use the canonical Store snapshot. For unpinned legacy spaces, offer a truthful unresolved state until the account/Space assignment authority supplies an exact `slug@version`; do not invent one in the client.

Tests: `node --test tests/test_space_profile_store_status.mjs tests/test_profile_store_app_status.mjs`.

## CI baseline findings (2026-10-18)

Foundation Contract and Surface Web Candidate failed on the branch for First Run tests unrelated to the added projector. The touched First Run source and smoke-test files have identical blob SHAs in `main` and this PR. Keep fixes to First Run in their owning code/PR, not in this projection, and do not bypass the CI gates.

Resolution: PR #1972 corrected the First Run Chromium origin and strengthened its contract/layout assertions; it was merged to main before this PR's CI was revalidated.
