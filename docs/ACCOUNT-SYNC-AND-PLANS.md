# Account Sync and Plans

Status: CANONICAL FOR PROTOTYPE / BOUNDED ACCOUNT CLOUD REQUIRED FOR MVP RELEASE

## One identity

An OrdaX user has one account across every supported product mode:

```text
Web
Android / iPhone / iPad
Desktop
USB
Native
```

The account owns identity, entitlements and synchronized user state. A device owns only device-local state and secrets. **An account is never required to boot or use the local OrdaX OS.**

## Spaces and professional Profile Packs

The account profile identifies the user. **Spaces** organize contexts of work, projects, memory and future collaboration.

A professional profile such as Developer, Creator, Business or Legal is modeled as a versioned **Profile Pack applied to a Space**, not as another user identity and not as another operating system.

Profile Pack categories are not paid merely because of their name. Future plans may monetize measurable ecosystem value such as additional active Spaces, shared membership, cloud memory/history, sync/backup capacity, user object storage, external-model compute, connectors, automations and support.

The pre-MVP foundation carries a **provisional two-private-Space default** for the free experience. This is a product-capacity default, not a frozen price or final commercial quota.

Profile Packs may compose apps, templates, knowledge-source policy and Intelligence defaults, but they cannot grant privileges, bypass app signature verification or bypass entitlement checks.

## MVP account-cloud boundary

The public MVP requires a **bounded account cloud** before launch, while preserving fully local/offline use without an account. The aggregate release gate is `docs/contracts/mvp-account-cloud.json`.

The required online slice is:

- registration/login/session refresh/logout and session revocation;
- password recovery;
- account export and account close;
- Account Sync for the explicitly approved MVP data classes;
- Cloud Memory for `account` and `Space` scopes only, after explicit rollout policy and server entitlement;
- private cloud storage for files explicitly selected by the user;
- server-authoritative entitlements, usage and quota admission.

Full Web/Mobile clients, sync of every data class, advanced backup policies and unrestricted cloud automation remain later work. Pricing and billing are commercial decisions and are **not** authorization prerequisites for proving this architecture.

## Cross-device continuity — incremental backend v2 + Web/Native source integration

The account-scoped synchronization backend is applied to the dedicated `ordax-control-plane` project. It provides owner-scoped RLS, stable object IDs, per-object server revisions, idempotent mutation keys, explicit tombstones and optimistic conflict detection. Backend v2 also records an immutable account change sequence: first reconciliation uses `ordax_sync_snapshot_v1` to obtain an atomic object snapshot plus baseline cursor, mutations use `ordax_apply_sync_mutation_v2`, and later reconciliations page through `ordax_pull_sync_changes_v1`. This avoids incorrectly treating a per-object revision as an account-wide cursor.

Web and USB/Native now use the same OrdaX-owned transport semantics for `appearance`, portable accessibility preferences and portable workspace metadata. Each client persists a subject-bound checkpoint containing the opaque account cursor plus known object revisions; Native stores it in private device state and degrades to an in-memory session checkpoint if durable checkpoint persistence is unavailable. Provider tokens remain outside Surface JavaScript. A credential-safe two-client proof harness has a manual-only GitHub Actions wrapper: it opens two independent cookie jars for the same dedicated proof account, proves A -> B incremental delivery, tombstones the unique proof object and uploads only a sanitized receipt with cursors/source provenance. The workflow requires encrypted repository secrets and does not persist account identifiers, credentials, cookies or tokens.

That real credentialed proof has not yet completed, so synchronization remains **rollout-disabled** and must not be advertised as released. It is now a **MVP closure gate**, rather than deferred product scope. Mobile still lacks its final client integration and is not required as an MVP client.

### Live proof execution boundary

The real continuity and session-revocation proofs are deliberately **manual-only**. They require a dedicated, non-admin OrdaX proof account that is already valid for password sign-in; do not use a personal or production user account. Store its credentials only as GitHub encrypted repository secrets named `ORDAX_PROOF_ACCOUNT_EMAIL` and `ORDAX_PROOF_ACCOUNT_PASSWORD`. Never commit them, paste them into workflow inputs or save them in proof artifacts.

Run `Account Sync Two Client Proof` to prove two independent sessions observe the same incremental account stream and the temporary proof object is tombstoned. Run `Account Session Revocation Proof` to prove local logout invalidates session A and its captured refresh token without revoking independent session B. Both workflows upload only sanitized receipts and remain pending until a real credentialed execution succeeds. The receipts intentionally exclude account identifiers, credentials, cookies and tokens.

The bounded MVP synchronization target includes:

