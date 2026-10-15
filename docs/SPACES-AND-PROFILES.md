# Spaces and Profiles

Status: ACTIVE DESIGN / USER-EXPERIENCE DIRECTION

This document clarifies the product boundary between **Space** and **Profile Pack** and defines the preferred user-facing creation flow.

## Core distinction

```text
Profile Pack = versioned composition/template
Space        = real user/business workspace and its data
```

A Profile Pack can declare apps, templates, Knowledge/Skill Packs, connectors, Intelligence defaults and capability requirements. It is not the user's business data and it is not another account.

A Space is the actual environment where the user works. Orders, customers, files, projects, operational data, Memory and settings belong to the appropriate domain/owner inside that Space.

Multiple Spaces may use the same Profile Pack without sharing data.

Example:

```text
Space "Pizzaria Centro"   -> pizzaria-br@1
Space "Pizzaria Shopping" -> pizzaria-br@1
```

The two Spaces use the same composition but keep their customers, orders, stock, staff and settings isolated.

## Preferred user-facing flow

The normal user must **not** need to understand or choose a Profile Pack as a separate technical step.

Preferred creation experience:

```text
Criar Space
  -> escolher tipo
       Pizzaria
       Impressão 3D
       Empresa
       Desenvolvimento
       ...
  -> informar nome/dados mínimos
  -> OrdaX cria o Space
  -> OrdaX resolve o Profile Pack canônico daquele tipo
  -> provisiona/revisa componentes permitidos
  -> ativa a composição após os gates/consentimentos exigidos
  -> abre o novo Space
```

For example:

```text
Usuário escolhe: Pizzaria
        |
        v
criar Space profissional
        |
        v
aplicar composição pizzaria-br@1
        |
        v
Space "Minha Pizzaria"
```

For 3D printing:

```text
Usuário escolhe: Impressão 3D
        |
        v
criar Space profissional
        |
        v
aplicar composição impressao-3d-br@1
        |
        v
Space "Minha Produção 3D"
```

## UX rule

For mainstream product UX:

- the user chooses a **type of Space**;
- the OrdaX resolves the corresponding Profile Pack automatically;
- technical identifiers such as `pizzaria-br@1` and `impressao-3d-br@1` stay internal/advanced;
- the UI may explain the included composition before confirmation when permissions, downloads, entitlements or costs are involved;
- activation never bypasses trust, permission, entitlement, provisioning or consent gates;
- there is no second identity or second runtime per Profile.

The concept **Profile Pack** may still appear in advanced/admin/developer surfaces for review, versioning, activation status, rollback, debugging and composition management. It should not become a mandatory concept the ordinary user must learn before creating a professional Space.

## Technical separation remains mandatory

Simplifying the UX does not merge the underlying objects.

```text
Space
  -> stable identity and business/user data
  -> selected/active Profile composition metadata

Profile Pack
  -> slug + version
  -> declarative composition
  -> no ownership of user/business data
```

This separation enables:

- two or more businesses using the same Profile independently;
- Profile upgrades without recreating the Space;
- rollback of composition without rolling back user data;
- changing or extending composition under explicit migration/policy;
- reusable horizontal apps/capabilities across Pizzaria, Impressão 3D and future verticals.

## Versioning

`pizzaria-br@1` means the first version of the technical Pizzaria composition. `impressao-3d-br@1` follows the same rule.

A future version can coexist:

```text
pizzaria-br@1
pizzaria-br@2
```

Updating the Profile Pack must not create a new Space automatically and must not erase business data.

## Horizontal capabilities

A Profile should compose/recommend shared capabilities rather than duplicate them inside every vertical.

Examples:

- Files / Projects;
- Intelligence;
- People / Workforce;
- Payments;
- Finance;
- Inventory / CRM owners where shared;
- Operational Realtime;
- Device Agent / Action Gateway where hardware is involved.

Therefore Pizzaria and Impressão 3D can consume the same horizontal capability while keeping their vertical domain logic separate.

## Creation and activation are different operations internally

The product may present one simple flow, but implementation must preserve explicit boundaries:

1. create/authorize the Space;
2. resolve the requested Space type to an allowed Profile Pack identity;
3. validate compatibility/entitlements;
4. produce a provisioning plan;
5. show permission/cost/download diff when required;
6. install/stage verified components;
7. activate composition;
8. health-check;
9. open/select the Space.

Failure in Profile provisioning must not silently corrupt or recreate the Space. If activation cannot complete, the product must expose a safe recoverable state.

## Existing MVP boundary

