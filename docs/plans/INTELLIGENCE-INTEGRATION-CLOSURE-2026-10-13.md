# OrdaX Intelligence integration closure — 2026-10-13

Status: execution plan for the current integration gap. This document does not grant runtime authority and does not replace `docs/INTELLIGENCE.md`, `docs/CURRENT-STATE.md`, `PERSONAL-ORDAX.md`, or canonical contracts.

Tracking: issue #1757. Implementation slice: PR #1756.

## Goal

Close the remaining Intelligence integration gaps without introducing parallel providers, Memory, routing, grants, action brokers, stores, or app-specific authority.

The system contract remains `ordax.intelligence/1`. Native, Web, Studio and future clients consume that boundary or a typed transport projection of it. Providers remain adapters behind the model router; provider availability never creates authority.

## Non-negotiable invariants

1. One Intelligence owner: `ordax.intelligence/1`.
2. One model-routing authority: `ordax.model-router/1`.
3. One persistent Memory owner: `ordax.memory/1`.
4. Action execution remains behind canonical approvals/grants/Action Gateway/receipts.
5. Web must never import Native adapters or read provider credentials.
6. Missing transport/provider fails closed as unavailable product behavior; the current `ordax.intelligence/1` snapshot represents that as `state=degraded` plus `inferenceAvailable=false` rather than introducing an incompatible contract state.
7. External providers stay disabled until their own adapter, egress, consent, scope and E2E gates are proven.
8. Voice/file inputs are exposed only when an actual typed input capability exists.
9. Source proof, deployed transport, external-provider E2E and physical Stable proof remain distinct states.
10. Transport composition belongs to the composition/adapter layer. Surface code consumes an injected client and must not own endpoint discovery, provider selection, credentials, Memory policy, or runtime state.
11. A presentation adapter must not change the public Intelligence contract merely to express one client's unavailable state.
12. Observable client snapshots keep stable identity while their canonical fields are unchanged; transports may repeat health/status events without causing synthetic Surface state churn.

## Phases

### Phase 1 — canonical Web client boundary

- replace the stale Web-only `503` implementation detail with a typed provider-neutral Intelligence client boundary;
- inject `ordax.intelligence/1` into the current `Central`/Aura composition rather than reviving the superseded WebShell;
- keep the default Web composition fail-closed when no authorized transport is supplied;
- ensure the client validates bounded response identity/content and never accepts authority/tool fields;
- abort/ignore superseded in-flight presentation requests without granting backend-cancellation claims;
- keep `useSyncExternalStore` snapshots stable until the semantic Intelligence state changes;
- add unit/integration tests for unavailable, successful, malformed, authority-bearing, repeated-equivalent status and transport-failure cases;
- keep Native composition unchanged and authoritative for local inference.

Acceptance: Web can consume a real injected Intelligence port without importing Native/local-AI/provider code, and still fails closed when none is configured.

### Phase 2 — first supported Web/remote adapter

- define the supported same-origin transport owner outside the Surface;
- bind authenticated account/Space/project context explicitly;
- preserve Memory authorization and model-router policy server-side/device-side;
- add cancellation/streaming only if the transport can prove the same fences as Native;
- prove replay/idempotency boundaries and sanitized diagnostics.

Acceptance: one supported remote path passes source + deployment + credentialed E2E gates.

### Phase 3 — external providers

- implement provider adapters behind `ordax.model-router/1` only;
- explicit egress policy, user consent, secret isolation and per-provider health;
- no provider receives persistent Memory ownership or grants;
- fallback must be explicit policy, never silent.

Acceptance: provider route is enabled only after adapter + policy + consent + E2E proof.

### Phase 4 — voice/files and multimodal input

- typed input-capability contracts owned outside the model;
- file access through existing file/reference grants, never raw arbitrary paths from prompts;
- microphone through explicit media permission/session owner;
- provenance retained through result projection.

### Phase 5 — release and cleanup closure

- reconcile `docs/CURRENT-STATE.md`, `docs/INTELLIGENCE.md`, MVP/promotion gates and public wording after implementation proof;
- remove superseded Web Intelligence demo/WebShell paths only after dependency search and replacement coverage prove they are no longer consumers;
- remove duplicate Aura presentation branches after the canonical window path is covered;
- run canonical CI, disposable boot and final physical Stable/MVP proof.

## Phase 1 implementation record

PR #1756 currently implements the boundary without enabling any remote provider:

- `system/adapters/web/intelligence.mjs` owns the honest fail-closed Web adapter; it implements the existing contract without modifying it;
- `system/surface/workspace/lib/intelligence/client.mjs` is a thin provider-neutral presentation client, validates canonical requests/responses and suppresses only semantically duplicate status notifications;
- `IntelligenceClientProvider` injects the client into the current Web composition and remains platform-neutral;
- current `Central`/Aura windows route through `AuraContent`, not the old WebShell demo path;
- Aura owns only transient presentation state and request cancellation; it does not own provider discovery, credentials, Memory, model routing or authority;
- tests reject malformed/authority-bearing responses, prove snapshot identity stability and assert that the Web path has no provider credentials, `fetch()` transport, Native adapter import or provider-specific API;
- the Surface verifier no longer calls the old `ai.functions.ts` `503` stub; it proves the canonical Web adapter/client fail closed instead.

The first CI attempts exposed real integration issues and they were corrected at the architecture boundary instead of bypassed:

1. TypeScript needed an explicit `AbortSignal` option type.
2. Placing a Web fallback helper in the public contract made the App SDK bundle stale. The helper moved to the Web adapter and `system/contracts/intelligence.mjs` returned to the unchanged public contract.
3. Chromium exposed a React `Maximum update depth` loop: validation created a new snapshot object on every immediate subscription event. The client now retains snapshot identity until canonical fields change and does not synthesize an extra subscription notification. A regression test covers repeated-equivalent and real state transitions.

`Intelligence Foundation` is green on the stabilized client head. Surface Web build/Chromium and the remaining canonical workflows remain the completion gate for this phase.

## Cleanup audit

The old Intelligence WebShell/demo graph is not mounted by `system/composition/web/main.tsx`, but it is not yet safe to delete as a blind cleanup: `tests/test_surface_web_builder.py` still treats `components/web/shell.tsx` as part of its builder/source contract, and that shell owns the old `IntelligenceSessionProvider` chain. Therefore Phase 1 removes the obsolete **active verifier dependency** on the hardcoded `503`, while retirement of the old shell/session/demo graph remains a deliberate Phase 5 migration with builder/provenance updates and replacement coverage. This prevents both parallel active paths and destructive cleanup by filename/age.

## Explicitly not implemented by Phase 1

- supported Web inference transport;
- ChatGPT/OpenAI/xAI provider adapters;
- provider credentials or provider selection in Surface;
- voice or file input;
- remote Memory/context transport;
- new grants, tool authority or background autonomy;
- Stable/MVP physical proof.