- appearance and theme;
- preferences and portable accessibility preferences;
- workspace metadata;
- app-state metadata explicitly classified as safe to move between devices;
- metadata for explicitly selected cloud-backed user content.

Adding another class never happens implicitly: it requires its own versioned resolver, privacy classification and proof.

### Cloud Memory source-of-truth boundary

Cloud Memory is **required for MVP closure but remains public-rollout disabled today**. The canonical persisted source of truth is `public.ordax_memory_items`; `private.ordax_sync_objects` is only a transport mirror for Memory through the deployed server-authoritative `ordax_apply_memory_mutation_v1` boundary, which updates canonical Memory and sync/tombstone state atomically. Independent client dual-writes are forbidden.

The manual proof path models independent authenticated sessions of the same dedicated non-admin account: one client mutates Memory and another verifies incremental delivery, stale-revision rejection and the final tombstone/canonical deleted state. A fresh client must also restore the current state without relying on a local checkpoint. Public rollout remains disabled until the real authenticated proofs and the explicit account/Space rollout policy are approved.

The proof entitlement has a separate operator-only source boundary. It can issue only account-scoped `memory.cloud.enabled` for the proof, requires a bounded TTL plus exact source commit and audit reason, and exposes no EXECUTE privilege to public, anonymous, authenticated or service-role clients. Applying that schema does not issue any grant; selecting the dedicated proof account and invoking the operator function remain explicit later actions.

The initial MVP-eligible scopes are **account and Space only**, gated by authenticated ownership/access plus the server-authoritative `memory.cloud.enabled` entitlement. Device/session/project and restricted Memory remain excluded from the initial cloud rollout. Deletion propagates as an explicit tombstone; wall-clock last-writer-wins is not an acceptable universal conflict rule. The machine-readable gate is `docs/contracts/cloud-memory-sync-boundary.json`.

## User-selected private object storage

Large user-selected files are a separate responsibility from transactional Account Sync and Memory. The OrdaX domain owns object identity, account/Space ownership, revision, size, SHA-256, lifecycle and quota admission; an object-storage provider owns only the bytes.

The canonical service boundary is `system/services/user-cloud-storage/README.md` and `docs/contracts/user-cloud-storage.json`.

MVP requirements:

- only explicit user selection may place a local file in cloud storage;
- no public bucket and no permanent public object URL;
- no provider/service secret in Surface, Memory or public metadata;
- server reservation before new storage growth;
- quota/usage are server-authoritative;
- provider object keys are opaque and never raw local paths;
- upload authorization is short-lived and bound to the reserved object;
- finalization verifies exact reserved size and SHA-256;
- cross-account and cross-Space access defaults to deny and requires negative tests;
- delete/export remain available while over quota;
- account close must revoke access and clean/tombstone associated cloud objects without leaving provider blobs orphaned.

Supabase Storage is the initial adapter target because `ordax-control-plane` is already the transactional account backend. Cloudflare R2 or another object store may later replace or complement the blob layer when measured cost/egress justifies it. Such a provider change must not alter OrdaX object IDs, ownership, revisions, entitlement or quota semantics.

## Never-sync boundary

The following classes remain local regardless of plan:

- private device keys;
- machine identity secrets;
- hardware-specific drivers;
- raw disk state;
- ephemeral caches;
- credentials that are intentionally device-bound;
- privileged recovery material whose security contract requires locality.

A paid plan never turns device-private security material into cloud-synchronized data.

## Offline-first behavior

Clients may continue working with locally available data while offline. Synchronization resumes when connectivity returns. Cloud failure must not make local Files, Notes, Intelligence, Memory or first-party apps unusable.

Before production promotion the sync engine must define deterministic conflict handling for concurrent changes. Silent last-writer-wins for all data classes is not an acceptable universal policy.

The scalable sync boundary is machine-readable in `docs/contracts/sync-model.json`. It requires stable object IDs, versioned object schemas, server revisions, idempotent mutation keys, explicit deletion tombstones, opaque incremental cursors and support for a safe full resync. Client wall-clock time is not authoritative for conflict resolution.

Conflict algorithms are deliberately not frozen globally. Each data class or content type owns a deterministic, versioned resolver. This allows richer future models without rewriting every client and prevents a simplistic global last-writer-wins rule from becoming permanent architecture.

For the currently integrated portable classes — appearance, preferences and workspace metadata — resolver v1 uses a narrow rule: if a local user change is already pending and the server reports a newer authoritative object revision, the client preserves that local intent, issues a new idempotency key and rebases it onto the observed server revision. A single flush performs at most one rebase retry; a second conflict remains pending for a later synchronization cycle. This rule does **not** apply automatically to Notes, files or another content class. Those classes require their own resolver before synchronization is enabled.

