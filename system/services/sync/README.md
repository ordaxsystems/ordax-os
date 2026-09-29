# Shared Sync Service Boundary

`system/services/sync/` is the canonical owner for cross-device synchronization semantics. It is provider-neutral: database choice, hosting provider, transport plumbing and platform lifecycle integration stay outside the domain contract.

The machine-readable authority is `docs/contracts/sync-model.json`.

## Implemented protocol core and Web account transport

`runtime.mjs` now implements the first provider-independent slice for the `appearance` data class:

- versioned `appearance/theme` sync objects with mandatory server revisions;
- explicit tombstones rather than ambiguous absence;
- deterministic conflict resolution where the greater server revision wins;
- fail-closed handling when the same server revision contains divergent state;
- versioned appearance mutations with caller-supplied idempotency keys;
- an in-memory offline mutation queue that deduplicates retries and rejects reuse of one idempotency key for different mutations.

The local protocol remains provider-neutral. The dedicated account backend is now applied separately, and both Web and Native/USB source compositions use the OrdaX-owned `ordax.sync-transport/1` semantics. They synchronize `appearance`, portable accessibility preferences and portable workspace metadata only when a real account session exists. Native/USB now advertises `sync.safe-state` only alongside `account.identity`, stores the account session outside Surface JavaScript, and persists a subject-bound sync checkpoint in private device state with an explicit session fallback. Public rollout and Native/USB multi-device physical proof remain pending, so this source integration must not be described as a released public cloud-sync capability.

The shared Surface now also has a local preference-sync bridge. It observes the live `ordax.preference-runtime/1` state, converts appearance changes into canonical idempotent appearance mutations and exposes only local queue/status through `ordax.sync-runtime/1`. Repeated offline theme changes compact to the newest pending value for the single stable `appearance/theme` object. This bridge does not publish anything by itself and does not advertise cloud/account continuity.

Offline preference sync state is persisted behind the neutral `ordax.sync-state-store/1` boundary. Web uses browser-local storage when available; Native stores an opaque bounded payload in persistent OrdaX device state under `/var/lib/ordax`. If persistence is unavailable, the runtime degrades to session-only state and reports that honestly. The persistence adapter never decides sync semantics or transport authority.

Workspace continuity now has a separate portable metadata source. It projects only active area identity, area identities/order and open app IDs. Window coordinates, minimized/maximized flags and other display-specific geometry are deliberately excluded, and geometry-only local changes do not emit a metadata change. This prepares cross-device workspace continuity without treating one device's screen layout as portable state.

## Account-owned Intelligence Memory foundation

`account-memory-runtime.mjs` is the first source foundation for carrying eligible `ordax.memory/1` domain objects through the existing `ordax.sync-transport/1` protocol. It is deliberately **not promoted or wired into Web/Native composition yet**. The current Supabase gateway/backend still rejects the `memory` data class, and no public Memory sync capability is claimed.

The boundary is intentionally narrower than the Memory store:

- the local Memory store remains the source of Memory semantics; the sync layer never serializes the whole store/snapshot as cloud state;
- `ownerKind=device` never enters account sync;
- only account-owned `account`, `space` and `project` scopes are eligible in v1;
- `device` and `session` scopes remain local, and `restricted` sensitivity is fail-closed until a separate policy explicitly promotes it;
- the payload embeds a validated `ordax.memory/1` item under `ordax.memory-sync-payload/1`; unknown provider fields cannot redefine owner, scope, provenance, sensitivity or authority;
- stable sync object identity is derived from the Memory ID inside the already account-scoped transport namespace;
- delete/forget is an explicit tombstone carrying only Memory identity, not deleted content;
- server revisions are conflict authority; wall clocks are not;
- concurrent/divergent state becomes an explicit pending conflict and is not silently rebased or resolved by global last-write-wins;
- transport failure leaves local Memory intact and keeps the mutation pending for retry;
- bounded remote-batch application accepts objects supplied by canonical account reconciliation and applies authorized Memory through `ordax.memory/1` plus its durability barrier.

The Memory handler deliberately does **not** own `snapshot()`, `pullChanges()`, the account cursor or a transport lifecycle. `system/services/sync/account-runtime.mjs` remains the sole account reconciliation orchestrator. A future live integration may feed Memory objects from that existing snapshot/change stream only after the remaining durable-state and backend promotion gates are satisfied, preserving one synchronization system.

Every upload/restore operation requires an explicit authorization policy supplied by trusted composition. This foundation does not grant tools, action authority, model egress or a new entitlement. Synchronized Memory is classified as **user cloud state**; synchronization does not imply AI-training authorization, telemetry authorization or community-data authorization.

The current pending queue for this Memory foundation is session-scoped. Durable offline queue/checkpoint integration, provider/backend acceptance, live Web/Native wiring, final domain conflict-resolution UX, two-client proof and reinstall proof remain required before promotion.

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
