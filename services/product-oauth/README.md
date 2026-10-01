# OrdaX Product OAuth

Status: **SOURCE FOUNDATION / FAIL-CLOSED / NOT DEPLOYED**

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

A future server authority adapter owns persistence, secure random material,
hashing, atomic single-use code consumption, refresh rotation and revocation.

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
