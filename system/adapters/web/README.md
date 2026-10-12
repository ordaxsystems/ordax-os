# Web Capability Adapter

Browser-safe implementation of OrdaX capability contracts.

This adapter may use browser APIs, authorized remote APIs or explicit unsupported-capability results. It does not own separate screens, CSS, design tokens or app forks.

`runtime.mjs` implements the platform-neutral `ordax.surface-host/1` boundary from `system/contracts/surface-host.mjs` and currently reports browser connectivity plus the available `network.https` capability.

`preferences.mjs` implements `ordax.preference-store/1` from `system/contracts/preference-store.mjs`. Browser storage is contained here: the shared app, Surface and preference service do not access `localStorage`. The adapter keeps a last-good in-memory snapshot and degrades to session-only behavior if browser storage is unavailable or denied. Corrupt persisted bytes are ignored instead of overriding validated preference semantics.

Identity implements the neutral ordax.identity-session/1 port by reading /auth/session with same-origin credentials and no cache. Missing, malformed or unconfigured responses remain unavailable; only a validated authenticated response provides subject/display identity. Refresh sequence and disposal suppress late responses.

Identity actions implement ordax.identity-actions/1 and derive supported commands from that same session. Sign-in delegates to /login/; sign-out posts to /auth/logout and refreshes the canonical session. Provider credentials remain in the existing server/adapter boundary; unavailable identity advertises no commands.

Session state and command support are intentionally separate ports. `system/services/account/` validates their relationship with runtime capabilities so adapters cannot advertise account actions while identity itself is unavailable. The Surface chooses the context-appropriate action from the current session and never needs provider-specific branches.

The Web preference store currently persists only the shared preference snapshot supplied by the Surface. It does not imply account sync, server backup or secure-secret storage.

This adapter deliberately does **not** claim that account or sync services are implemented merely because those capabilities belong to the Web product baseline. Runtime capability snapshots describe what the current host actually exposes.

`system/composition/web/` is responsible for wiring Web adapters to the shared Surface. Adapter modules never import the Surface.

The Web account composition now binds these same adapters to Central. Spaces is a read-only catalog from /account/spaces, refreshed only with an authenticated session and reset on subject changes. This does not select a Space, grant access to devices/files, activate storage or enable inference.
