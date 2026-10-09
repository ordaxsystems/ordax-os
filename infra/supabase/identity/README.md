# Supabase identity adapter preparation

This folder owns provider-specific preparation for the Supabase-backed OrdaX identity adapter.

The **account schema no longer lives here**. Account bootstrap, Spaces, entitlements, Profile Packs and Memory are owned by the product-domain migrations in `infra/supabase/product/`. This avoids two competing profile tables or two signup triggers.

## Current target

The dedicated `ordax-control-plane` Supabase project is the selected pre-MVP backend target. Its product foundation migration has been applied, but the public identity gateway remains fail-closed until deployment, Auth hardening and legal-readiness gates are complete.

The previously considered shared `Ordax-2026-1` project is not an identity target because it already has another product's `public.profiles` lifecycle and a signup trigger on `auth.users`.

## Safety boundary

Before changing an identity target:

1. run `preflight.sql` read-only;
2. reject unrelated signup triggers on `auth.users`;
3. ensure `public.ordax_accounts` belongs to the canonical product migration;
4. keep account/domain semantics provider-neutral;
5. review redirect URLs, email delivery, passkeys/password policy and leaked-password protection separately;
6. do not expose login/registration until same-origin session ownership and legal readiness are complete.

## Canonical product migration

The current account bootstrap is:

`infra/supabase/product/migrations/0001_product_foundation.sql`

It creates `public.ordax_accounts` and the single OrdaX product signup trigger together with the other pre-MVP product-domain tables.

Do not recreate `ordax_profiles`.

## Secrets

Do not commit service-role keys, JWT signing secrets, SMTP credentials, OAuth client secrets, provider access tokens or private redirect-state keys.

Browser-facing publishable configuration, when activated, must enter through runtime/deployment configuration rather than becoming a product secret.

## Public signup confirmation (2026-10-09)

Live evidence: the hosted Supabase project `ordax-platform` still generated
confirmation messages returning to `http://localhost:3000`. A verified
user exists, but the default provider callback is not a valid production
destination. This is an Auth-provider **configuration** defect, separate from
the public website deployment.

Single code owner: `../functions/_shared/account_email_confirmation.mjs`.
The inner gateway pins the public signup fallback to the canonical HTTPS
`/login/` page. For the preferred server-side flow, publish the bundled
`email-templates/confirmation.html` as the hosted Supabase **Confirm signup**
template, and use a sender configured with custom production SMTP; the
template uses `{{ .TokenHash }}` and links directly to
`https://ordax.com.br/auth/confirm`, not a Supabase-hosted verification
redirect that appends session tokens in a fragment.

The public `GET /auth/confirm` exchanges the one-time token hash using
`verifyOtp({ type: "email" })`, revokes the resulting temporary session,
and redirects back to `/login/` with a fixed success/error code. No tokens
are sent to the browser or persisted by the site. Invalid, expired or reused
hashes fail closed. Existing Supabase links may produce URL fragments:
the login page erases those fragments without reading/storing any token.

Provider operator (production project **ordax-platform**, NOT the legacy
`ordax-control-plane`):
1. Authentication > URL Configuration: set Site URL to
   `https://ordax.com.br`; allowlist exact `https://ordax.com.br/login/`
   (signup fallback) and `https://ordax.com.br/auth/recover/verify`
   (future recovery). Do not retain localhost or wildcard production redirects.
2. Authentication > Email Templates > Confirm signup: install the reviewed
   OrdaX HTML from this repository; set subject to
   `Confirme seu e-mail — Conta OrdaX`.
3. Authentication > SMTP Settings: configure a verified authorized SMTP
   domain/sender with OrdaX name; the HTML template alone cannot remove the
   default "Supabase Auth" sender.
4. Deploy the inner gateway source and the imported shared file together,
   then verify the public signed gateway, review the hosted Auth settings
   via `tools/public-site/probe_auth_provider.py`, and test a **new**
   signup confirmation E2E. Do not report success from source tests alone.
5. Invalidate any session credentials exposed in copied confirmation links.
   Never put bearer/refresh tokens or recovery codes into issues, logs or docs.

Do not use SQL as a replacement for changing Auth hosted configuration.
