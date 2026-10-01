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
