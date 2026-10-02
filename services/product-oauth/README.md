# OrdaX Product OAuth

Status: **PERSISTENT AUTHORITY SOURCE READY / FAIL-CLOSED / NOT DEPLOYED**

This boundary is the OAuth authority protocol for end-user and first-party
products such as Achegue-se. It does not reuse the owner/development MCP OAuth
credential domain.

The provider-neutral core in `oauth.py` owns validation only:

- exact registered redirect URI;
- authenticated same-origin consent;
- CSRF;
- explicit Space selection;
- client scope allowlist;
- PKCE S256;
- current Space authorization revalidation at code exchange and token use;
- bounded access-token lifetime;
- revocation delegation.

The server authority adapter in `supabase_authority.py` now owns secure random code/token material, SHA-256 hashing, atomic single-use code consumption, bounded access-token issuance and revocation through the server-only Supabase RPC boundary. Raw codes/tokens never enter PostgreSQL. Refresh tokens remain disabled until rotation is implemented and proven.

The default authority is disabled. Source presence does not expose an OAuth
listener and does not enable Achegue-se runtime linking.

## Relationship to Product Gateway

`services/product-gateway/` remains the server-authoritative mutation boundary.
Product OAuth should eventually resolve a token into a bounded authorization
context that Product Gateway/API adapters can consume. OAuth must not become a
second product authorization system.

## First-party Achegue-se flow

```text
Achegue-se server
    |
    | authorization code + PKCE S256
    v
OrdaX Product OAuth
    |
    +-- authenticated OrdaX Account
    +-- explicit eligible Space
    +-- exact client + redirect URI
    +-- explicit scopes
    v
bounded product authorization
```

No password sync, no Supabase provider token sharing and no client-side
`service_role` credential are permitted.

## Persistent authority v1

The source-controlled migration `20261002140612_product_oauth_authority_v1.sql` stores the client registry, authorization-code digests, grants and access-token digests in the private schema. All private tables have RLS enabled and no direct grants to browser roles or `service_role`; server access is limited to explicit public RPCs granted only to the server role.

The canonical Achegue-se client identity is seeded as `acheguese-web-01`, but it is deliberately `disabled` with an empty redirect allowlist. Only the three initial read scopes are registered. A real HTTPS redirect URI and public activation require a later reviewed migration after the Account/public-origin gates are proven.

The adapter uses a dedicated backend Supabase secret key through the `apikey` header only. It never places an `sb_secret_*` key in `Authorization: Bearer`, never exposes it to browser code and does not auto-enable from source presence.
