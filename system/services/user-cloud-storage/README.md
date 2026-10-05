# User Cloud Storage

Status: MVP REQUIRED / RUNTIME ROLLOUT DISABLED

This service owns OrdaX semantics for user-selected cloud objects. Apps such as Files and Studio do not own cloud credentials, provider buckets, quota policy or authorization.

## Boundary

Canonical transactional state owns stable object identity, account/Space ownership, revision, size, digest, lifecycle state and quota admission. The object-storage provider owns bytes only.

```text
App
 -> OrdaX user-cloud-storage
 -> authenticated server reservation
 -> canonical server quota decision (`storage.user.bytes`)
 -> short-lived provider upload authorization
 -> private object store
 -> exact size/digest finalization
 -> active transactional metadata
```

A reservation or provider upload authorization has `actionAuthority: none`; it is not an Action Gateway grant.

## MVP rules

- account remains optional for local OS use;
- only explicitly selected files may enter cloud storage;
- buckets remain private; permanent public URLs are forbidden;
- provider keys are opaque and never raw local paths;
- provider/service secrets never enter Surface JavaScript or public metadata;
- client-reported plan, quota or usage is never authoritative;
- quota decision semantics are owned by `system/services/entitlements` and validated by `validateServiceQuotaDecision()`;
- server reserves exact byte growth before upload authorization;
- finalization checks exact expected size and SHA-256;
- cross-account and cross-Space access defaults to deny;
- downgrade never silently deletes existing data;
- export/delete remain available while over quota.

## Database boundary

The historical source migration predates the sealed `private` schema. The reconverged migration must not restore `authenticated` or `service_role` access to `private`, and public RLS must use `ordax_policy` predicates rather than private implementation helpers.

The source foundation remains non-activating until an audited storage executor/server mutation boundary and atomic quota meter exist. Creating tables does not enable upload or public rollout.

## Providers

Supabase Storage remains the MVP adapter target because the current account domain uses the dedicated OrdaX transactional backend. Provider choice is not part of the domain contract. R2 or another object store may later replace or complement the byte layer without changing OrdaX object IDs, ownership, revisions, entitlement or quota semantics.

## Separate lifecycle gate

Account-close cleanup, auth fencing and provider deletion are a separate MVP gate. This service must integrate with that lifecycle before public rollout, but it does not claim those mechanisms are implemented merely because the storage source foundation exists.
