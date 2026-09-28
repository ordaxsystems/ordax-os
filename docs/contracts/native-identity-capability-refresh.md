# Native identity capability refresh

The Native Surface derives online account capabilities from the live `identity-session` snapshot. A boot-time availability result is not retained as standing authority.

When the identity session changes, the Surface host refreshes its capability projection. `account.identity` and `sync.safe-state` are present only while the real session adapter reports a configured identity provider state (`signed-out` or `signed-in`). Browser connectivity alone never grants either capability.

The same-origin credentials adapter is constructed from the browser transport capability (`window.fetch`), not from a one-time provider probe. Sign-in and registration UI remain governed by the live `identity-actions` snapshot, so an offline or unconfigured provider continues to fail closed without a fake provider or fallback path.

The Native composition owns both subscriptions and removes its `online` listener and identity-to-host subscription during `pagehide`.
