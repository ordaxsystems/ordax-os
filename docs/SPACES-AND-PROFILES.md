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
The source now has an authority-free **creation preflight** before step 1 mutates anything. For an MVP-foundation type, that preflight resolves only an explicit exact default Profile identity (currently `pizzaria-br@1` or `impressao-3d-br@1`) against the real published Profile catalog. It never chooses an alias, "latest" version or first matching binding. Deferred/unknown types and missing exact Profiles fail closed. The preflight exposes no Space-create, Profile-provision or activation authority; successful resolution only hands off to the existing Profile provisioning validation path.

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

User-facing Space type identity is resolved by `system/services/spaces/presentation.mjs` from the canonical catalog. Explicit `domain/subtype` always wins. A Profile Pack binding may identify the type only for legacy rows that have no explicit semantics; an unknown explicit type never falls back to the Profile Pack. Surface components consume the localized type message id and may show Profile state only as secondary technical context.

A declared capability is not an entitlement, grant, installed component or live data source. For a contextual item to appear, its provider must return a valid `ready` snapshot for the same authorized Space. A missing, unavailable, malformed or failing provider removes that capability from the projection without breaking Surface. A dashboard/card metric is rendered only when that ready provider supplies the exact metric; zero is valid data, absence is not converted into a fabricated zero.

Capability names are not globally unique owners. Every provider must declare the exact `spaceTypes` it serves. Multiple providers may implement the same capability only when their Space-type scopes are disjoint; the compositor selects by `capability + space type`. This keeps, for example, future Food `orders` and Fabrication `orders` from becoming interchangeable merely because both verticals use the word `orders`.

The global OrdaX sidebar remains independent of this projection. Space-specific navigation is contextual data returned by the Space experience composition and must never replace or mutate the global shell navigation.

Aura uses the same rule. The Native composition now registers `system/services/spaces/aura-provider.mjs` as the first real capability provider. It is ready only when the requested Space is exactly the currently selected authorized Space and the existing selected-Space Intelligence reports inference available. The provider emits no fabricated `aura.summary` metric; that widget remains absent until a real summary owner supplies it. Aura remains consultative and never becomes the transactional source of orders, users, printers, students, payments or other domain state.

Current structured types:

| Space type | Source status | Runtime promotion in this foundation |
| --- | --- | --- |
| `food.pizzeria` | MVP structural foundation | current-Space Aura provider promoted; business/transaction providers remain absent |
| `fabrication.3d-printing` | MVP structural foundation | current-Space Aura provider promoted; fabrication/transaction providers remain absent |
| `product-operations.territorial-platform` | structured | `DEFERRED`; emits no contextual navigation/widgets |
| `education.school` | structured | `DEFERRED`; emits no contextual navigation/widgets |
| `development.software` | structured | `DEFERRED`; one Space can contain many Projects; Studio is only the project-opening tool |

The canonical account owner now stores Space semantics as paired `ordax_spaces.domain` + `ordax_spaces.subtype` and projects them through `/account/spaces`. New canonical Spaces must use those explicit fields. Nullable rows remain supported only for legacy compatibility; new database inserts require explicit `domain/subtype`, and once a Space has explicit semantics it cannot be demoted back to the legacy `null/null` state. A legacy row may still be promoted to explicit semantics later. When both fields are absent on a legacy row, the resolver may still derive semantics from the existing Pizzaria/Impressão 3D Profile binding. That fallback is not an ownership source, is not backfilled into the database, and never makes a capability available.

The Development definition models `project` as a many-valued resource owned by the Space and opened with Studio. A repository is not promoted to a Space merely because it exists, and Studio does not become the owner/SSOT of the Project.

The 3D-printing type declares Jobs as domain resources but does not implement a fabrication owner in this foundation. When that owner is promoted, reprinting must append a new Job and preserve prior Job/history records; a reprint is never modeled as deleting or rewriting the original production history. The Pizzaria type deliberately does not declare `quotes` because no current real owner justified that capability.

### Deferred safety constraints

The structured School definition does not promote the vertical and does not create `orders`. REL-001 remains binding: external student/guardian identities are not internal Space members. No unrestricted camera/tracking capability is introduced; transport remains a separate declared capability and still requires its own consent, purpose and owner before promotion. Data about minors is not an advertising/targeting source.

