# Workspace presentation reader — proposed composition-only contract

Status: **PROPOSED / NON-EXECUTABLE**
Owners: **Workspace** (window lifecycle) + **Surface composition** (presentation projection)
Implementation: **PR-04 or later. PR-01 only defines and validates this contract.**

This proposal gives the canonical Surface a read boundary over the existing Workspace without creating a second Workspace, Window Manager, store, lifecycle, authorization service, or app-facing SDK.

## Existing authority

Until an implementation PR lands, current source/contracts remain authoritative:

- Native Workspace: `system/surface/ui/surface-state.mjs` + `system/contracts/workspace-store.mjs`.
- Web Workspace: `system/surface/workspace/components/central/desktop-state.ts`.
- Sync metadata: `system/contracts/workspace-metadata-source.mjs`; not a window/foreground reader.
- App render lifecycle: `system/contracts/surface-render-lifecycle.mjs`; not expanded by this proposal.

The future reader is composition-only. It must not mutate Workspace, persist a shadow copy, expose document contents/drafts/credentials/grants/`healthToken`/raw paths/private targets, derive domain authorization from visibility, or become an external-app API.

## Current baseline

Baseline: `dfe35c6d5479d2fa9413903b22cc5d1a31c2f64d`.

Native has stable `area-N` identities and area-scoped windows. The same singleton app can reuse the same `windowId`/`appId` in different areas, so global `windowId` is insufficient. Persistence remains `ordax.workspace-store/2`. Native compact does not exist yet.

Web keeps session state in `desktop-state.ts`. Current instance identity is display `title`; this is a gap, not a contract to preserve. Compact/session continuity already exists.

`ordax.workspace-metadata-source/1` exposes bounded areas + `appIds` only. `ordax.surface-render-lifecycle/5` exposes render subscription and app-target operations only.

## Proposed read shape

Names are descriptive, not exported runtime symbols.

```text
WorkspacePresentationReader
  getSnapshot() -> WorkspacePresentationSnapshot
  subscribe(listener) -> unsubscribe

WorkspacePresentationSnapshot
  revision
  activeAreaId
  windows[]:
    areaId
    windowId
    appId | destinationId
    mode
    minimized
    previousExpandedMode
    order
    actions
```

`revision` is a monotonic safe integer for semantic Workspace changes. `actions` only describes Workspace lifecycle availability; it never implies domain authorization. Unsupported state is explicit.

## Lifecycle

`getSnapshot()` preserves object identity while semantic `revision` is unchanged. Clock/paint/hover/unrelated preference events do not advance it.

`subscribe(listener)` is change-notification only and does not emit the current value merely because registration occurred. Composition subscribes, then reads `getSnapshot()`; a racing notification causes a re-read before publication. Callbacks are signals, not snapshot payloads.

Unsubscribe is idempotent and guarantees no later callback. Any composition-private `dispose()` is also idempotent, tears down observers/subscriptions, and produces no post-dispose callbacks. Reader creation does not launch apps or start polling.

## Six mandatory invariants

### 1. Composite identity

Native identity is `(areaId, windowId)`. Same `windowId`/`appId` may exist in multiple areas.

Web must receive a stable instance ID before an operational reader exists. It must not derive from title, locale, target, subject, array position, or visible label. Closed identity is not recycled into still-pending work.

### 2. Minimal bounded shape

Only allowlisted lifecycle metadata is exposed. IDs, enum values, collection bounds, duplicates, and references are validated at the owner boundary.

`workspace-store/2` persistence bounds do not silently prove every launch path already enforces the same runtime bound. A future implementation must not truncate/hide existing windows.

### 3. Target is a separate boundary

Workspace target validation is syntax/size validation, not grant/ACL/reference proof. Generic reader output never includes `target`.

Private names/targets require an owner-specific authorized port with purpose, allowlist, revision, and action-time revalidation.

### 4. Coherence and A→B→A generation

Workspace `revision` and Surface presentation/context generation are different.

Surface derives one coherent projection from Workspace snapshot + presentation/visibility + lock/modal + authorized Identity/Space/resource generation.

Generation advances on context transition, logout, expiry, observed revocation, lock, teardown, and return to previously used IDs. Equality of visible IDs is not sufficient to accept old async work.

Until inputs converge, protected metadata is redacted, protected actions fail closed, and `foreground = null`.

### 5. Delivery and cleanup

Equivalent semantic snapshots preserve identity/revision. Consumers share the coherent projection/revision and do not cache a “last foreground” as authorized context.

Async results/commands are applied only after captured generation/revision still matches current state. Stale/disposed/aborted/superseded work is discarded without replay/retarget. This does not claim backend cancellation.

Unsubscribe/dispose cleanup is deterministic and idempotent.

### 6. Acceptance cases

Later implementation must cover:

- two areas with the same singleton;
- duplicate visible titles + locale change;
- unknown/extra/oversize input;
- minimized and inactive-area windows;
- Central hiding ordinary Desktop windows from foreground;
- compact selected/unselected/collapsed;
- modal and lock;
- A→B→A with late response;
- revocation without visible-ID change;
- unsubscribe/dispose;
- equivalent snapshot without new revision/render;
- no private target/content in generic reader, dock, chrome, or diagnostics.

PR-01 documents these cases and baseline gaps; it does not mark future behavior PASS through fixtures.

## Foreground projection

Foreground is a Surface projection, not Workspace authority.

Start from logical active window in the active area/context, then exclude closed, minimized, inactive-area, unselected compact, collapsed compact, hidden/inert, modal-blocked, locked, or authorization-invalid candidates.

If none remains visible/interactable, `foreground = null`; logical selection may remain for later restoration.

Rail, dock, chrome, and contextual Intelligence consume the same coherent presentation revision. Keyboard focus on dock/chrome alone does not change foreground.

Under the Meridian presentation policy, Central does not expose ordinary hidden Desktop windows as contextual foreground. Presentation changes must use canonical Surface policy without remounting apps to fake state.

## Compact and commands

Web compact remains existing session state. Native compact stays an open gap in PR-01. No `workspace-store/3` and no compact persistence promise are introduced.

Reader has no mutation methods. Workspace lifecycle commands remain in the current owner. Domain commands remain in domain owners; visible state never grants domain authority.

## Rollback

PR-01 is additive documentation/tests only. Reverting it changes no persisted schema, preferences, windows, Space, Identity, app data, trust, or runtime behavior.
