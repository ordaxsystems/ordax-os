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

## Resend transactional SMTP — operator state (2026-10-09)

Verified sending domain: `auth.ordax.com.br`, Resend region `sa-east-1`
(DKIM, SPF and return path verified). Cloudflare owns the DNS records,
with an initial monitoring DMARC policy. Sending only; receiving disabled;
enforced TLS; no open/click tracking. The main website DNS and MX were not
modified.

Canonical expected SMTP settings are owned by
`docs/contracts/public-auth-provider-policy.json#transactional_email`.
In the hosted Supabase project **ordax-platform**, configure:
- **Authentication / SMTP Settings**: custom SMTP enabled; host
  `smtp.resend.com`, port `465`, username `resend`, sender email
  `no-reply@auth.ordax.com.br`, sender name `OrdaX`, and a *sending-only,
  domain-restricted Resend API key* as SMTP password. Never put that password
  in GitHub, JS, migrations, logs or source.
- **Authentication / URL Configuration**: Site URL
  `https://ordax.com.br` and exact redirect URLs
  `https://ordax.com.br/login/` and
  `https://ordax.com.br/auth/recover/verify`. Remove development localhost
  or cross-origin wildcard redirects on production.
- **Authentication / Email Templates / Confirm signup**: use
  `email-templates/confirmation.html` and the subject
  `Confirme seu e-mail — Conta OrdaX`.

Deployed **ordax-account-gateway** v11 is ACTIVE in `ordax-platform`
with the server-side signup callback and canonical redirect. The provider's
SMTP settings, Site URL and confirmation HTML are **still pending**:
DNS validation and a deployed gateway do not prove successful delivery.

`tools/public-site/probe_auth_provider.py` validates the hosted management
settings and produces sanitized pass/fail fields, never SMTP secrets.
The older `public-auth-provider-live-proof.yml` target resolver may still
select the former project from incomplete cutover contracts; do not cite it
as the destination's production proof until the provider SSOT is reconciled.
A real new-email signup, confirmation and login end-to-end test is still
required after SMTP activation.

## Password recovery transport (2026-10-09)

The canonical recovery email uses the same server-side, isolated Auth gateway
pattern as the confirmed signup flow. Source of truth:
`../functions/_shared/account_email_confirmation.mjs` (one-time hash parsing
and fixed HTTPS `https://ordax.com.br/auth/recover/verify`).
The public Vercel proxy forwards only the exact `token_hash` and
`type=recovery` to the signed Supabase chain, with `Referrer-Policy:
no-referrer`. The token hash is never stored in browser JavaScript, session
storage, analytics or logs. Its validity is verified by Supabase Auth, not
by matching the hash length alone.

**Operational gate remains closed on purpose**: both
`ACCOUNT_RECOVERY_REQUEST_ENABLED` and
`ACCOUNT_RECOVERY_COMPLETION_ENABLED` are false and the public runtime
still lists `recovery_url: null` / `recovery_complete_url: null`.
Publish `email-templates/recovery.html` into the hosted Supabase
**Reset Password** Auth email template, subject
`Redefina sua senha — Conta OrdaX`, and verify the provider redirect
allowlist includes the exact canonical URL (not localhost). Check the
provider's custom SMTP Resend settings before activation. Once proven,
activate both server gates and the public form configuration in a reviewed
follow-up and test real reset end-to-end with a disposable account. A
synthetic token test cannot prove real recovery delivery or password update.