## Operational realtime is not account sync

Cross-device continuity does not make the account sync stream a business event bus.

Orders, production queues, device telemetry and other live operational state use the
separate `ordax.operational-event/1` boundary defined in
`docs/OPERATIONAL-REALTIME.md` and `docs/contracts/operational-realtime.json`.

Rules:

- account sync remains responsible for portable user/account state;
- each operational domain owns its canonical business/device state;
- realtime delivery uses a server-authoritative sequence and aggregate revision;
- reconnect may resume from sequence, but a replay gap requires canonical reconciliation;
- notifications may be derived from operational events but are not the state itself;
- device commands never travel through sync or push payloads;
- remote mutations require the shared OrdaX Action Gateway and an explicit Device Agent grant.

Runtime realtime transport, full Mobile integration and public device actions remain later promotion work; they are not made implicit by the MVP account-cloud requirement.

## Provider independence

Sync/domain semantics belong to `system/services/sync`, Memory semantics to `system/services/memory`, entitlement/quota semantics to `system/services/entitlements`, and user-object semantics to `system/services/user-cloud-storage`. They do not belong to a database vendor, cloud provider or platform adapter.

Clients consume OrdaX object/revision semantics rather than database rows or provider-specific identifiers. Changing the backend therefore must not require a client migration solely because infrastructure changed.

Platform adapters own secure token storage, lifecycle/background integration, transport and provider plumbing. They cannot redefine data classification, conflict policy, entitlements, quota ownership or never-sync boundaries.

## Security

Account cloud requires:

- encrypted transport;
- server-side authorization for every user-scoped object;
- least-privilege grants plus RLS, with deny-all server/operator tables allowed deliberately;
- device/session revocation;
- bounded token lifetime and secure local token storage;
- Secure/HttpOnly/SameSite session cookies at the public gateway;
- CSRF and same-origin enforcement for state changes;
- rate limits using a verified real-client-IP chain;
- explicit data classification;
- auditable entitlement and quota checks for remote services;
- no client-side trust in a locally claimed paid plan, quota or usage;
- no `service_role`, provider secret or bearer token in browser/Surface/Memory;
- real negative isolation and lifecycle proofs before public rollout.

Platform biometric APIs may protect local session access, but biometrics do not replace canonical account authentication or server authorization.

## Monetization architecture — commercial policy deferred

The structural plan IDs `free`, `personal`, `professional` and `team` may exist before launch to shape entitlements, but **billing is not active and prices/cost-sensitive quotas remain undefined** until measured unit economics exist.

The account/domain architecture keeps an entitlement and quota boundary so future services can be authorized server-side without fragmenting identity. Potential value-bearing categories include synchronization capacity/history, cloud Memory, private object storage, backup/restore, PC/Web/Mobile continuity, collaboration, premium compute/features and enhanced recovery/support.

The direction is to charge for **ecosystem value and service capacity**, not to impose an arbitrary fee merely because a user connects a second device.

## Downgrade safety

A plan downgrade must not silently delete user data. If the stored amount exceeds the new quota, the service enters a documented limited state: existing data is retained and new growth may be blocked until usage is reduced or the entitlement changes. Export and delete remain available.

Exact retention/grace policy is a later commercial decision, but destructive surprise is forbidden.

## Devices

The MVP defines **no commercial device-count limit**.

A future device registry exists for session security, revocation, continuity and device management. It distinguishes devices/sessions without synchronizing device-private keys. Any future commercial limit requires a separate explicit decision; charging merely for a second device is not the current direction.

## Data ownership and portability

Plan design must not make the user's own synchronized data inaccessible solely because a premium feature expired. Export/delete/account controls remain account-level capabilities independent of the client used to invoke them.

## Architecture boundary

Shared services own product semantics. Platform adapters own provider/OS integration.

```text
system/services/sync
        |
        +-> web adapter
        +-> mobile adapter (Android/iOS)
        +-> desktop adapter
        +-> native adapter

system/services/user-cloud-storage
        |
        +-> Supabase Storage adapter (MVP target)
        +-> R2/other object adapter (future eligible)
```

No platform or storage provider gets its own incompatible synchronization, ownership or quota model.

## Device-private account session

On Native/USB, provider bearer tokens never enter Surface JavaScript. The local host owns an OrdaX gateway session in private device state (mode `0600`) and exposes only sanitized account/sync responses to the loopback Surface. That session is explicitly outside the sync data model.
