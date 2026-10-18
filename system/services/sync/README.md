# Account sync service

The canonical account sync runtime owns reconciliation for portable account state. Data-class adapters project domain objects into the versioned sync protocol; they do not create independent sync loops, cursors or provider semantics.

## Account-owned Intelligence Memory foundation

`account-memory-runtime.mjs` carries eligible `ordax.memory/1` objects through the existing `ordax.sync-transport/1` protocol. Native composition is now wired through the canonical Account Memory foundation with server-authoritative entitlement checks and fail-closed restore; Web durable Memory remains unavailable and no public Cloud Memory capability is promoted. The generic gateway path still does not accept client-claimed Memory authority.

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

### Native Appearance and portable pending account partitions

The Native account composition now reuses the **same canonical `ordax.sync-state-store/1` physical store and namespace registry** for `appearance` and `portable-pending`, each opened with the verified `subjectId` partition. These are queue-coordination records, not a new identity store, provider, transport, cursor, or separate synchronization runtime.

- A signed-out session cannot enqueue cloud appearance or portable workspace/preference mutations. Local guest edits never become implicit mutations on later sign-in.
- Queued account A changes are not consumed, discarded, rebased using account B revisions, or uploaded during B's session. On return to A, exact validated pending intent and idempotency keys are recovered from A's partition.
- Legacy unpartitioned Appearance state is preserved for explicit migration/recovery but is **not** silently attributed to a newly signed-in account.
- Empty or deleted cloud portable objects do not authorize automatic export of locally visible workspace/preferences from an earlier identity. Only account-context explicit changes or already-partitioned pending intent can be sent.
- Each pending mutation uses the existing state store and must have a successful save and durable flush acknowledgment **before remote delivery**. A rejected write fails closed; an old Host flush success does not validate a rejected mutation.
- A malformed, unknown, cross-subject, or corrupt pending envelope does not get silently reset to empty or replayed as another account's state; reconciliation requires recovery.
- The Native workspace adapter now partitions its **local browser workspace** by verified account subject, while keeping the existing guest v1/v2 workspace under guest keys. Identity changes cause the existing metadata bridge to publish a full workspace replacement to the Surface; cloud restore uses the same store notification, never a second window store.
- On unavailable identity, the Surface fails closed to guest windows instead of displaying the last signed-in subject's targets. Corrupt local account partitions remain preserved and cannot be silently overwritten. If localStorage is inaccessible, records remain volatile and separated only for that runtime.
- These partitions implement **logical UI/data routing**, not filesystem encryption or OS user permissions. People sharing the same USB/browser storage can still inspect localStorage using privileged development access. Protecting arbitrary device files and per-person local secrets requires its own account/OS permission architecture and physical tests. No public-cloud rollout is enabled by this change.

### Live two-client proof (manual; not simulated CI)

The existing `.github/workflows/account-sync-two-client-proof.yml` is the sole **live provider** proof entry point. It is `workflow_dispatch` only and requires a dedicated non-production proof account through `ORDAX_PROOF_ACCOUNT_EMAIL` and `ORDAX_PROOF_ACCOUNT_PASSWORD` GitHub secrets. The script `tools/account-sync/prove_two_clients.py` holds separate in-memory cookie jars for sessions A and B, asserts A→B incremental creation and tombstone delivery, and never publishes account identifiers or bearer credentials.

The producer step exposes the **actual generated receipt path** through `GITHUB_OUTPUT`. Validation and artifact upload consume that one producer output, rather than assuming one step's local environment variable exists in another step. Gateway URLs must be HTTPS with no embedded userinfo, query or fragment; credential-bearing HTTP redirects are rejected. The proof uploads only the sanitized receipt with source commit and delivery cursors.

The pull-request CI exercises the producer-output contract, URL validation and redirect-denial with a disposable loopback server **without real credentials**. This does *not* count as the live provider proof. No claim of two authenticated real sessions or production cloud rollout is made until the manual proof is run successfully and its independent receipt is reviewed. Physical USB operation, filesystem isolation, password recovery and account lifecycle promotion remain separate gates.

