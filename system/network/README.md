# OrdaX Network

OrdaX Network is the shared professional collaboration domain for Spaces.

It is intentionally separate from Profile Packs, account sync and Memory:

- Profile Packs may recommend communities but cannot auto-join or publish a Space.
- Account sync is not a chat/event transport.
- Memory never ingests conversations automatically.
- Memberships, roles, blocking and moderation are server-authoritative.
- Network unavailability never blocks boot or local OrdaX capabilities.

Canonical product plan: `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md`.

Machine-readable security/product boundary: `docs/contracts/network-foundation.json`.

Profile/community recommendations: `system/network/profile-affiliations.json`.



## Message content safety

Network messages are stored and transported as bounded **plain text**. The
machine-readable contract is `docs/contracts/network-message-content-v1.json`;
the shared parser/validator is `system/contracts/network-message-content-v1.mjs`.

The server rejects unsafe C0/DEL control characters before persistence or rate
consumption while preserving normal tab and line-break formatting. Client
renderers must never interpret message text as HTML or assign it to
`innerHTML`. Automatic links are limited to credential-free `http://` and
`https://` URLs; `javascript:`, `data:`, `file:`, `vbscript:` and other
schemes remain inert text. External anchors must use `noopener noreferrer`.

The executable Network gate validates both the shared content contract and the
PostgreSQL rejection path. The canonical Network schema is now applied to the
live `ordax-control-plane` database; message-send v2 uses this same plain-text
policy server-side. Public Network activation remains independently disabled.

## Mutation outcome v2 boundary

Network mutation APIs must not represent server rejection as `null` or `void`
success. The canonical source contract is:

- `docs/contracts/network-mutation-outcome-v2.json`
- `system/contracts/network-mutation-outcome-v2.mjs`

The v2 outcome vocabulary is explicit:

- `applied` — mutation committed and returns the canonical resource id;
- `idempotent` — retry resolved to an already committed canonical resource;
- `rate_limited` — mutation was not applied and includes bounded retry metadata;
- `denied` — authorization/policy rejected the operation;
- `invalid` — validation rejected the operation.

The v1 authority boundary is now deployed together with the six promoted v2
mutations: `message-send`, `direct-create`, `block-change`, `group-join`,
`report-create` and `group-create`. Every permanent v2 migration has its own
PostgreSQL 16 proof and preserves the public `SECURITY INVOKER` -> private
`SECURITY DEFINER` boundary with `search_path=''`.


### Idempotency for create-style mutations

`group-create`, `message-send` and `report-create` require client idempotency keys in v2.

For groups, the persisted schema scopes the key by the creating
`owner_space_id`; for reports, by `reporter_space_id`. Both columns are live
and deliberately nullable for legacy v1 rows while the v2 RPCs require valid
keys. Partial unique indexes over
`(owner_space_id, client_idempotency_key)` for groups and
`(reporter_space_id, client_idempotency_key)` for reports provide race-safe
retry resolution without rewriting historical rows.

Both schema changes were applied through the Supabase migration boundary after
their permanent migrations passed PostgreSQL proof, legacy-null compatibility
checks, privilege metadata checks and the post-deploy Security Advisor review.

### Retention and tombstones

The MVP policy is explicit and non-destructive for collaborative history:

- removing a Profile Pack does not mutate Network state;
- Space/account deletion removes Space-scoped directory/membership/block/rate
  edges that cannot remain authoritative without that Space;
- groups owned by a deleted Space retain their collaborative record, tombstone
  the owner, archive the group and close its group conversation;
- messages remain as collaborative history while sender Space/user attribution
  is tombstoned;
- reports and audit events remain while actor/reporter attribution is
  tombstoned;
- direct collaborative history is retained;
- there is no automatic time-based message purge and no user message-delete
  mutation in the MVP.

The machine-readable authority for this policy is
`docs/contracts/network-foundation.json`. Future retention changes require an
explicit contract/migration change; deletion behavior must not be inferred from
UI state.

## Client transport v2 boundary

The first same-origin client boundary for message delivery is defined by:

- `system/contracts/network-transport-v2.mjs`;
- `system/adapters/web/network-transport-v2.mjs`;
- `system/services/professional-network/send.mjs`.

The adapter targets `POST /network/v2/messages/send`, sends only the bound
sender Space, conversation id, bounded idempotency key and validated plain-text
body, and requires the canonical mutation outcome v2 response. It uses
`credentials: "same-origin"` and never calls Supabase tables or RPC endpoints
directly from Surface code.

The server-side route and `message-send v2` backend are deployed, but public
Network activation remains fail-closed. The current product composition does
not silently turn on remote messaging merely because the backend exists.
Failed, denied or rate-limited sends preserve the user's draft; only `applied`
or `idempotent` may clear it.


## Transport v2 server boundary

The same-origin message transport uses `POST /network/v2/messages/send`.
On Native, the loopback host validates request provenance and forwards only the
bounded JSON envelope through the existing authenticated account session
gateway. The Edge gateway accepts only that route and invokes only
`public.ordax_network_send_message_v2`; it does not expose a generic Supabase
RPC proxy.

Public-site Network activation remains independently fail-closed through
`PUBLIC_SITE_NETWORK_ENABLED=false`. Adding the server route does not activate
the Web composition and does not expose provider tokens to browser JavaScript.
