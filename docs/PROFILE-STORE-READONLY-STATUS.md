# Profile → Store app status (read-only)

The Profile Pack contains app IDs only. The canonical Store/runtime remains
the sole owner of verified catalog status, installation, updates and rollback.
The pure `projectProfileStoreAppStatus` projection combines
`apps[]` with the existing `ordax.app-store-catalog/2` snapshot.

- **No installation or entitlement authority:** this module exposes no action,
  mutable app receipt, permission, version selection or lifecycle request.
- **Unavailable Store:** every referenced app is **unknown**, never presumed
  missing, installed or safe to install.
- **Ready Store:** a missing catalog entry is **not-listed**; it is not proof of
  uninstallation. Installed/versioned status comes only from validated Store data.
- **Blocked and in-progress:** displayed as observations, not a request approval.
- **No Space data writes:** the profile, Space identity, business data and installed
  packages are not modified.
- **Independent versions:** updating Profile composition does not update apps;
  updating an app does not update the Space core.

This is an isolated read-model foundation, not a completed Surface integration,
installer or production deployment. Surface integration must consume the existing
Store catalog port and react to its invalidation/subscription without caching
authority or creating a second Store catalog.
