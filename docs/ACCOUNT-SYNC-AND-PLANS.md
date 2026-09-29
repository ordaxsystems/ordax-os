# Account Sync and Plans

Status: CANONICAL FOR PROTOTYPE

## One identity

An OrdaX user has one account across every supported product mode:

```text
Web
Android / iPhone / iPad
Desktop
USB
Native
```

The account owns identity, entitlements and synchronized user state. A device owns only device-local state and secrets.

## Spaces and professional Profile Packs

The account profile identifies the user. **Spaces** organize contexts of work, projects, memory and future collaboration.

A professional profile such as Developer, Creator, Business or Legal is modeled as a versioned **Profile Pack applied to a Space**, not as another user identity and not as another operating system.

Profile Pack categories are not paid merely because of their name. Future plans may monetize measurable ecosystem value such as additional active Spaces, shared membership, cloud memory/history, sync/backup capacity, external-model compute, connectors, automations and support.

The pre-MVP foundation carries a **provisional two-private-Space default** for the free experience. This is a product-capacity default, not a frozen price or final commercial tier.

Profile Packs may compose apps, templates, knowledge-source policy and Intelligence defaults, but they cannot grant privileges, bypass app signature verification or bypass entitlement checks.

## Cross-device continuity — incremental backend v2 + Web/Native source integration

The account-scoped synchronization backend is applied to the dedicated `ordax-control-plane` project. It provides owner-scoped RLS, stable object IDs, per-object server revisions, idempotent mutation keys, explicit tombstones and optimistic conflict detection. Backend v2 also records an immutable account change sequence: first reconciliation uses `ordax_sync_snapshot_v1` to obtain an atomic object snapshot plus baseline cursor, mutations use `ordax_apply_sync_mutation_v2`, and later reconciliations page through `ordax_pull_sync_changes_v1`. This avoids incorrectly treating a per-object revision as an account-wide cursor.

Web and USB/Native now use the same OrdaX-owned transport semantics for `appearance`, portable accessibility preferences and portable workspace metadata. Each client persists a subject-bound checkpoint containing the opaque account cursor plus known object revisions; Native stores it in private device state and degrades to an in-memory session checkpoint if durable checkpoint persistence is unavailable. Provider tokens remain outside Surface JavaScript. A credential-safe two-client proof harness now has a manual-only GitHub Actions wrapper: it opens two independent cookie jars for the same dedicated proof account, proves A -> B incremental delivery, tombstones the unique proof object and uploads only a sanitized receipt with cursors/source provenance. The workflow requires encrypted repository secrets and does not persist account identifiers, credentials, cookies or tokens. It has not yet been executed with a real proof account, so multi-device E2E remains pending. Mobile still lacks its final integration. Native/USB physical proof and public same-origin browser activation also remain pending, so synchronization remains **Em breve** in public copy and is not yet advertised as a released MVP capability.

### Live proof execution boundary

The real continuity and session-revocation proofs are deliberately **manual-only**. They require a dedicated, non-admin OrdaX proof account that is already valid for password sign-in; do not use a personal or production user account. Store its credentials only as GitHub encrypted repository secrets named `ORDAX_PROOF_ACCOUNT_EMAIL` and `ORDAX_PROOF_ACCOUNT_PASSWORD`. Never commit them, paste them into workflow inputs or save them in proof artifacts.

Run `Account Sync Two Client Proof` to prove two independent sessions observe the same incremental account stream and the temporary proof object is tombstoned. Run `Account Session Revocation Proof` to prove local logout invalidates session A and its captured refresh token without revoking independent session B. Both workflows upload only sanitized receipts and remain pending until a real credentialled execution succeeds. The receipts intentionally exclude account identifiers, credentials, cookies and tokens.

The architecture remains prepared for future synchronized state such as:

- appearance and theme;
- preferences;
- workspace metadata;
- app-state metadata that is safe to move between devices;
- explicitly selected cloud-backed user content.

The long-term target is that one identity can continue safely across supported experiences without account silos. This is a future service objective, not an MVP availability claim.

### Cloud Memory source-of-truth boundary

Cloud Memory remains **disabled for the public MVP**. The canonical persisted source of truth is `public.ordax_memory_items`; `private.ordax_sync_objects` is only a transport mirror for Memory through the deployed server-authoritative `ordax_apply_memory_mutation_v1` boundary, which updates canonical Memory and sync/tombstone state atomically. Independent client dual-writes are forbidden. The manual proof path now models two independent authenticated sessions of the same dedicated non-admin account: Client A mutates Memory and Client B verifies incremental delivery, stale-revision rejection and the final tombstone/canonical deleted state. The proof still requires a `memory.cloud.enabled` entitlement that was provisioned before the run and cannot create that entitlement itself. Public rollout remains disabled until that real authenticated execution and the remaining rollout policy are explicitly approved.

