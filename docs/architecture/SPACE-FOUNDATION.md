# Space Foundation

This document defines the release-safe foundation for OrdaX Spaces.

## Principle

Space is a core product boundary, but it must never become a boot/runtime dependency for the OrdaX USB. A device must remain usable when Space services are unavailable, incomplete, or being updated.

The stable dependency direction is:

```text
Boot / Base / local runtime
        |
        v
Identity/session (optional for local use)
        |
        v
Spaces catalog + selection
        |
        v
Space experience projection
        |
        v
Domain capabilities / vertical services
```

No Space contract, provider, remote service, profile vertical, or account mutation may move upward into the boot-critical path.

## Canonical owners

- `system/contracts/spaces.mjs` owns the public read model exposed to product surfaces.
- `system/contracts/space-selection.mjs` owns the selected-Space projection.
- `system/contracts/space-experience.mjs` owns the experience/capability projection contract.
- `system/services/spaces/type-catalog.mjs` owns semantic Space type definitions.
- Profile Pack manifests own technical package composition; they do not own Space identity or authorization.
- Account/Identity and the server-side product backend own membership, authorization, quotas, lifecycle mutations, and ownership changes.
- Capability providers own domain data. A capability declared by a Space type is not considered available until a provider reports a valid `ready` snapshot.

## Compatibility rule

The `ordax.spaces/1` surface port remains read-only. Product mutation capabilities must be introduced through explicit, versioned action ports/services instead of adding write methods to the read port.

This preserves old Surface/USB builds while allowing account and Space management to arrive independently through updates.

## Release-safe states

The Space read model intentionally keeps lifecycle small:

- `active`
- `archived`

Operational readiness is a different concern and must not be encoded by adding boot-sensitive states to `Space.state`.

Space experience readiness is projected independently:

- declared semantics in the type catalog;
- provider availability at runtime;
- experience state calculated from the two.

A missing capability degrades only that capability. It must not invalidate the Space, block selection, or block the OS.

## Evolution rule for verticals

A Space type may describe the complete target shape of a vertical, including future capabilities, navigation, metrics, Aura context, and resources. The declaration is not a promise that every capability is currently implemented.

Surfaces must expose only capabilities backed by a valid provider. Therefore verticals can evolve incrementally by update without changing the base USB image or inventing parallel Space models.

## Ownership model

Every resource that can belong to a Space should carry an explicit Space ownership boundary (`spaceId` or an equivalent server-authoritative foreign key). Domain services remain the authority for their own resource schemas.

Examples include projects, files, jobs, orders, models, conversations, memory scopes, automations, and app state.

No domain service may infer cross-Space access from a client-provided owner id. Sensitive actions must revalidate the authenticated subject's current membership/authority server-side.

## Collaboration model

The global membership roles remain intentionally small:

- `owner`
- `admin`
- `member`
- `viewer`

Work functions such as `pizzaiolo`, `professor`, `financeiro`, or `operador-3d` belong to domain/People policies, not to the global identity role enum.

Invites are not memberships. Pending invites must remain separate entities until authenticated acceptance creates a server-authoritative membership.

## Update safety

The following changes are allowed to ship independently of the USB base:

- new Space types;
- new capability providers;
- new navigation/widgets derived from ready providers;
- membership/invite UX;
- Space management actions;
- resource ownership integrations;
- Aura/Memory Space-scoping;
- new Profile Pack versions.

The following are prohibited:

- requiring a remote Space service for boot;
- adding Surface-side direct database mutation;
- turning Profile Packs into authorization owners;
- exposing declared-but-unavailable capabilities as functional UI;
- creating per-vertical membership/identity systems;
- creating a second Space type SSOT in a deployment adapter or database projection.

## Launch gate

A USB release does not wait for every Space vertical to be complete. The Space foundation is launch-safe when:

1. boot and local runtime are independent from Space/network availability;
2. existing Space contracts remain backward compatible;
3. unavailable providers fail closed and degrade locally;
4. Space selection cannot cross authenticated subjects;
5. server-side creation/quota/authorization remain authoritative;
6. future Space work can land as versioned product updates without replacing the USB base.

Feature completeness for a specific vertical is a product gate for that vertical, not a base USB gate.
