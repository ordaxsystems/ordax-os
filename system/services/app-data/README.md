# App Data service foundation

`ordax.app-data/1` is the app-facing boundary for private device-local state owned by independently delivered applications.

It is intentionally **not** Memory, File Space, Account Sync, credentials storage, or a generic filesystem escape hatch.

## Identity and isolation

A runtime creates a bound App Data port for exactly one `(publisherId, appId, device)` partition. App calls never supply a different `appId` or publisher on individual operations.

The runtime port is an operational capability: possession of the injected port permits bounded mutation of that one partition. A package, catalog entry, Store UI, manifest, model output, or SDK descriptor does not create that capability.

## State model

The v1 reference model is a bounded key/value partition of opaque bytes with a partition-wide monotonic revision. Every mutation is compare-and-swap against that revision. This favors simple crash-safe Native implementations and makes stale writers fail closed.

Hard protocol ceilings are safety bounds, not subscription quotas. Production quota policy remains an owner decision below those ceilings.

## Lifecycle

App payload lifecycle and user data lifecycle stay separate:

- install does not grant access to another publisher/app identity;
- update cannot destructively rewrite data in-place by default;
- uninstall preserves App Data unless the user separately requests data removal;
- reinstall can reuse preserved data only for the same trusted app identity and policy;
- app rollback does not silently rewind user data.

## Current status

This directory currently contains only an in-memory reference store and bound-port proof. There is no Native owner, route, App SDK publication, Store integration, or Notes migration yet.

Notes is the first migration candidate because its current specialized Native/Web persistence demonstrates why the platform needs a generic App Data boundary instead of one core endpoint per app.
