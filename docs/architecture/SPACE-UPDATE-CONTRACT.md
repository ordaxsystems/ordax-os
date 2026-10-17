# Space Update Contract

This is the compatibility contract for evolving Spaces after a base USB release.

## Stable base

The shipped Base/USB may know only the current major versions of the public Space contracts. Product updates must preserve those contracts until a deliberate major migration is introduced.

A newer product service may add data internally, but older clients must continue receiving a valid projection of the major contract they understand.

## Additive evolution

Prefer additive evolution below stable ports:

- add a new capability provider instead of expanding the Spaces read port;
- add a versioned action service for mutations instead of putting writes on `ordax.spaces/1`;
- add a new Profile Pack version instead of mutating an already published version;
- add domain resources behind explicit ownership instead of embedding vertical state into the Space record;
- add new experience metadata only when older clients can safely ignore it or through a new contract major.

## Degradation contract

A product update must remain safe when any of the following are older, offline, or unavailable:

- account backend;
- Space catalog endpoint;
- a vertical capability provider;
- Aura/Memory integration;
- a Profile Pack that is not needed by the current local workflow.

Expected degradation is read-only/unavailable/partial experience. It is not a boot failure.

## Mutation boundary

Create, rename, archive, restore, membership changes, invite operations, ownership transfer, and destructive deletion are server-authoritative actions.

Each mutation family should have:

1. a versioned request/response contract;
2. authenticated subject authority derived server-side;
3. Space membership/role revalidation where applicable;
4. idempotency for retryable creation/transition operations;
5. audit receipts for sensitive changes;
6. a read projection through the stable Spaces catalog after success.

## Version independence

The following versions may advance independently:

- Base/USB;
- Surface;
- Spaces read/action contracts;
- individual Profile Packs;
- capability providers/vertical services;
- Web/Mobile/native clients.

Compatibility adapters may bridge versions, but no layer may silently become a second SSOT.

## Release rule

A Space feature can ship after USB release when it respects the stable contracts and degradation rules above. A new Space feature requires a new USB image only when it truly needs a new Base/kernel/local-runtime capability that cannot be delivered through the normal OrdaX update mechanism.