The structured Achegue-se definition remains an operational product-operations Space, not a development Space. `offers`, `jobs_publications` and `orders_public` are only declared possibilities and remain invisible until the corresponding real owner/provider is promoted. The product boundary remains: Achegue-se discovers/connects; OrdaX organizes/operates; product SSOTs remain independent.

## Release-safe Space foundation — 2026-10-17

`MVP.md` now defines `MVP` as historical compatibility terminology rather than the active product strategy. Therefore old labels such as `mvp-foundation`, `deferred`, `post-MVP` or `MVP boundary` do not by themselves authorize cutting an already-started Space capability from the product, nor do they make that capability a USB launch blocker. They remain compatibility/source-state labels until a deliberate contract migration replaces them.

The release-safe dependency direction is:

```text
Boot / Base / local runtime
        |
        v
Identity/session when available
        |
        v
Spaces catalog + selection
        |
        v
Space experience projection
        |
        v
Domain capability providers / vertical services
```

Space is a core product domain but is not a boot dependency. An unavailable account endpoint, Space catalog, Profile Pack, Aura integration or vertical provider must degrade only the affected product capability. It must not block boot, local runtime, recovery or an unrelated local workflow.

### Stable public boundary

`ordax.spaces/1` remains a read-only Surface port. Create, rename, archive, restore, destructive deletion, membership changes, invites and ownership transfer must not be added as write methods to that read port. New mutations belong to explicit versioned action/service contracts with server-authoritative subject, membership/role revalidation, idempotency where retry is expected and audit receipts for sensitive transitions.

This separation is what allows an already-shipped USB/Base to continue consuming the compatible Space read projection while account management and collaboration evolve independently through product updates.

### Additive update rule

**Store vs Space vs Profile versioning:** `Space` is the stable workspace/ownership boundary. The OrdaX Spaces service and its versioned contract can evolve without recreating Spaces. A Profile Pack (`pizzaria-br@1`, `@2`) changes the versioned **composition**, not the application binaries. The Store and component runtime own independently versioned signed app artifacts and their install/update/rollback lifecycle. Profile `apps[]` contains only references to those app IDs; its `components[]` cannot publish `kind: app`. Reusing one app across Spaces never shares their domain data. A Profile reference alone must never make a nonexistent/uninstalled app appear available, and Store install/update is not authorized by selecting or activating a Profile.


Prefer additive evolution below stable ports:

- add a capability provider instead of expanding the Spaces read port;
- add a versioned action service instead of giving database authority to Surface;
- publish a new Profile Pack version instead of mutating an already-published version;
- add domain resources behind explicit Space ownership instead of embedding vertical state into the Space record;
- keep capability declaration separate from runtime availability;
- keep deployment/database projections subordinate to the canonical semantic catalog rather than creating another Space-type SSOT.

Base/USB, Surface, Space contracts, Profile Pack versions, capability providers and Web/Mobile/Desktop/native clients may advance independently as long as their versioned boundaries remain compatible.

### Degradation contract

A declared capability is never enough to expose working UI. A provider must prove a valid `ready` snapshot for the authorized Space. Missing, malformed, unavailable or failing providers remove only their capability-specific navigation/widgets/context. Capability-independent Space shell/navigation may remain available.

A failing vertical provider must not invalidate the Space record, cross authentication subjects, corrupt selection or make the OS unusable.

### Resource ownership direction

Every domain resource that belongs to a Space should carry an explicit `spaceId` or equivalent server-authoritative foreign key in its owner domain. Examples include Projects, Files, Jobs, Orders, Models, conversations, Memory scopes, automations and app state.

The domain service remains the SSOT of its resource schema. The Space record must not become a monolithic container for every vertical's state, and client-provided ownership must never be treated as authority for cross-Space access.

### Collaboration boundary

Global membership roles remain intentionally small: `owner`, `admin`, `member`, `viewer`. Business/work functions such as `pizzaiolo`, `professor`, `financeiro` or `operador-3d` belong to People/domain capability policy rather than expanding the global identity enum.

Invite is not membership. Pending invites are separate temporary entities; only authenticated acceptance may create server-authoritative membership.

