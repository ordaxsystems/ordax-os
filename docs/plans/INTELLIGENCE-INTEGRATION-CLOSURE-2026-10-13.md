# OrdaX Intelligence integration closure — 2026-10-13

Status: execution plan for the current integration gap. This document does not grant runtime authority and does not replace `docs/INTELLIGENCE.md`, `docs/CURRENT-STATE.md`, `PERSONAL-ORDAX.md`, or canonical contracts.

## Goal

Close the remaining Intelligence integration gaps without introducing parallel providers, Memory, routing, grants, action brokers, stores, or app-specific authority.

The system contract remains `ordax.intelligence/1`. Native, Web, Studio and future clients consume that boundary or a typed transport projection of it. Providers remain adapters behind the model router; provider availability never creates authority.

## Non-negotiable invariants

1. One Intelligence owner: `ordax.intelligence/1`.
2. One model-routing authority: `ordax.model-router/1`.
3. One persistent Memory owner: `ordax.memory/1`.
4. Action execution remains behind canonical approvals/grants/Action Gateway/receipts.
5. Web must never import Native adapters or read provider credentials.
6. Missing transport/provider fails closed as `unavailable`; no mock success, seeded response or silent cloud fallback.
7. External providers stay disabled until their own adapter, egress, consent, scope and E2E gates are proven.
8. Voice/file inputs are exposed only when an actual typed input capability exists.
9. Source proof, deployed transport, external-provider E2E and physical Stable proof remain distinct states.

## Phases

### Phase 1 — canonical Web transport boundary

- replace the Web-only 503 implementation detail with a typed provider-neutral Intelligence client boundary;
- keep the default Web composition unavailable when no authorized transport is supplied;
- ensure the client validates bounded response identity/content and never accepts authority/tool fields;
- add unit/integration tests for unavailable, successful, malformed, stale-context and transport-failure cases;
- keep Native composition unchanged and authoritative for local inference.

Acceptance: Web can consume a real injected Intelligence transport without importing Native/local-AI/provider code, and still fails closed when none is configured.

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

### Phase 5 — release closure

- reconcile `docs/CURRENT-STATE.md`, `docs/INTELLIGENCE.md`, MVP/promotion gates and public wording;
- remove superseded Web stubs/tests only after their replacement path is proven;
- run canonical CI, disposable boot and final physical Stable/MVP proof.

## Current implementation slice

This branch implements Phase 1 only. It intentionally does not enable ChatGPT, OpenAI, xAI, voice, background autonomy, new grants, or a cloud inference service.
