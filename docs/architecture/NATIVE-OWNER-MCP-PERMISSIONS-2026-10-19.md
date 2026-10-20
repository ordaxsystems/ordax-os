# MCP Owner permissions in Native USB — source of truth

The OrdaX OS Settings > Segurança > Acesso remoto view consumes the existing
Product-device enrollment and **Platform PostgreSQL Owner grant authority**.
It does not mint grants in the USB image, mirror the Windows desktop agent or
invent a second MCP server.

## Flow

1. Existing Native Account login authenticates the Owner. Existing
   ProductDevicePostLoginCoordinator enrolls the USB Owner/Dev device against
   `/v3/device/setup`; credentials remain in private Native state.
2. Connecting OrdaX MCP in ChatGPT requires OAuth of the **same** OrdaX Account.
   Account login alone does **not** give external clients access to every device.
3. Settings reads `GET /v3/owner/remote-authority?device_id=...` through a
   Native-only proxy. UI gets only client names/IDs and group summaries.
4. A deliberate "Autorizar controle integral" action uses
   `POST /v3/owner/remote-grant-groups` for the consented client and enrolled
   device. The explicit "Revoke all MCP access" action revokes every active group belonging
   to this client and device using
   `DELETE /v3/owner/remote-grant-groups/{group_id}?client_id=...`.
   Every request remains subject to canonical owner, device and OAuth checks.
5. A grant never removes the Runtime's own local controls or makes unsupported
   computer actions executable. Once allowed, there is no **per-action prompt**.
   System settings and audit remain authoritative.

## Scope / current limitations

- Enabled in **Owner/Development USB** Native account runtime only. Existing
  Stable/MVP enrollment policy intentionally remains inactive until the signed
  Native executor and build-specific security gates are proven.
- The discovery toggle is separate from an action grant.
- The "Authorize full control" action creates only the canonical
  `full-computer-control` profile for a consented client.
  "Revoke all MCP access" deletes **every active MCP grant group** for that
  client and enrolled device (including project-scoped groups). It then
  re-reads the PostgreSQL authority and fails closed if any group remains.
  This is deliberately different from disabling mere discoverability.
- Missing account, invalid device credential, unreachable Platform or rejected
  grant fails closed; never show a synthetic success.
- Browser receives no access token or device credential. Native Host enforces
  loopback, canonical Host/provenance and explicit Origin for mutations.
- The transport is not a substitute for building the native Linux computer
  action executor and verifying actual remote execution on the USB.

## Tests

```
python -m unittest tests.test_owner_remote_permissions_native tests.test_owner_remote_permission_authority
node --test tests/test_owner_remote_permissions_adapter.mjs
```

## Revocation proof matrix

- One client with `full-computer-control`, `computer-observe` and a
  project-scoped grant: a single explicit revoke-all request removes **all
  three** groups through the canonical Owner PostgreSQL authority.
- A stale 200 response that does not change grants is rejected on the
  postcondition read; the UI never claims success from HTTP alone.
- More than 300 groups / 100 clients are rejected rather than truncated,
  preventing an apparently empty panel from hiding active access.
- An unavailable Native confirmation dialog fails closed for both grant and
  revoke-all, rather than skipping user intent confirmation.
