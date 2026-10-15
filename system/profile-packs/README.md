# OrdaX Profile Packs

Profile Packs are versioned product compositions applied to a Space.

They may describe:

- recommended/required apps;
- templates and workspace defaults;
- knowledge-source classes and refresh policy;
- Intelligence instructions;
- optional capabilities that still require normal entitlement/permission checks.

They do **not** fork OrdaX, grant privileges, bypass app signatures, store provider secrets or turn model output into an authoritative knowledge source.

The user account profile remains separate from Profile Packs.

Professional networking is also a separate horizontal domain. A Profile may recommend Network
communities through `system/network/profile-affiliations.json`, but it cannot auto-publish a Space,
auto-join a community, grant a Network role or own messages. Membership and messaging authorization
remain server-authoritative under the OrdaX Network boundary.

## User-facing Space creation

For normal product UX, the user chooses the **type of Space**, not a technical Profile Pack as a
second mandatory decision.

Preferred flow:

```text
Criar Space
  -> Pizzaria
      -> create professional Space
      -> resolve/apply pizzaria-br@1

Criar Space
  -> Impressão 3D
      -> create professional Space
      -> resolve/apply impressao-3d-br@1
```

`Space` and `Profile Pack` remain separate technical objects. The simplification is only the
user-facing flow:

```text
Space        = real workspace/business data
Profile Pack = versioned composition applied to that Space
```

A user can therefore have multiple independent Spaces backed by the same Profile Pack, and a
Profile can be upgraded/rolled back without recreating or erasing the Space.

Technical identifiers such as `pizzaria-br@1` stay internal/advanced by default. Advanced/admin
tools may expose Profile review, version, activation status, permission diff and rollback when
needed. Trust, entitlement, provisioning and consent gates are never bypassed by automatic
resolution.

Canonical UX/design detail: `docs/SPACES-AND-PROFILES.md`.

## Categorias e nichos — navegação sem outro SSOT

A árvore de categorias é publicada em `system/profile-packs/taxonomy.json`
(`ordax.profile-taxonomy/1`), validada por
`system/contracts/profile-taxonomy.mjs` e projetada pelo serviço
`system/services/profile-packs/taxonomy.mjs`.

```text
Empresas e negócios
├── Alimentação e bebidas
│   └── Pizzarias e serviços de alimentação → pizzaria-br@1
└── Indústria e produção
    └── Fabricação digital e impressão 3D → impressao-3d-br@1

Tecnologia → Desenvolvimento de software → developer@1
Serviços profissionais → Serviços jurídicos → legal-br@1
```

**Separação de responsabilidades:**

- `manifest.category` é o único campo que define em qual categoria o Profile pertence.
- `taxonomy.json` é o único owner de nomes e relações categoria/pai. Não guarda
  composição de apps, templates, licenças, políticas ou autoridade.
- `system/services/profile-packs/catalog.mjs` permanece o catálogo de Profiles
  ativos e suas composições. A árvore exibe exclusivamente os itens recebidos
  desse catálogo, sem publicar automaticamente packs em estado draft.
- `Space.kind = professional` continua um tipo de ambiente, não é uma
  categoria comercial ou autorização de empresa. Uma empresa poderá possuir
  vários Spaces, mas a taxonomia não concede acesso cruzado.
- Apps de Finanças, Vendas, Estoque e CRM devem pertencer a seus **owners de app**,
  com contratos reutilizáveis e controles próprios. Um Profile apenas os
  referencia quando forem disponibilizados e autorizados; nenhuma instalação
  ou módulo financeiro fictício é criada pela taxonomia.
- Categoria desconhecida ou ciclo impede publicar a árvore (fail-closed). Novos
  nichos entram por alteração versionada neste registro, sem duplicar dados
  de usuário ou alterar o runtime.

O leitor `system/services/profile-packs/taxonomy-source.mjs` aceita somente o
caminho bundled same-origin canônico. A taxonomia pode alimentar a experiência
**Criar Space → escolher tipo**, projetando somente Profile Packs `active` do manifest
canônico. A tela avançada **Conta → Perfis**, quando usada para administração/revisão,
pode continuar exibindo composição, versão e estado de ativação sem transformar Profile
Pack em uma segunda escolha obrigatória para o usuário comum. O planner de instalação
continua com a mesma fonte e não concede capacidade.

Pacotes `draft` ou `retired` não entram na navegação publicada. Se a
taxonomia estiver ausente ou inválida, a tela preserva o último estado seguro,
sem inventar categorias nem resolver automaticamente um Profile desconhecido.

## Distribution and provisioning

Profile manifests are the single source of truth for composition. Distribution is a separate boundary that owns only delivery policy such as bundled/on-demand mode, public-install gating, offline expectations and artifact size metadata.

`system/profile-packs/distributions.mjs` is the lightweight local delivery-policy catalog. Component composition is never duplicated there: it is derived from the validated versioned manifests.
`ordax.profile-provisioning/1` plans what is already present, what is missing, whether
network is required and whether activation is allowed.

The Stable USB does not preseed every professional payload. Planned or unsigned artifacts
are never installable. Public download/install remains disabled until the package trust,
transactional staging, health and rollback path is proven.

Automatic Profile resolution during Space creation means only that the requested Space type maps
to one canonical allowed Profile identity. It does **not** mean automatic privilege grant or silent
component activation. Provisioning, permission diff, entitlements, trusted confirmation and health
checks remain authoritative where required.

## Canonical manifest layout

Bundled Profile manifests are versioned source artifacts:

```text
system/profile-packs/
├── catalog.json
├── developer/
│   └── v1/manifest.json
├── legal-br/
│   └── v1/manifest.json
├── pizzaria-br/
│   └── v1/manifest.json
└── impressao-3d-br/
    └── v1/manifest.json
```

`catalog.json` maps exact `slug@version` identities to same-origin runtime URLs such as
`/system/profile-packs/developer/v1/manifest.json`. The Native host serves the OrdaX
release root (`/srv/ordax-system`) as its HTTP root, so runtime URLs preserve the
source-tree `system/` prefix.

Old unversioned `<slug>/manifest.json` paths are forbidden. Multiple versions may coexist
so update and rollback never require overwriting the previous manifest.

At boot, Native may resolve persisted Profile activation metadata against these manifests,
the Space kind, provisioning state and installed receipts. This restore is currently
**metadata-only**. Drift is `disabled-safe`; it never silently applies apps, tools,
Knowledge, policies or privileges.

## MVP business showcase

`pizzaria-br@1` and `impressao-3d-br@1` are the first bounded showcase candidates. They deliberately have
no downloadable components and no privilege expansion. Their first versions compose only
existing first-party apps and Space-scoped Memory/Intelligence policy, so proving them does
not require inflating the Stable USB or creating a separate business runtime.

The bundled manifest being provisionable does **not** by itself prove Stable/MVP user
activation. Public activation remains a separate product gate until the Native command,
Surface UX and physical smoke prove that exact safe path.

The future simplified creation UX does not expand the current MVP scope: it only defines that, once
Space creation is exposed, the ordinary user chooses `Pizzaria`, `Impressão 3D` or another Space type
and OrdaX resolves the corresponding Profile Pack internally.