The current MVP already has bounded Profile Pack candidates such as `pizzaria-br@1` and `impressao-3d-br@1`. Their current small compositions remain governed by MVP/Profile owners.

This UX direction does **not** expand the current MVP into the complete commercial Food or Fabrication products. It only establishes how the future user-facing Space creation flow should map to the existing Profile architecture.

## Rule for future implementations

Do not build a public flow that requires the ordinary user to perform both:

```text
Criar Space
+ escolher/aplicar Profile em uma segunda unrelated step
```

when the requested Space type already has one canonical default Profile.

Default path:

```text
Escolher Space Pizzaria -> Profile Pizzaria aplicado pelo OrdaX
Escolher Space Impressão 3D -> Profile Impressão 3D aplicado pelo OrdaX
```

Advanced composition changes remain a separate expert capability and must be permissioned/versioned.


## Capability-driven Space projection foundation — 2026-10-15

The source now keeps four responsibilities explicitly separate:

```text
Profile Pack
  -> versioned technical composition

Space type (`domain.subtype`)
  -> domain/UX semantics and the set of capabilities that are allowed to exist

Capability provider
  -> whether that capability is actually available for this Space now
  -> provider-owned metrics/context

Surface projection
  -> contextual navigation + dashboard/widgets + global Spaces card metrics
  -> only from ready providers; never from type names alone
```

The canonical semantic catalog is `system/services/spaces/type-catalog.mjs`. The deterministic projection is owned by `system/services/spaces/composition.mjs`, with versioned contracts in `system/contracts/space-experience.mjs`. Profile Pack manifests intentionally do **not** duplicate Space navigation, dashboard schemas or provider availability.

A declared capability is not an entitlement, grant, installed component or live data source. For a contextual item to appear, its provider must return a valid `ready` snapshot for the same authorized Space. A missing, unavailable, malformed or failing provider removes that capability from the projection without breaking Surface. A dashboard/card metric is rendered only when that ready provider supplies the exact metric; zero is valid data, absence is not converted into a fabricated zero.

The global OrdaX sidebar remains independent of this projection. Space-specific navigation is contextual data returned by the Space experience composition and must never replace or mutate the global shell navigation.

Aura uses the same rule. `aura.summary` can appear only through a ready Aura capability provider. Context is accepted only when it is bound to the current Space; Aura remains consultative and never becomes the transactional source of orders, users, printers, students, payments or other domain state.

Current structured types:

| Space type | Source status | Runtime promotion in this foundation |
| --- | --- | --- |
| `food.pizzeria` | MVP structural foundation | eligible for provider-backed projection; no operational provider is invented |
| `fabrication.3d-printing` | MVP structural foundation | eligible for provider-backed projection; no operational provider is invented |
| `product-operations.territorial-platform` | structured | `DEFERRED`; emits no contextual navigation/widgets |
| `education.school` | structured | `DEFERRED`; emits no contextual navigation/widgets |
| `development.software` | structured | `DEFERRED`; one Space can contain many Projects; Studio is only the project-opening tool |

For the current Pizzaria and Impressão 3D showcase Spaces, the resolver may derive `domain.subtype` from the existing canonical Profile binding while the account backend does not yet persist explicit Space semantics. `ordax.spaces/1` also accepts explicit `domain` + `subtype` together for the future canonical backend projection. This compatibility fallback resolves semantics only; it never makes a capability available.

The Development definition models `project` as a many-valued resource owned by the Space and opened with Studio. A repository is not promoted to a Space merely because it exists, and Studio does not become the owner/SSOT of the Project.

The 3D-printing type declares Jobs as domain resources but does not implement a fabrication owner in this foundation. When that owner is promoted, reprinting must append a new Job and preserve prior Job/history records; a reprint is never modeled as deleting or rewriting the original production history. The Pizzaria type deliberately does not declare `quotes` because no current real owner justified that capability.

### Deferred safety constraints

The structured School definition does not promote the vertical and does not create `orders`. REL-001 remains binding: external student/guardian identities are not internal Space members. No unrestricted camera/tracking capability is introduced; transport remains a separate declared capability and still requires its own consent, purpose and owner before promotion. Data about minors is not an advertising/targeting source.

The structured Achegue-se definition remains an operational product-operations Space, not a development Space. `offers`, `jobs_publications` and `orders_public` are only declared possibilities and remain invisible until the corresponding real owner/provider is promoted. The product boundary remains: Achegue-se discovers/connects; OrdaX organizes/operates; product SSOTs remain independent.
