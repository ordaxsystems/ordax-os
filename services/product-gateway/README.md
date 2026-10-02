# OrdaX Product Project Gateway

Status: **SOURCE FOUNDATION / FAIL-CLOSED / NOT DEPLOYED**

This gateway owns future server-authoritative product mutations shared by OrdaX
Web, Mobile and Product MCP. It is deliberately separate from the owner/development
Control Plane and from the public identity provider adapter.

The core currently exposes:

- `GET /product/status`;
- `POST /product/projects`;
- `POST /product/project-bindings`;
- `POST /product/remote-grants`.

Mutation routes require an authenticated OrdaX session, same-origin/CSRF
protection, JSON, a bounded payload and an idempotency key. The server-side
authority must return a receipt proving entitlement, approval and audit checks.

The default session resolver is anonymous and the default authority is disabled,
so source presence **does not enable public mutations**.

## Boundaries

The browser never receives a Supabase service-role key. Device bindings use an
opaque local project reference rather than a filesystem path. The gateway rejects
generic shell, raw disk, release-signing-key, implicit admin, cross-user/cross-Space
memory and unscoped GitHub authority before an adapter is called.

A later Supabase adapter may implement this interface using the already-applied
product schema, but the HTTP/product contract remains OrdaX-owned so the backend
provider can be migrated without changing Web/Mobile/MCP semantics.


## First-party product OAuth

First-party products such as Achegue-se use the OrdaX product identity boundary,
not the owner/development MCP authority.

The canonical source contract is:

- `docs/contracts/first-party-product-oauth.json`;
- `system/contracts/first-party-product-oauth.mjs`.

The first registered client is `acheguese`, but it remains
`runtime_enabled=false` until a real OAuth backend, exact HTTPS redirect URI,
Space authorization proof and revocation proof exist.

A first-party product authorization must bind:

`OrdaX subject + client id + explicit Space + exact scopes + audience`.

The server revalidates current Space membership. Only owner/admin authority may
establish the product link; member/viewer authority is insufficient.

Product MCP and first-party products may share a future OrdaX issuer, but they
must not share client registrations, audiences or bearer tokens. Development
Control Plane MCP credentials remain a separate authority entirely.


## First-party Network resource server

The initial Product OAuth read scopes now have a dedicated read-only resource
boundary in `oauth_network.py` with a server-only Supabase adapter in
`supabase_network.py`.

The resource server exposes only:

- `GET /product/network/v1/space` -> `network.space.read`;
- `GET /product/network/v1/directory` -> `network.directory.read`;
- `GET /product/network/v1/communities` -> `network.communities.read`.

It accepts only opaque OrdaX Product OAuth bearer tokens. The shared OAuth core
resolves the token and checks the exact scope before the resource adapter is
called. The server adapter sends only the token SHA-256 digest to PostgreSQL.
The Product Network RPCs then revalidate token, grant, client, scope and current
Space authority again before reading any Network row.

The selected Space read is subject-bound and may return the authorized Space's
own Network profile even when that profile is hidden from discovery. Directory
reads remain discoverable-only. Archived communities are excluded.

No write scope is implemented by this boundary. In particular
`network.messages.write`, `network.groups.join` and
`product.acheguese.publish` remain outside the resource server.

Source presence does not deploy a listener, enable the canonical Achegue-se
client or invent a production redirect URI.
