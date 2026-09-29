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

`account-memory-runtime.mjs` is a source-only foundation for carrying eligible `ordax.memory/1` objects through the existing `ordax.sync-transport/1` protocol. It is deliberately **not promoted or wired into Web/Native composition**. The current gateway still does not advertise `memory`, and no public Memory sync capability is claimed.

Memory cloud semantics are additionally constrained by `docs/contracts/cloud-memory-sync-boundary.json`. The local Memory domain/storage remains the semantic source of truth; sync objects are transport mirrors only and cannot redefine Memory ownership, scope, provenance, sensitivity, retention or authority.

The v1 boundary is intentionally narrower than the Memory store:

- `ownerKind=device` never enters account sync;
- only account-owned `account` and `space` scopes are eligible;
- `project`, `device` and `session` scopes remain local;
- `restricted` sensitivity remains local/fail-closed;
- stable sync identity is exactly the canonical `memory_id`; the existing `(account, data_class, stable_object_id)` transport namespace means no encoded second Memory identity is created;
- the payload embeds a validated `ordax.memory/1` item under `ordax.memory-sync-payload/1`;
- unknown provider fields cannot redefine Memory semantics or authority;
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
- `accept-authoritative-remote` discards the pending local intent but does not apply provider state directly; it requires canonical remote reconciliation.

Both decisions are manual, `automatic=false`, and neither introduces global last-write-wins.

### Restore foundation

`account-restore-plan.mjs` defines `ordax.account-restore-plan/1` for ordering a future reinstall/account restore without claiming that reinstall restore is implemented. Portable state comes before eligible Memory, derived indexes/caches are rebuilt locally, and health verification comes last. Memory restore is blocked when coordination recovery, pending local intent or unresolved conflict makes remote application unsafe. Never-sync classes abort planning; unpromoted metadata classes remain explicitly deferred rather than guessed.

### Backend enforcement foundation

The source-prepared backend guard extends the existing canonical account mutation RPC; it does not create a Memory RPC or second backend. The server revalidates account ownership, `account`/`space` eligibility, `normal`/`private` sensitivity, canonical `stable_object_id == memory_id`, never-sync material and identity-only tombstones. Its migration remains source-prepared/not applied and gateway live wiring remains disabled.

Every upload/restore operation still requires explicit authorization supplied by trusted composition. Synchronized Memory is **user cloud state**; synchronization does not imply AI-training authorization, telemetry authorization, community-data authorization, model egress, tools or actions.

This remains a source foundation. Live Web/Native Memory wiring, provider promotion, final user-facing conflict review, two-client proof and reinstall proof are still required before promotion.

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
