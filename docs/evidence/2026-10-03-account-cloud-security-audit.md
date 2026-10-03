# Account Cloud Security Audit — 2026-10-03

Status: EVIDENCE, NOT SOURCE AUTHORITY

This snapshot records a live read-only inspection of the dedicated OrdaX Supabase backend plus the current source contracts. Canonical behavior remains owned by the machine-readable contracts and `main`.

## Backend observed

- adapter: Supabase;
- dedicated project: `ordax-control-plane`;
- project health: active/healthy at inspection time;
- public account activation: disabled by OrdaX source/contracts;
- Cloud Memory public rollout: disabled by OrdaX source/contracts.

No secrets, tokens, account identifiers or user payloads are recorded here.

## Product data authorization

The inspected product-domain tables use RLS and authenticated clients currently receive narrow read grants. Sensitive mutations such as entitlement changes and cloud-domain writes remain server-authoritative through OrdaX gateways/RPCs rather than direct client table mutation.

Generic advisor findings that report `RLS enabled with no policy` must not be fixed by adding permissive policies automatically. Several server/operator tables intentionally use no client policy as a deny-all boundary. Every finding must be classified by owner and expected client surface.

## Authentication hardening

The provider security advisor reports built-in leaked-password protection unavailable/disabled on the currently observed provider plan. OrdaX already performs fail-closed HIBP Pwned Passwords k-anonymity screening for new passwords in its account gateway, but live provider policy and end-to-end account proofs remain release gates.

Public registration/login/recovery/close switches remain disabled. This is the correct state until same-origin deployment, rate-limit/client-IP behavior, final legal policy, recovery, session revocation and lifecycle proofs pass.

## Registration acceptance discrepancy

The Python gateway source validates `legal_acceptance=accepted` server-side before requesting a legal registration intent. The current TypeScript Edge gateway reads the field but does not yet reject a missing/wrong value before calling the server legal-intent RPC with `p_accepted: true`.

Public registration is disabled, so this is recorded as a **latent activation blocker**, not as a currently public exploit path. Registration must not be enabled until the Edge path enforces the same server-side validation and a negative regression proof exists.

## Object storage

At inspection time the only Storage bucket was the private engineering bucket `surface-captures`, limited to PNG captures. No end-user cloud-files bucket exists.

MVP user object storage therefore requires a new private boundary with:

1. canonical transactional object metadata;
2. server-side upload reservation;
3. server-authoritative quota admission;
4. opaque provider object key;
5. short-lived upload authorization;
6. exact size/SHA-256 finalization;
7. negative cross-account/cross-Space isolation tests;
8. delete/export/account-close lifecycle;
9. no public bucket and no permanent public object URL.

Supabase Storage is the initial adapter target because it shares the current account backend. Cloudflare R2 or another store may later replace/complement the blob layer without changing OrdaX ownership, quota or object identity semantics.

## Release conclusion

Account + bounded cloud continuity + Cloud Memory account/Space + private user-selected object storage are now treated as MVP release work. They remain optional for local/offline OS use. Pricing and billing activation are independent commercial decisions and are not authorization substitutes.
