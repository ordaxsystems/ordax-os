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
PostgreSQL rejection path. This is still source/proof-only and does not deploy
Network schema to the live product database.

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

This source contract does not activate a new database RPC by itself. Schema/API
implementation must preserve the already-proven v1 authority boundary and add a
separate executable PostgreSQL proof before rollout.


### Idempotency for create-style mutations

`group-create`, `message-send` and `report-create` require client idempotency keys in v2.

For groups, the future persisted schema scopes the key by the creating
`owner_space_id`; for reports, by `reporter_space_id`. Existing v1 rows must
remain migratable, so both planned columns stay nullable for legacy data while
the v2 RPCs require valid keys. Partial unique indexes over
`(owner_space_id, client_idempotency_key)` for groups and
`(reporter_space_id, client_idempotency_key)` for reports provide race-safe
retry resolution without rewriting historical rows.

This remains source/proof-only until the migration is generated through the
official Supabase migration tooling and passes advisors plus PostgreSQL proof.


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

This is a **source boundary, not a live backend activation**. Native and Web
compositions intentionally do not instantiate this transport until the
generated v2 backend migration/API exists and has passed the executable
PostgreSQL, advisor and security gates. Failed, denied or rate-limited sends
must preserve the user's draft; only `applied` or `idempotent` clears it.


### Current v2 proof coverage

Executable ephemeral-PostgreSQL proofs currently cover:

- `group-create`;
- `group-join`;
- `direct-create`;
- `message-send`;
- `block-change`;
- `report-create`.

The remaining mutation boundaries are `space-profile-upsert`,
`community-join`, `community-leave`, `group-leave` and
`conversation-mark-read`. Read-only list operations do not require a mutation
outcome. None of these proofs is a live migration or production rollout.
