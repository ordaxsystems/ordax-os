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
