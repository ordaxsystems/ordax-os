# OrdaX Public Identity Gateway

Status: GATEWAY DEPLOYED / DEDICATED SUPABASE TARGET ACTIVE / PUBLIC SAME-ORIGIN ACTIVATION GATED

This directory defines the backend responsibility that will sit behind the public site's login and registration entry points.

It is intentionally separate from:

- `sites/public/`, which is static presentation;
- `system/services/account/`, which owns product-side account semantics;
- any specific identity vendor.

## Intended flow

```text
sites/public/login or cadastro
 -> same-origin /auth/* entry
 -> OrdaX public identity gateway
 -> provider adapter
 -> canonical OrdaX account/session
```

The public page must not become the identity authority. The gateway owns provider handoff, callback validation, session establishment, logout and account bootstrap.

## Required routes

The gateway core in `gateway.py` now exposes this contract:

```text
GET  /auth/login
POST /auth/login
GET  /auth/register
POST /auth/register
POST /auth/recover
POST /auth/logout
GET  /auth/session
GET  /sync/snapshot
GET  /sync/changes
POST /sync/mutate
GET  /sync/objects   # compatibility full-read route
```

GET login/register routes lead only to the canonical same-origin pages. Credential POST, account sync and authenticated session behavior fail closed when runtime provider configuration is absent. `/auth/session` remains anonymous/unconfigured in that state. The deployed Edge Function is the current Native/USB backend adapter; browser publication still requires an OrdaX-owned same-origin routing boundary.

The public site configuration therefore keeps login/register disabled until these routes are deployed behind the same origin. The runtime shape is pinned in `docs/contracts/public-identity-gateway.json`.

## Password recovery boundary

`POST /auth/recover` is source-implemented but deliberately disabled in the
gateway until a complete server-owned PKCE recovery flow exists. Merely
configuring a redirect URL must not activate recovery.

The request path requires a clean HTTPS redirect and normalizes provider-level
account lookup responses so the public API does not reveal whether an email is
registered. The completion path is still pending: the recovery Auth Code and
PKCE verifier must be exchanged server-side and any resulting provider tokens
must stay in HttpOnly cookies rather than browser JavaScript.

Until that completion path, redirect allowlist and real HTTPS origin are
verified, `ACCOUNT_RECOVERY_REQUEST_ENABLED` remains false and the public
server gate remains disabled.

## Session policy

Production sessions must:

- use secure transport;
- prefer HttpOnly cookies so browser JavaScript does not own bearer tokens;
- use Secure cookies in production;
- use SameSite=Lax by default unless a reviewed flow requires otherwise;
- validate callback state/PKCE data;
- support revocation;
- avoid placing tokens in URLs, logs or analytics.

## Provider independence

A provider adapter may initially use Supabase Auth, but public routes and account semantics must remain OrdaX-owned.

The provider may not redefine:

- one-account-across-product-modes;
- entitlements;
- sync data classification;
- device/session revocation semantics;
- account deletion/export rules.

## Current provider decision

The dedicated Supabase project `ordax-control-plane` is now the selected pre-MVP provider target. The product-domain foundation from `infra/supabase/product/migrations/0001_product_foundation.sql` has been applied there and owns the single `ordax_accounts` bootstrap.

The previously suggested shared `Ordax-2026-1` project remains rejected for OrdaX identity because it already has another product's `public.profiles` lifecycle and an unrelated signup trigger.

The provider-specific email/password adapter in `supabase_password.py` and account-sync adapter in `supabase_sync.py` use only the Supabase publishable key plus the authenticated user's bearer token. Passwords are transient request inputs; provider tokens stay in HttpOnly cookies owned by the gateway and are never returned to Surface JavaScript.

**Target prepared does not mean public identity enabled.** Login and registration are gated independently. The server-authoritative registration receipt boundary is now implemented and applied: a backend-only legal intent is bound to the active canonical legal policy and normalized-email SHA-256, and the existing single `auth.users` trigger must atomically consume that intent and persist the Privacy/Terms snapshot when the account row is created. No active legal policy is seeded. The Web and Native acceptance UI is now source-bound to a service-role-only active-policy projection and submits only affirmative acceptance; registration remains disabled across Surface/Native/gateway until an approved active policy and the remaining public gates exist. Client-supplied document versions are never authority. The gateway still fails closed until all of the following are true:

- a same-origin production deployment owns the session cookie;
- the Supabase runtime configuration is supplied outside source;
- Auth redirect/email settings are reviewed;
- leaked-password protection and the chosen password/passkey policy are hardened;
- public privacy/terms readiness is complete;
- login/register routes pass end-to-end tests.

The product domain remains provider-neutral, so the Supabase project can later be migrated without changing Surface account semantics.

## Current rollout boundary

- no public same-origin identity surface is enabled yet;
- no public password form is activated until the security/legal gates pass;
- no service-role or private provider key is committed;
- product migrations and the account gateway are applied only to the dedicated OrdaX control-plane project;
- public account/sync availability is not claimed until same-origin browser hosting, Auth hardening and end-to-end device proof pass.


## Deployed account gateway adapter

The dedicated `ordax-control-plane` project now has the
`ordax-account-gateway` Edge Function deployed from gateway source v16 as revision 22. Its source-controlled owner is
`infra/supabase/functions/ordax-account-gateway/index.ts`.

The function deliberately has platform JWT pre-verification disabled because
`/auth/login` and `/auth/register` must accept unauthenticated requests. It
implements its own account/session boundary and validates sessions through
Supabase Auth. User/session/sync reads and mutations continue to use the signed-in
user's JWT and RLS-scoped RPCs. The only privileged write added to this gateway is
the backend-only registration legal-intent RPC plus the read-only active-policy projection RPC; it prefers the platform-provided
Supabase secret key (with legacy service-role fallback for compatibility), never
ships that key to browser/Surface code, and the RPC itself is executable only by
the backend service role. The public `/auth/registration-policy` route exposes only the validated active/effective document metadata and the server registration switch; it never exposes provider secrets or grants registration authority.

Native/USB consumes the provider-neutral gateway base URL from the signed
system configuration `system/services/account/gateway-base-url`. Browser
public rollout still requires a same-origin hosting/rewrite boundary; direct
cross-origin browser use is not the public contract.


## Incremental sync transport

The sync protocol separates per-object conflict revision from account-wide change
progress. The first client reconciliation reads one atomic snapshot containing
both the current objects and its baseline cursor. Later reconciliations use the
immutable mutation log through an opaque monotonically increasing change
cursor. Web and Native/USB persist that cursor together with per-object server
revisions and bind the checkpoint to the authenticated subject. A subject
mismatch forces a fresh snapshot. If Native durable checkpoint storage is
temporarily unavailable, the sync runtime degrades to a session checkpoint
instead of making boot depend on cloud continuity.

`/sync/objects` remains a compatibility full-read route; it is no longer the
authoritative incremental mechanism.
