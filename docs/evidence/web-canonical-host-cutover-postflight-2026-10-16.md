# OrdaX Web canonical host cutover — postflight — 2026-10-16

## Scope

This receipt closes only the infrastructure/topology part of the canonical Web host cutover. It does not activate the public Web entry and does not claim the authenticated browser lifecycle is complete.

Observed source baseline: `6fb3a8930bb54aeb0a765f5d6f2f24b9d9969fcf` on `main`.

## Verified production topology

- `web.ordax.com.br` is verified on Vercel project `ordax-web` (`prj_ftACluUqk6i9DoD9GPIwmgURwckP`).
- The same project-domain is absent from `ordax-os-public`; the former ownership is no longer current.
- Current `ordax-web` production deployment observed READY: `dpl_AhNevF4Cyo2VCosTPUELs9AbdRAx`, source commit `6fb3a8930bb54aeb0a765f5d6f2f24b9d9969fcf`.
- `https://web.ordax.com.br/` returns the OrdaX Web artifact at `/` with the expected security headers.
- `https://web.ordax.com.br/login/` returns the canonical Account-derived Web login surface.
- `https://web.ordax.com.br/auth/session` returns HTTP 200 with an anonymous session and `Cache-Control: no-store` when no authenticated session is present.
- `https://ordax.com.br/` continues to return the public OrdaX portal.
- The authoritative Cloudflare Turnstile widget allowlist contains exactly `ordax.com.br`, `web.ordax.com.br` and `www.ordax.com.br` for these canonical account surfaces.

No DNS record was changed as part of this postflight. No temporary alias, proxy, shared-secret fallback, auth bypass or alternate production path was introduced.

## SSOT reconciliation

The machine-readable deployment owner remains `docs/contracts/public-site-deployment.json`. This postflight changes that owner only where production facts had become stale:

- `domain_project_move_pending` becomes `false`;
- `domain_current_project` becomes `ordax-web`;
- Turnstile `hostname_allowlist` is reconciled with the authoritative widget configuration.

The preflight receipt `docs/evidence/web-canonical-host-cutover-preflight-2026-10-16.md` remains historical evidence and is intentionally not rewritten.

## Gate intentionally still closed

The public Web entry remains fail-closed. Do not set `sites/public/config/public-site.json` to enabled until one real production browser session proves, on the canonical Web host, all of the following in sequence:

1. successful Turnstile-backed login;
2. `/auth/session` becomes positively signed in;
3. authenticated `/account/spaces` succeeds;
4. reload/refresh preserves the authorized session without exposing credentials in URL, `localStorage` or `sessionStorage`;
5. logout/revocation clears the product cookies and returns `/auth/session` to anonymous.

Until that proof exists, `production_e2e_verified` remains `false` and public activation remains blocked. This is a deliberate safety gate, not a pending topology migration.