### Conflict boundary

Memory does not use the automatic rebase policy used by Appearance/preferences/workspace metadata. A concurrent/divergent Memory object is quarantined and blocks canonical account cursor advancement until the domain conflict is explicitly resolved.

`memory-conflict-resolution.mjs` defines the source-only `ordax.memory-conflict-resolution/1` primitive with exactly two explicit decisions:

- `preserve-local-intent` creates a new validated mutation based on the authoritative server revision with a new idempotency key;
- `accept-authoritative-remote` discards the pending local intent but does not apply provider state directly; the runtime persists `reconciliation-required` until canonical remote state is actually reapplied.

Both decisions are manual, `automatic=false`, and neither introduces global last-write-wins.

The canonical account runtime also treats unresolved Memory coordination as a cursor barrier. A Memory-less follow-up batch cannot advance the account cursor while `conflictCount > 0`; after `accept-authoritative-remote`, the authoritative remote object must actually be consumed and flushed through the Memory domain before cursor advancement resumes.

### Restore foundation

`account-restore-plan.mjs` defines `ordax.account-restore-plan/1` for restore ordering. Native CI now proves the real composition path on fresh local state: `createNativeAccountMemoryFoundation` and `createNativeAccountSyncRuntime` restore eligible Memory from the canonical account snapshot, confirm Memory durability before advancing the account checkpoint, and do not echo remote Memory as a local mutation. This is a source/CI composition proof, not a physical USB reinstall proof. Portable state still precedes eligible Memory, derived indexes/caches remain rebuildable, and health verification stays last.

Memory restore is fail-closed on coordination recovery, pending local intent, unresolved conflict or `reconciliation-required`. A healthy coordination snapshot alone is not authorization: when Memory objects are present the planner requires an explicit `authorizeMemoryRestore()` decision supplied by trusted composition, and only the literal result `true` marks the Memory phase ready. The planner does not issue, infer or trust a client-claimed cloud entitlement and continues to report `grantsAuthority=false`. Never-sync classes abort planning; unpromoted metadata classes remain explicitly deferred rather than guessed.

### Backend enforcement foundation

The canonical backend now has the dedicated server-authoritative atomic Memory mutation `public.ordax_apply_memory_mutation_v1`. It writes `public.ordax_memory_items` and its private sync mirror in one database transaction, remains entitlement-gated, and public rollout is still disabled. The generic account mutation RPC deliberately does **not** accept `memory`.

`20260929193000_cloud_memory_privacy_hardening_v1.sql` is a later source-prepared migration for two privacy invariants that must hold before promotion: known never-sync secret material aborts the atomic write, and a Memory forget scrubs replayable historical mutation payloads while preserving revisions/change cursors. This hardening migration is not claimed as deployed by this branch.

The local-first identity-allocation contract is now resolved in source. `20260929214500_cloud_memory_local_first_identity_v1.sql` preserves an existing local UUID v4 on first cloud synchronization and retains server-generated UUID allocation only as a fallback when no local identity is supplied. This removes the need for a parallel identifier or silent Memory-id rewrite. The migration is still source-prepared rather than claimed deployed here, and live client wiring remains disabled until that migration plus the gateway/client path are applied and proven.

Every upload/restore operation still requires explicit authorization supplied by trusted composition. Synchronized Memory is **user cloud state**; synchronization does not imply AI-training authorization, telemetry authorization, community-data authorization, model egress, tools or actions.

This remains a pre-promotion foundation. Native app-facing Memory writes are now wired through the local-first protected composition when device-durable coordination is available, while Web durable Memory wiring remains unavailable. Public cloud promotion still requires the deployed identity-allocation boundary to be live-proven end to end, canonical full-resync after accept-remote when required, final user-facing conflict review and a real authenticated two-client backend proof. Native fresh-install restore is now CI-proven at composition level; physical USB reinstall remains a separate hardware evidence class. The Native Account Surface now exposes explicit manual Memory conflict review for preserve-local versus accept-remote decisions; it never applies an automatic last-write-wins choice.

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
