# User Cloud Storage

Status: MVP REQUIRED / RUNTIME ROLLOUT DISABLED

This service owns the OrdaX product semantics for user-selected cloud objects. Apps such as Files and ORDAX Studio consume this service; they do not own cloud credentials, buckets, quotas or authorization.

## Boundary

Canonical transactional state owns object identity, account/Space ownership, server revision, size, SHA-256, lifecycle state and quota admission. The object-storage provider owns bytes only.

```text
App
 -> OrdaX user-cloud-storage
 -> authenticated server reservation
 -> server-authoritative quota admission
 -> short-lived provider upload authorization
 -> upload to private object store
 -> size/digest finalization
 -> active transactional object metadata
```

A reservation or signed upload token has `actionAuthority: none`; it is not an OrdaX Action Gateway grant and cannot authorize unrelated mutations.

## MVP rules

- account remains optional for local OS use;
- only explicitly selected files may enter cloud storage;
- buckets are private; permanent public URLs are forbidden;
- provider object keys are opaque and never raw local paths;
- `service_role`, provider secret keys and provider bearer tokens never enter Surface JavaScript, Memory or public metadata;
- client-reported plan, quota or usage is never authoritative;
- server reserves growth before issuing upload authorization;
- finalization checks exact expected size and SHA-256;
- cross-account and cross-Space access defaults to deny;
- downgrade never silently deletes existing data;
- export/delete remain available while over quota;
- account close must revoke access and clean/tombstone associated cloud objects according to the account lifecycle contract.

## Provider adapters

The MVP adapter target is private Supabase Storage because the current account domain already uses the dedicated `ordax-control-plane` backend. This does not make Supabase part of the domain contract.

Cloudflare R2 or another object store may later replace or complement the blob layer when cost/egress measurements justify it. Such a change must not alter OrdaX object IDs, ownership, revisions, entitlements, quota semantics or client authorization.

## Rollout

No public bucket or runtime upload path is enabled by this source foundation. Deployment requires the gates in `docs/contracts/user-cloud-storage.json` and the aggregate MVP gate in `docs/contracts/mvp-account-cloud.json` to pass.
