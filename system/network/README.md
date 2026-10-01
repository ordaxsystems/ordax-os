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


## Mutation API v2

Network write RPCs are moving to a typed result contract before public runtime
activation. The canonical source contract is
`docs/contracts/network-mutation-result-v2.json`, validated by
`system/contracts/network-mutation-result.mjs`.

The v2 contract distinguishes `applied`, `idempotent`, `rate_limited` and
generic `denied`. Validation and unexpected server failures remain actual RPC
errors. A rate-limited operation must return bounded retry metadata without
pretending the mutation succeeded, while the durable rate counter remains
committed.

The existing v1 RPCs remain compatibility-only until the generated Supabase
migration and executable PostgreSQL proof for v2 are complete.