### Current mutation authority — 2026-10-17

The product backend now has explicit, bounded server-authoritative mutation boundaries instead of relying on direct client table writes:

- Space creation is intended to use `ordax_create_space_v1` with server-side type/quota/idempotency validation. **Deployment gate (2026-10-19):** the source RPC still attempts to insert an `owner` membership, whereas the active Product PostgreSQL `ordax_space_members_role_check` permits only `admin/member/viewer`. Until a forward-only reconciliation migration and PostgreSQL regression pass, this create path is **blocked**, not a verified success. `ordax_spaces.owner_user_id` must remain the one persisted Owner identity; a visible owner entry must be projected without a second membership row (see ordax-os#2007).
- Space rename/archive/restore use `ordax_mutate_space_lifecycle_v1`; direct authenticated `UPDATE`/`DELETE` on `ordax_spaces` is revoked.
- direct authenticated `INSERT`/`UPDATE`/`DELETE` on `ordax_space_members` is revoked and the historical membership write policies are removed;
- actions over an **existing** membership use `ordax_mutate_space_membership_v1` and the versioned `ordax.space-membership-actions/1` contract for `change-role`, `suspend`, `reactivate` and `remove`.
- presentation capability for the authenticated actor uses `ordax_get_space_actor_capability_v1` and `ordax.space-actor-capability/1`; `canManageMembers` is projected by the server from the canonical authorization predicate and must not be recomputed from `role` in Surface code.

All of these action paths derive the actor from the authenticated server session, revalidate current authority, use idempotency where retry is expected and keep private receipts/state out of the public Surface read model. Membership administration preserves the global roles `owner/admin/member/viewer`: only the actual Space owner can grant or administer `admin`; a delegated admin can administer `member/viewer`; owner membership is never changed through the ordinary membership-action boundary.

These backend capabilities do **not** imply that every Web/Native/Mobile UI is already wired or publicly available. Product surfaces must advertise an action only when their adapter/backend reports it supported; no UI may infer mutation capability merely because a contract exists in source.

Still intentionally absent from the current authority foundation:

- invite creation/delivery/accept/decline/revoke/expiry;
- creating a new membership outside the canonical Space-create owner bootstrap and future authenticated invite acceptance;
- voluntary member `leave`;
- ownership transfer;
- destructive Space deletion ceremony.

Those flows remain separate because their authorization, consent, token/reauthentication and audit requirements differ. They must not be folded into `ordax.spaces/1`, lifecycle actions or a generic membership mutation endpoint.

### USB launch rule

A USB release does not wait for every Space vertical or provider to be complete when those capabilities are independent from that USB channel's promised flow. The Space foundation is compatible with release when:

1. boot/Base/local runtime remain independent from Space/network availability;
2. public Space contracts remain backward compatible or deliberately versioned;
3. missing providers fail closed and degrade locally;
4. Space selection cannot cross authenticated subjects;
5. creation/quota/authorization remain server-authoritative;
6. future Space work can ship as verified product updates without requiring a new USB image unless it genuinely introduces a new Base/kernel/local-runtime requirement.

This does not permit shipping fake UI, broken promised flows, unsafe authorization or permanent mocks. It only prevents unrelated Space evolution from becoming an artificial blocker for a USB whose own gates have passed.

## Update ownership: Space core vs Store apps (canonical rule)

The **Space structure is native OrdaX core**, not an app packaged by the Store. It keeps a stable Space identity, type, membership, selection and resource ownership; its compatible read/action boundaries evolve separately from OS/Base and Store app versions. A new Space core version must not recreate the Space or rewrite domain data as an implicit side effect.

**Apps and vertical modules (Pedidos, Estoque, Caixa, models, production)** are **Store-distributed, independently versioned verified packages**, not executable code embedded in a Pizzaria/3D Profile Pack or duplicated per Space. One app version may serve multiple authorized Spaces. Its runtime/data service remains the domain SSOT, with every resource scoped to the authorized Space. Store installation/update alone never grants account or Space permissions.

**Profile Packs are immutable versioned recipes**, not a second package store or app runtime. They may reference/request Store app identifiers and compatible versions, templates and capabilities; activation must pass actual Store package signature/trust, compatibility, entitlement, permission and applicable consent gates. Declaring an app in a Profile Pack does **not** mean the app is installed, ready, available or authorized. Rollback of the recipe must not roll back the business records.

**OS/Base updates are a fourth independent lane** and never depend on a vertical app being available. An app fault does not prevent boot or unrelated Spaces. No new Store or Space update API is implied by this architecture rule; the updater and lifecycle gates must be implemented and proven separately.

This division is machine-readable under `update_ownership` in the existing `docs/contracts/spaces-and-profile-packs.json`; do not create another competing Space/app ownership registry.

### Inventory enforcement — Store remains the only app delivery owner

The Profile component inventory contract refuses `kind: "app"` records. Such records are not proof of Store installation, availability, entitlement or trust, and cannot satisfy Profile provisioning. Profile inventory continues to cover only knowledge/skill/model packs and connectors. Installed applications and individual updates remain projections of the canonical App Store/Native lifecycle, never inferred from Profile manifests or receipts.

## Interoperabilidade canônica: Platform, MCP, Studio, Flow — 2026-10-19

Esta seção complementa as definições de Space/Profile Pack acima; **não** cria outra autoridade nem altera a identidade de Spaces existentes. Aplicável aos contratos `ordax.spaces/1`, `ordax.project-catalog/1` e às tabelas/RPCs canônicas de produto.

| Termo de produto (PT-BR) | Nome técnico / identidade | Responsabilidade e fonte de verdade |
| --- | --- | --- |
| Conta OrdaX | Identity subject / `session.subject_id` | identidade única autenticada pela Platform; não é Space, Perfil ou dispositivo |
| Perfil do usuário | Account preferences/profile | preferências do usuário, não modelo de composição de um Space |
| Pacote de perfil | `Profile Pack`, `ordax.profile-packs/1` | composição técnica **versionada**; sem dados de negócio nem identidade nova |
| Espaço | `Space`, `ordax_spaces.space_id` | ambiente estável de trabalho/dados/membros, compartilhado logicamente por OS e Platform; fonte persistente: autoridade de Conta/Space da Platform |
| Tipo de espaço | `ordax_spaces.domain + subtype` | semântica de domínio definida em `system/services/spaces/type-catalog.mjs`, não um segundo Space |
| Projeto | `ordax_projects.project_id` | recurso da autoridade de Projeto ligado a um Space; um Space pode ter vários projetos |
| Projeto local | `ordax.project-catalog/1`, IDs `project-N` e caminhos lógicos locais | estado **do dispositivo/sessão**; não é identidade `ordax_projects.project_id`; vínculos com nuvem são explícitos e não sincronizam arquivos automaticamente |
| Repositório | `ordax_project_connections` / GitHub repository ID | origem externa opcional verificada; nome GitHub não substitui ID nem prova de autorização |
| Dispositivo (target) | identidade de equipamento autorizada | identidade, presença e grants distintos; pode ser usado no MCP sem cadastro artificial de Space para funções de dispositivo |
| Associação Space–dispositivo | `ordax_space_devices` | autoriza participação do dispositivo naquele Space; não equivale a permissão para qualquer ação |
| Associação Projeto–dispositivo | `ordax_device_project_bindings` | liga um projeto canônico a um executor autorizado; não equivale a grant |
| Permissão | grant de capability e escopo no Owner/Platform | autorização por operação/cliente/dispositivo, revogável; política local do Runtime é outro gate obrigatório |
| Aplicativo | App verificado distribuído pela Loja | instalável e versionado independentemente, não é Space, módulo ou MCP tool |
| Módulo | componente de um aplicativo/serviço | implementação funcional sem identidade de aplicativo obrigatória |
| Capacidade | capability declarada e pronta via provider | disponibilidade funcional real; não equivale a app instalado, autorização, entitlement ou grant |
| Ferramenta MCP | MCP tool publicada pela Platform | projeção de entrada para capacidade autorizável, não serviço, Space ou executor independente |
| Serviço / Runtime | autoridade de backend / OrdaX Runtime local | autoridade remota mantém identidades e decisões; Runtime executa apenas ações autorizadas e aplica política local |

### Regra de integração (não duplicação)

- `ordax_spaces` da Platform e os Spaces exibidos pelo OrdaX OS devem designar **a mesma identidade de produto** quando sincronizados. O port `ordax.spaces/1` é projeção do Space autorizado, não segunda tabela, segunda conta ou segundo serviço de criação.
- `ordax_projects` não é automaticamente o mesmo registro de `ordax.project-catalog/1`. O catálogo local pode existir offline; o projeto canônico pode existir sem checkout no dispositivo. O vínculo explícito usa identificadores verificados. Não mapear por coincidência de slug, diretório ou nome.
- `ordax_profile`, tool MCP de compatibilidade, devolve `session.subject_id` da **Conta** para apresentação da identidade do conector ChatGPT: **não** representa Perfil, Profile Pack ou Space. Não renomear ou alterar esse output sem versionamento e inventário de consumidores.
- `Owner` é papel/autoridade contextual; o proprietário de um Space é determinado pelo vínculo persistente `ordax_spaces.owner_user_id`, não pela presença de uma membership com rótulo `owner` nem por configuração local do Studio.
- `Workspace` pode designar diretório ou área visual do Studio/Runtime, mas **não** é sinônimo técnico de `Space` em contratos. Na experiência do usuário, usar “Espaço” quando o recurso for o Space de produto e “pasta de trabalho” ou “área de trabalho” para contexto local.
- Flow e Studio são produtos independentes do boot, disponibilidade e ciclo de vida do OS. Flow pode ter projetos de conversa de domínio próprio; tais IDs não podem ser promovidos implicitamente a `ordax_projects` ou grants Runtime.
- `ordax_session`, `ordax_profile`, `ordax_targets`, `ordax_action_status` e observação autorizada do dispositivo no MCP não exigem Projeto ou Space por mera conveniência de implementação. Cada uma conserva OAuth, atestação (quando aplicável), grants e política local. `process_list` e `terminal_exec` continuam projetados como operações **de projeto** e exigem contexto canônico, bindings, grant e runtime attestation.
- A issue `ordax-platform#220` e PR `#222` são gates do onboarding Owner; antes de criar novos vínculos ou migrations é preciso provar equivalência dos IDs/autoridades do OS com os da Platform. Não criar segundo cadastro, não inserir tabelas diretamente e não interpretar teste de fonte como autorização de produção.

### Compatibilidade e promoção

As definições desta seção **não** afirmam que fluxos de onboarding, sincronização OS↔Platform, grants ou E2E já estejam implantados. Mudanças futuras de esquema exigem migrations versionadas, teste de dados legados, isolamento multi-Owner/Space, revogação, concorrência e teste físico de Runtime. Manter os ports de leitura e ferramentas públicas compatíveis enquanto as autoridades evoluem.

**Prova de implantação pendente (consulta somente leitura 19/10/2026):** no PostgreSQL ativo da Platform, os identificadores persistentes são `ordax_spaces.space_id` e `ordax_projects.project_id`. As funções públicas `ordax_mutate_space_lifecycle_v1` e `ordax_mutate_space_membership_v1` descritas acima **não apareceram** na inspeção de rotinas implantadas; a existência das migrations no repositório do OS não comprova seu deploy. Não inferir um segundo backend nem executar migrations até reconciliar registry, adapter e autoridade de implantação.


### Bloqueio da autoridade de proprietário — 2026-10-19

A inspeção read-only da instância Platform confirmou `ordax_space_members_role_check` limitado a `admin/member/viewer` **e** função implantada `ordax_create_space_v1` que tenta inserir `role='owner'`. Os testes isolados de criação do OS utilizam fixtures históricas que permitem `owner`; por isso passar nesses testes não comprova compatibilidade do banco implantado. Regra canônica: `ordax_spaces.owner_user_id` é a única propriedade persistida; Owner pode aparecer como papel **derivado de leitura** para a interface, jamais como segunda linha de autoridade. A correção será versionada em `ordax-os#2007`, sem reescrever a migration já aplicada, e inclui reconciliação de `ordax_policy`/RPCs ausentes. Este estado não autoriza onboarding automático do MCP nem enfraquecimento de RLS.
