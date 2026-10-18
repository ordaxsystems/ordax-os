# Space ↔ Profile Pack ↔ Store: read-only binding

The Space snapshot contains a `profilePack` reference, not a pinned published Profile version. This boundary does **not** treat a reference as installation, launch permission, or app entitlement.

`system/services/spaces/profile-store-status.mjs` composes the already canonical `projectProfileStoreAppStatus` projector:
- No selected Space: `no-space`; no linked Profile: `no-profile`.
- No published matching slug: `profile-not-listed`.
- More than one published version for the slug: `profile-ambiguous`, **never choose latest implicitly**.
- Exactly one matching published version: derive its app references against the validated Store snapshot.
- Unavailable Store catalog: `store-unavailable` with unknown app states, never fake absence or installation.

The projector is pure, bounded by the validated Space/Profile/Store contracts, does not mutate Space state, and creates no catalog, installation authority, permissions, or persistence.

## Integration gate

This initial stage implements the safe domain projection and tests; it does **not** yet wire an authorized version-pinned Profile selection into the Web Surface. Before exposing an actual Space-scoped app list, the Space-to-Profile assignment must publish an unambiguous, versioned identity (or use an explicit authorized resolution port). Do not silently pair a slug with a latest Profile Pack version.

Tests: `node --test tests/test_space_profile_store_status.mjs tests/test_profile_store_app_status.mjs`.
