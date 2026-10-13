# OrdaX public auth-only runtime observation — 2026-10-13

## Scope

This is a read-only observation of the canonical public origin `https://ordax.com.br`.
It updates the network-facing observation in `docs/contracts/public-site-deployment.json`.
It is **not** a credentialed login/signup proof, a signed Vercel OIDC provenance proof,
or authorization to activate full Account, Cloud, recovery, export or account closure.

## Canonical HTTP observations

Observed on 2026-10-13 without account credentials:

| Request | HTTP | Observed contract/state |
| --- | ---: | --- |
| `GET /` | 200 | canonical public site reachable |
| `GET /login/` | 200 | static login entry reachable |
| `GET /cadastro/` | 200 | static registration entry reachable |
| `GET /recuperar/` | 200 | static recovery information route reachable |
| `GET /auth/session` | 200 | anonymous Supabase-backed public identity session projection |
| `GET /auth/registration-policy` | 200 | active registration policy projection, registration enabled |
| `GET /sync/snapshot?limit=1` | 503 | `public-account-access-disabled` |
| unknown static route | 404 | fail-closed static routing |

`GET /auth/session` returned schema
`prototype-ordax.public-identity-session/1`, `authenticated=false`,
`provider=supabase`, `status=anonymous`, and `accountCloseEnabled=false`.

`GET /auth/registration-policy` returned schema
`prototype-ordax.registration-legal-policy/1`, `active=true`,
`registrationEnabled=true`, policy id
`2b4e5863-26a5-4d0a-b7be-48782e9b9082`, with privacy and terms version
`2026.10.09` and effective date `2026-10-09`.

`GET /sync/snapshot?limit=1` returned schema
`prototype-ordax.public-identity-error/1`, HTTP 503 and
`error=public-account-access-disabled`.

## Runtime configuration observed

`GET /config/public-site.json` returned HTTP 200 with:

- `identity.login_url=/auth/login`
- `identity.register_url=/auth/register`
- `identity.recovery_url=null`
- `identity.recovery_complete_url=null`
- `legal.account_activation_ready=false`
- `legal.auth_only_source_enabled=true`
- `product.web.enabled=false`

The canonical state is therefore **auth-only** for public login/signup entry,
while full Account/Cloud and password recovery remain disabled.

## Explicit non-claims

This observation does **not** set or imply any of the following:

- `target_runtime_oidc_e2e_verified=true`
- full public account routes available
- password recovery operational
- sync operational for anonymous users
- account export or account closure operational
- credentialed signup/login E2E passed
- session revocation E2E passed
- Turnstile Siteverify E2E passed
- legal-integrity deployment proof passed

Those remain governed by their stronger owners and gates.

## Deployment state of the current site UX work

The source-side Account UX work is separately validated by canonical CI, but the
current Vercel project is refusing new deployments because of its build/deployment
rate limit (`Deployment rate limited — retry in 24 hours`). No alternate Vercel
project, host, domain or authentication boundary was introduced to bypass that
provider limit.

Consequently, source readiness and canonical production publication remain
separate facts.
