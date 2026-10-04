# App Data service foundation

`ordax.app-data/1` is the app-facing boundary for private device-local state owned by independently delivered applications.

It is intentionally **not** Memory, File Space, Account Sync, credentials storage, or a generic filesystem escape hatch.

## Identity and isolation

A runtime creates a bound App Data port for exactly one `(publisherId, appId, device)` partition. App calls never supply a different `appId` or publisher on individual operations.

The runtime port is an operational capability: possession of the injected port permits bounded mutation of that one partition. A package, catalog entry, Store UI, manifest, model output, or SDK descriptor does not create that capability.

Production `publisherId` must be derived from the verified package/install owner. It is not accepted as a self-claim from the app request body.

## State model

The v1 model is a bounded key/value partition of opaque bytes with a partition-wide monotonic revision. Every mutation is compare-and-swap against that revision. Hard protocol ceilings are safety bounds, not subscription quotas; production quota policy remains an owner decision below those ceilings.

The Native owner persists one private file per hashed `(publisherId, appId, device)` identity under `/var/lib/ordax/app-data/v1`. Reads and list operations do not materialize missing partitions. Mutations use a per-partition lock, temp-file fsync, atomic replace and parent-directory fsync. Symlinks, permissive targets and corrupt state fail closed.

## Transport

`native_app_data_endpoint.py` defines the typed JSON boundary, but it deliberately accepts the app identity as a trusted host argument rather than from JSON. Request bodies contain only `action`, keys, bytes and revisions.

`system/adapters/native/app-data.mjs` is an async adapter for an opaque runtime-injected endpoint. It verifies that the store cannot be retargeted after binding and never serializes publisher/app identity into requests.

The actual `native_host_server.py` route and verified publisher-to-endpoint binding remain a separate next stage. Until they land, this is not a production-enabled app capability.

## Lifecycle

App payload lifecycle and user data lifecycle stay separate:

- install does not grant access to another publisher/app identity;
- update cannot destructively rewrite data in-place by default;
- uninstall preserves App Data unless the user separately requests data removal;
- reinstall can reuse preserved data only for the same trusted app identity and policy;
- app rollback does not silently rewind user data.

## Current status

Implemented and tested:

- in-memory reference store and bound public port;
- private atomic Native partition owner;
- typed endpoint helper with no request identity self-claims;
- async Native adapter using an opaque bound endpoint;
- crash/orphan, reboot, CAS, quota, corruption, symlink and isolation regressions.

Still deliberately disabled:

- route registration in `native_host_server.py`;
- binding opaque endpoint identity to verified install/publisher provenance;
- App SDK publication;
- Store integration;
- Notes migration/cutover.

Notes remains the first migration candidate because its current specialized Native/Web persistence demonstrates why the platform needs a generic App Data boundary instead of one core endpoint per app.
