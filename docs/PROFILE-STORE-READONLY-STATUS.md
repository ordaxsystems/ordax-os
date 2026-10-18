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

The Profile catalog Surface already shows these reference statuses using the existing
Store catalog provider. The selected Space Surface additionally resolves the Account
selection and its exact `profilePack` identity (`slug@version`) against the published
Profile catalog. It never chooses a different version or invents a binding from the
Space type. A missing/unpublished/mismatched Profile is shown as unavailable, not as
an empty installation inventory.

The selected Space panel uses the same `projectProfileStoreAppStatus` join and
shared status rows as the general Profile catalog. Store observations are scoped to
the current host/device **not** to a specific Space; Profile references do not
constitute a list of apps installed for that Space. The view provides only a
navigation action to the canonical Loja. Changes to Profile or Store follow their
independent versioning and authorization boundaries.

The Web Store provider presently has no supported transport and fails closed to
unavailable; consequently Web surfaces show unknown status unless a verified
provider is composed. The active Account selection is subject-bound and the
asynchronous Profile read is scoped to that subject and Space, aborted on changes
and not persisted by the Surface. No per-Space app activation, installer, Store
mutation or production rollout is introduced by this read model.
