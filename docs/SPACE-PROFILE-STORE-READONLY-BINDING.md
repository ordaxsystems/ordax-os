# Space ↔ Profile Pack ↔ Store: read-only binding

The canonical Space contract already carries `profilePack` identifiers such as `pizzaria-br@1`. The same shape is used by the Space type catalog (`creation_default_profile` carries the slug/version separately). **Do not introduce a redundant Profile version field on Space.**

`system/services/spaces/profile-store-status.mjs` composes the existing canonical Store projector `projectProfileStoreAppStatus` and the validated published Profile Pack catalog:

- No selected Space: `no-space`; no linked Profile: `no-profile`.
- A legacy/unpinned bare slug: `profile-unpinned`. A single published version is not sufficient evidence to bind it.
- An invalid `slug@version` or unsafe integer: `profile-invalid-binding`.
- An exact pinned published version absent from the catalog: `profile-not-listed` (no silent fallback).
- A Profile of the wrong Space kind: `profile-kind-mismatch`.
- A valid exact match: project the Profile's canonical app IDs against the **Store's own** verified snapshot.
- An unavailable Store catalog: `store-unavailable` with unknown statuses, never fake installation, absence, permission, or entitlement.
- Invalid or duplicate published Profile entries fail closed through `validateProfilePackCatalogList`.

The projector is pure and read-only. It creates no independent package catalog, install/update/rollback capability, new version field, persistence, or authorization route.

## Surface Meridian Web consumption

The selected account Space is read exclusively from `useWebAccount().authorized.activeSpace`; a signed-out, revoked, offline or unselected session renders no Space app rows. The `SpacesExperience` account view includes `SpaceProfileAppsPanel` between the real Space selection and members sections; fictional examples remain separate.

The component reads the published, validated Profile catalog using `useProfileCatalogReader()`, reads the Store through `useStoreCatalog()`, and passes both into `projectSpaceProfileStoreStatus`. It creates **no** new Store, installer, app entitlement, persisted cache or independent Profile version. Each selected Space receives a keyed presentation scope, and the Profile read is aborted on unmount/switch. A failed catalog is shown as an explicit error with retry rather than an empty success.

This Web composition currently supplies an unavailable Store transport; the UI must therefore label app states **unknown** instead of claiming installation until an authorized verified Store snapshot is actually composed. Referenced app IDs remain visible after an exact published Profile binding has been verified. There are no install/update/launch actions in this projection.

The same shared status labels are consumed by the Profile catalog and active Space view. Native app capability composition remains outside this Web-only change.

Tests: `node --test tests/test_web_space_profile_apps.mjs tests/test_web_meridian_spaces.mjs tests/test_space_profile_store_status.mjs tests/test_profile_store_app_status.mjs`.

## CI baseline findings (2026-10-18)

Foundation Contract and Surface Web Candidate failed on the branch for First Run tests unrelated to the added projector. The touched First Run source and smoke-test files have identical blob SHAs in `main` and this PR. Keep fixes to First Run in their owning code/PR, not in this projection, and do not bypass the CI gates.

Resolution: PR #1972 corrected the First Run Chromium origin and strengthened its contract/layout assertions; it was merged to main before this PR's CI was revalidated.
