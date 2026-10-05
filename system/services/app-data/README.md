# App Data service foundation

`ordax.app-data/1` is the app-facing boundary for private device-local state owned by independently delivered applications.

It is intentionally **not** Memory, File Space, Account Sync, credentials storage, or a generic filesystem escape hatch.

## Identity and isolation

A runtime creates a bound App Data port for exactly one `(publisherId, appId, device)` partition. App calls never supply a different `appId` or publisher on individual operations.

The runtime port is an operational capability: possession of the injected port permits bounded mutation of that one partition. A package, catalog entry, Store UI, manifest, model output, or SDK descriptor does not create that capability.

Production `publisherId` must be derived from the verified package/install owner. It is not accepted as a self-claim from the app request body.

## State model

The v1 app-facing model is a bounded key/value partition of opaque bytes with a partition-wide monotonic revision. Every mutation is compare-and-swap against that revision. Hard protocol ceilings are safety bounds, not subscription quotas; production quota policy remains an owner decision below those ceilings.

The Native owner does **not** rewrite a whole app snapshot for each change. Each hashed app partition contains a small authoritative manifest plus immutable SHA-256 content-addressed blobs. A mutation writes and verifies the new blob first and commits only by atomically replacing the manifest. Unreferenced blobs or temp files left by an interrupted write are never authoritative and are collected on a later successful mutation.

Reads and list operations do not materialize missing partitions. Mutations use a per-partition lock, fsync, atomic manifest replacement and directory fsync. Symlinks, permissive targets, corrupt manifests and blob digest mismatches fail closed.

## Transport

`native_app_data_endpoint.py` defines the typed JSON boundary, but it deliberately accepts the app identity as a trusted host argument rather than from JSON. Request bodies contain only `action`, keys, bytes and revisions.

`system/adapters/native/app-data.mjs` is an async adapter for an opaque runtime-injected endpoint. It verifies that the store cannot be retargeted after binding and never serializes publisher/app identity into requests.

The Native route is now wired by `native_app_data_host.py`. Verified current-boot install identities are bound to opaque capabilities by trusted composition, and apps receive only the typed `ordax.app-data/1` port. The opaque endpoint is not exposed in app context.

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
- private atomic Native manifest/blob owner;
- typed endpoint helper with no request identity self-claims;
- async Native adapter using an opaque bound endpoint inside trusted composition;
- verified install/publisher binding and one-shot current-boot port injection;
- active Native host route for the trusted first-party composition;
- App SDK 1.6.0 publication of `ordax.app-data/1` without transport authority;
- crash/orphan, reboot, CAS, quota, corruption, symlink, content-integrity and isolation regressions;
- single-key updates do not rewrite unrelated values.

Still deliberately incomplete:

- independent install/update/rollback/reinstall lifecycle proof for external app packages;
- third-party realm/origin isolation and enablement;
- Store integration;
- Notes migration/cutover.

Notes remains the first migration candidate because its current specialized Native/Web persistence demonstrates why the platform needs a generic App Data boundary instead of one core endpoint per app.
