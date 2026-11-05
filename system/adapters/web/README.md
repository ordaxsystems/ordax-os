# Web Capability Adapter

Browser-safe implementation of OrdaX capability contracts.

This adapter may use browser APIs, authorized remote APIs or explicit unsupported-capability results. It does not own separate screens, CSS, design tokens or app forks.

`runtime.mjs` implements the platform-neutral `ordax.surface-host/1` boundary from `system/contracts/surface-host.mjs` and currently reports browser connectivity plus the available `network.https` capability.

`preferences.mjs` implements `ordax.preference-store/1` from `system/contracts/preference-store.mjs`. Browser storage is contained here: the shared app, Surface and preference service do not access `localStorage`. The adapter keeps a last-good in-memory snapshot and degrades to session-only behavior if browser storage is unavailable or denied. Corrupt persisted bytes are ignored instead of overriding validated preference semantics.

Identity implements the neutral ordax.identity-session/1 port by reading /auth/session with same-origin credentials and no cache. A configured gateway must explicitly return `authenticated: false` with `status: anonymous` to report signed-out, or `authenticated: true` with `status: authenticated` and valid presentation identity to report signed-in. Inconsistent status/flags, `gated` or `unconfigured` providers, invalid schema and unsafe display-name fallbacks remain unavailable, **never** a synthetic logout. This reuses the existing session reader and recovery lifecycle, without another login authority. Refresh sequence and disposal suppress late responses.

Identity actions implement ordax.identity-actions/1 and derive supported commands from that same session. Sign-in delegates to /login/; sign-out posts to /auth/logout and completes **only after** the same-origin canonical session reader confirms `signed-out`. A 303 or opaque manual redirect acknowledges the command but is not evidence that the browser lost its authenticated cookies; failed verification remains an error without synthesizing logout state. Provider credentials remain in the existing server/adapter boundary; unavailable identity advertises no commands.

The login/registration credential adapter now confirms activation with the **same bounded Web JSON GET reader** as the session and Spaces ports. The post-credential `/auth/session` proof has same-origin credentials, no-store, redirect rejection and one deadline encompassing fetch and JSON parsing. Any denied, stalled or malformed proof fails closed; neither a successful credential POST nor a `gated`/unconfigured anonymous session claims login or email confirmation. Provider availability uses the existing identity adapter's rule. Credential POSTs are never retried.

Session state and command support are intentionally separate ports. `system/services/account/` validates their relationship with runtime capabilities so adapters cannot advertise account actions while identity itself is unavailable. The Surface chooses the context-appropriate action from the current session and never needs provider-specific branches.

The Web preference store currently persists only the shared preference snapshot supplied by the Surface. It does not imply account sync, server backup or secure-secret storage.

Optional browser persistence is discovered in exactly one place:
`local-storage.mjs`. Preferences, Workspace, Memory, Sync State and Sync
Checkpoint reuse its single capability check; each retains its own canonical
schema, storage key, validation, persistence-failure behavior and session
fallback. `app-data.mjs` intentionally requires durable storage **and**
Web Locks for atomic mutations, so it must not silently inherit optional
session fallback. The `workspace.v1` reader exists only for one-time import:
the Web removes stale v1 bytes after a valid v2 read or confirmed v2 write.
Failed v2 persistence retains the original v1 and validated in-memory layout;
failed cleanup cannot invalidate committed v2. Corrupt v2 never falls back to
stale v1. Native has its own independent namespace and lifecycle.

This adapter deliberately does **not** claim that account or sync services are implemented merely because those capabilities belong to the Web product baseline. Runtime capability snapshots describe what the current host actually exposes.

`system/composition/web/` is responsible for wiring Web adapters to the shared Surface. Adapter modules never import the Surface.

The Web account composition now binds these same adapters to Central. Spaces is a read-only catalog from /account/spaces, refreshed only with an authenticated session and reset on subject changes. Explicit selection now composes the same ordax.space-selection/1 domain runtime used by Native with createWebSpaceSelectionStore. This adapter holds only a validated subject/Space record in session memory; it never grants access to devices/files, activates storage or enables inference. The unavailable port remains the fail-closed contract for hosts without this composition.

Space member lists, actor capabilities and membership action receipts share one Web composition context revision. Any change of verified identity or Spaces catalog during an in-flight operation makes its result unavailable to the current UI, including when the same account refreshes its catalog. Mutations are never replayed: the server remains the authority for their outcome. This fence reuses the existing domain services and does not create a second member store or authorization contract.

Central also consumes the existing ordax.surface-host/1 connectivity snapshot.
Snapshots are stable across unchanged reads and subscriptions stop on disposal.
Offline hints suppress account actions/refresh and abort/invalidate Spaces
using the existing catalog; reconnect revalidates session/context and never
replays commands. The UI labels cached identity as potentially stale.
Unknown browser connectivity stays unknown. Online hints are not evidence of
gateway/device access. Layout and appearance are unchanged.

Identity/Spaces GET transports now share json-read.mjs with a single 10-second
deadline including JSON body reads, same-origin/no-store and redirect:error.
Cancellation, supersession and disposal settle pending reads independently of
late fetch/body completion. Domain validation and refresh ordinals remain in
their existing adapters. Composition cancels identity reads on offline without
asserting logout, then revalidates on reconnect. Commands remain outside this
transport and are never replayed. Disposed adapters accept no new work/listeners;
unchanged identity/action snapshots keep their reference identity for React.

The dormant remote Intelligence adapter uses the exact Product UUID context
shape required by `ordax-platform/control-plane/cloudflare/src/product_intelligence_relay_contract.ts`.
An authenticated subject and an explicit target Device must each be canonical
UUIDs; Space/project are explicit nullable UUIDs (project requires Space), and
unknown envelope context fields are rejected. It normalizes UUID casing before
comparing echoed responses or checking for mid-flight context changes. This is
request-shape validation only: it never issues a grant, discovers a Device or
activates inference. Until the Platform/OS transport is deployed and credentialed
end-to-end, `system/composition/web/main.tsx` continues to inject the
unavailable canonical Intelligence port and the official Store stays unavailable.