The proof entitlement has a separate operator-only source boundary: it can issue only account-scoped `memory.cloud.enabled` for the two-client proof, requires a 5–30 minute TTL plus exact source commit and audit reason, and exposes no EXECUTE privilege to public, anonymous, authenticated or service-role clients. Applying that schema does not issue any grant; selecting the dedicated proof account and invoking the operator function remain explicit later actions.

The initial future-eligible scopes are account and Space only, gated by authenticated ownership/access plus the server-authoritative `memory.cloud.enabled` entitlement. Device/session/project and restricted Memory remain excluded from cloud sync until separate policies exist. Deletion must propagate as an explicit tombstone; wall-clock last-writer-wins is not an acceptable universal conflict rule. The machine-readable gate is `docs/contracts/cloud-memory-sync-boundary.json`.

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

Clients may continue working with locally available data while offline. Synchronization resumes when connectivity returns.

Before production promotion the sync engine must define deterministic conflict handling for concurrent changes. Silent last-writer-wins for all data classes is not an acceptable universal policy.

The scalable sync boundary is now machine-readable in `docs/contracts/sync-model.json`. It requires stable object IDs, versioned object schemas, server revisions, idempotent mutation keys, explicit deletion tombstones, opaque incremental cursors and support for a safe full resync. Client wall-clock time is not authoritative for conflict resolution.

Conflict algorithms are deliberately not frozen globally. Each data class or content type owns a deterministic, versioned resolver. This allows richer future models without rewriting every client and prevents a simplistic global last-writer-wins rule from becoming permanent architecture.

For the three currently integrated portable classes — appearance, preferences and workspace metadata — resolver v1 uses a narrow rule: if a local user change is already pending and the server reports a newer authoritative object revision, the client preserves that local intent, issues a new idempotency key and rebases it onto the observed server revision. A single flush performs at most one rebase retry; a second conflict remains pending for a later synchronization cycle. This rule does **not** apply automatically to Notes, files or other user-selected cloud content. Those classes require their own resolver before cloud synchronization is enabled.

## Provider independence

Sync/domain semantics belong to `system/services/sync`, not to a database vendor, cloud provider or platform adapter. A future backend may use any suitable durable store, queue or object storage combination as long as it satisfies the domain contract.

Clients consume OrdaX object/revision semantics rather than database rows or provider-specific identifiers. Changing the backend therefore must not require a client migration solely because infrastructure changed.

Platform adapters own secure token storage, lifecycle/background integration and transport plumbing. They cannot redefine data classification, conflict policy, entitlements or never-sync boundaries.

## Security

Synchronization requires:

- encrypted transport;
- server-side authorization for every user-scoped object;
- device/session revocation;
- bounded token lifetime and secure local token storage;
- explicit data classification;
- auditable entitlement checks for premium capabilities;
- no client-side trust in a locally claimed paid plan.

Platform biometric APIs may protect local session access, but biometrics do not replace canonical account authentication or server authorization.

## Monetization architecture — commercial policy deferred

No billing, price table, commercial tier name or device-count paywall is defined for the MVP.

The account/domain architecture keeps an entitlement boundary so future services can be authorized server-side without fragmenting identity. Potential value-bearing categories include synchronization capacity/history, cloud storage, backup/restore, PC/Web/Mobile continuity, collaboration, premium compute/features and enhanced recovery/support.

The direction is to charge for **ecosystem value and service capacity**, not to impose an arbitrary fee merely because a user connects a second device.


## Downgrade safety

A plan downgrade must not silently delete user data. If the stored amount exceeds the new quota, the service should enter a documented limited state, for example retaining existing data while blocking new uploads until usage is reduced or the plan is upgraded.

Exact retention and grace-period policy is a later commercial decision, but destructive surprise is forbidden.

## Devices

The MVP defines **no commercial device-count limit**.

A future device registry exists for session security, revocation, continuity and device management. It distinguishes devices/sessions without synchronizing device-private keys. Any future commercial limit requires a separate explicit decision; charging merely for a second device is not the current direction.

## Data ownership and portability

Plan design must not make the user's own synchronized data inaccessible solely because a premium feature expired. Export/delete/account controls should remain account-level capabilities independent of the client used to invoke them.

## Architecture boundary

Shared services own sync semantics. Platform adapters own transport integration, secure storage, background scheduling and OS-specific lifecycle details.

```text
system/services/sync
        |
        +-> web adapter
        +-> mobile adapter (Android/iOS)
        +-> desktop adapter
        +-> native adapter
```

No platform gets its own incompatible synchronization model.


## Device-private account session

On Native/USB, provider bearer tokens never enter Surface JavaScript. The local host owns an OrdaX gateway session in private device state (mode `0600`) and exposes only sanitized `/auth/*` and `/sync/*` responses to the loopback Surface. That session is explicitly outside the sync data model.
