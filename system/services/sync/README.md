# Account sync service

The canonical account sync runtime owns reconciliation for portable account state. Data-class adapters project domain objects into the versioned sync protocol; they do not create independent sync loops, cursors or provider semantics.

## Account-owned Intelligence Memory foundation

`account-memory-runtime.mjs` is a source-only foundation for carrying eligible `ordax.memory/1` objects through the existing `ordax.sync-transport/1` protocol. It is deliberately **not promoted or wired into Web/Native composition**. The current gateway still does not advertise generic `memory`, and no public Memory sync capability is claimed.

Memory cloud semantics are additionally constrained by `docs/contracts/cloud-memory-sync-boundary.json`. The local Memory domain/storage remains the semantic source of truth; sync objects are transport mirrors only and cannot redefine Memory ownership, scope, provenance, sensitivity, retention or authority.

The v1 boundary is intentionally narrower than the Memory store:

- `ownerKind=device` never enters account sync;
- only account-owned `account` and `space` scopes are eligible;
- `project`, `device` and `session` scopes remain local;
- `restricted` sensitivity remains local/fail-closed;
- stable sync identity is exactly the canonical `memory_id`; the existing `(account, data_class, stable_object_id)` transport namespace means no encoded second Memory identity is created;
- the payload embeds a validated `ordax.memory/1` item under `ordax.memory-sync-payload/1`;
- unknown provider transport metadata cannot redefine Memory semantics or authority; provider-envelope owner/scope/sensitivity/retention/training/telemetry/tool/action fields are rejected;
- delete/forget uses an identity-only tombstone and does not carry deleted Memory content;
- server revisions are conflict authority; client wall clocks are not;
- transport failure leaves local Memory intact and keeps the pending mutation for retry.

The Memory handler does **not** own `snapshot()`, `pullChanges()`, the account cursor or transport lifecycle. `system/services/sync/account-runtime.mjs` remains the sole account reconciliation orchestrator, so Memory cannot become a second synchronization loop.

Memory sync coordination uses the existing `ordax.sync-state-store/1` boundary and a subject-bound `ordax.memory-sync-state/1` envelope. It persists only revisions, pending validated mutations and conflict quarantine needed for safe retry. Pending idempotency identity survives durable runtime recreation; accepted revisions remain the next mutation base; tombstones survive without deleted content; and invalid/corrupt persisted coordination blocks replay instead of silently resetting to revision zero.

The shared state registry (`state-store-registry.mjs`) multiplexes logical sync namespaces over the existing bounded physical store. Account-specific Memory coordination uses bounded subject partitions, so one account cannot overwrite another account's queue while Appearance and other sync coordination continue sharing the canonical store.

`account-memory-session-runtime.mjs` binds the Memory runtime to live identity. Signed-out identity has no account Memory sync runtime; account switch creates/reuses the new subject partition instead of mutating one runtime to impersonate another account; switching back recovers that account's durable coordination.

### Conflict boundary

Memory does not use the automatic rebase policy used by Appearance/preferences/workspace metadata. A concurrent/divergent Memory object is quarantined and blocks canonical account cursor advancement until the domain conflict is explicitly resolved.

`memory-conflict-resolution.mjs` defines the source-only `ordax.memory-conflict-resolution/1` primitive with exactly two explicit decisions:

- `preserve-local-intent` creates a new validated mutation based on the authoritative server revision with a new idempotency key;
- `accept-authoritative-remote` discards the pending local intent but does not apply provider state directly; the runtime persists `reconciliation-required` until canonical remote state is actually reapplied.

Both decisions are manual, `automatic=false`, and neither introduces global last-write-wins.

The canonical account runtime also treats unresolved Memory coordination as a cursor barrier. A Memory-less follow-up batch cannot advance the account cursor while `conflictCount > 0`; after `accept-authoritative-remote`, the authoritative remote object must actually be consumed and flushed through the Memory domain before cursor advancement resumes.

### Restore foundation

`account-restore-plan.mjs` defines `ordax.account-restore-plan/1` for ordering a future reinstall/account restore without claiming that reinstall restore is implemented. Portable state comes before eligible Memory, derived indexes/caches are rebuilt locally, and health verification comes last.

Memory restore is fail-closed on coordination recovery, pending local intent, unresolved conflict or `reconciliation-required`. A healthy coordination snapshot alone is not authorization: when Memory objects are present the planner requires an explicit `authorizeMemoryRestore()` decision supplied by trusted composition, and only the literal result `true` marks the Memory phase ready. The planner does not issue, infer or trust a client-claimed cloud entitlement and continues to report `grantsAuthority=false`. Never-sync classes abort planning; unpromoted metadata classes remain explicitly deferred rather than guessed.

### Backend enforcement foundation

The canonical backend now has the dedicated server-authoritative atomic Memory mutation `public.ordax_apply_memory_mutation_v1`. It writes `public.ordax_memory_items` and its private sync mirror in one database transaction, remains entitlement-gated, and public rollout is still disabled. The generic account mutation RPC deliberately does **not** accept `memory`.

`20260929193000_cloud_memory_privacy_hardening_v1.sql` is a later source-prepared migration for two privacy invariants that must hold before promotion: known never-sync secret material aborts the atomic write, and a Memory forget scrubs replayable historical mutation payloads while preserving revisions/change cursors. This hardening migration is not claimed as deployed by this branch.

Live client wiring is also blocked on a real identity-allocation contract. The deployed atomic backend assigns a UUID `memory_id` for a new cloud Memory object, while the local offline-first runtime does not yet have a canonical way to adopt/remap that server identity. The foundation must not invent a parallel identifier or silently rewrite Memory identity to bridge this gap.

Every upload/restore operation still requires explicit authorization supplied by trusted composition. Synchronized Memory is **user cloud state**; synchronization does not imply AI-training authorization, telemetry authorization, community-data authorization, model egress, tools or actions.

This remains a foundation. Live Web/Native Memory wiring, the identity-allocation boundary, canonical full-resync after accept-remote when required, final user-facing conflict review, two-client proof and reinstall proof are still required before promotion.

Core rules remain:

- one OrdaX identity spans Web, Mobile, Desktop, USB and native-disk modes;
- shared data classes have stable IDs and versioned object schemas;
- platform adapters provide secure storage, background execution and transport integration, but do not redefine conflict or entitlement policy;
- mutations are idempotent so reconnect/retry does not duplicate state;
- incremental cursors are opaque implementation details and clients must tolerate a safe full resync;
- server revisions, not client wall clocks, are the conflict authority;
- deletion is explicit state (tombstone), not an ambiguous absence;
- there is no universal last-writer-wins rule; conflict resolution is deterministic and versioned per data class/content type;
- device-private material, machine-local privileged state and other never-sync classes cannot become syncable through a paid plan;
- changing database/provider must not require changing the client-facing domain model.
