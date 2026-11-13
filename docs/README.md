# OrdaX Documentation Index

Status: CANONICAL DOCUMENTATION ROUTER

This file is the entry point for documentation under `docs/`. Its purpose is to prevent stale plans and historical evidence from competing with current architecture.

## Authority order

When two files disagree, use this order:

1. **Source + machine-readable contracts** under `docs/contracts/` for exact structured behavior.
2. **`docs/CURRENT-STATE.md`** for the current human-readable implementation/proof snapshot.
3. **`MVP.md`** for current launch baseline and owner-specific completion scope (not a global minimum-product queue).
4. **`docs/DECISIONS.md`** for architectural decisions and rationale.
5. **Canonical topic documents** listed below for active design/runbook detail.
6. **Plans/proposals** for future work only.
7. **`docs/evidence/`** for dated proof/history; evidence proves what happened but does not define what should happen now.
8. **Superseded/archived material** has no current authority.

A prose document never silently overrides a machine-readable contract. A snapshot never silently overrides current source.

Historical wording inside a root `PLANO-*` such as `CANONICAL`, `P0`, `mandatory`, or equivalent does **not** change this authority order. If that wording conflicts with this router, `MVP.md`, current contracts or a canonical topic owner, the higher-authority source wins and the plan is interpreted as planning/reference material.

## Retomada transversal: estado atual primeiro

Para mudanças cross-repo, **comece por `AGENTS.md`, o owner e o contrato aplicável**. Consulte este índice e o topo de `docs/CURRENT-STATE.md` quando houver dúvida sobre autoridade, composição ou estado; leia o documento de domínio e PRs/artefatos pertinentes à alteração. **Não existe sequência obrigatória de leitura integral para toda tarefa.** [INTELLIGENCE-HANDOFF.md](../INTELLIGENCE-HANDOFF.md) preserva checkpoints de 04/11 e anteriores como **REFERENCE/HISTORICAL**; não é mais entrada operacional nem fila de tarefas. Use-o somente quando a proveniência histórica for necessária. Para Capability Fabric, `docs/CAPABILITY-FABRIC.md` permanece canônico para arquitetura e fronteiras, mas qualquer tabela de status ou sequência datada deve ser revalidada contra `CURRENT-STATE` e os owners atuais antes de agir.

## Active canonical map

| Responsibility | Canonical owner |
| --- | --- |
| Launch baseline and owner-specific completion scope | `MVP.md` |
| Current state / handoff | `docs/CURRENT-STATE.md` |
| Architecture | `docs/ARCHITECTURE.md` |
| Repository ownership + dependency direction | `docs/REPOSITORY-OWNERSHIP.md` + `docs/contracts/repository-ownership.json` |
| External Surface source / cutover / staging | `docs/SURFACE-REPOSITORY-MIGRATION.md` + `docs/contracts/surface-source.json` |
| Brand tokens / derived public + email artifacts | `docs/BRAND-SSOT.md` (visual source remains `ordax-surface`; OS materializes the pinned revision) |
| External Intelligence source / integration-candidate | `docs/INTELLIGENCE-REPOSITORY-MIGRATION.md` + `docs/contracts/intelligence-source.json` |
| Personal OrdaX orchestration | `docs/PERSONAL-ORDAX.md` |
| Web Research source boundary (providers disabled) | `docs/WEB-RESEARCH.md`, `system/contracts/web-research.mjs` |
| Capability Fabric — arquitetura e fronteiras canônicas; checkpoints operacionais datados são referência | `docs/CAPABILITY-FABRIC.md` (arquitetura/limites); diário v1 histórico preservado na PR #2406 |
| Spaces + professional composition (single user journey) | `docs/SPACES-AND-PROFILES.md` + `docs/contracts/spaces-and-profile-packs.json` |
| Account sync / entitlements across product modes | `docs/ACCOUNT-SYNC-AND-PLANS.md` |
| Profile knowledge and Intelligence | `docs/PROFILE-INTELLIGENCE-ARCHITECTURE.md` + canonical Profile manifests |
| Decisions / ADRs | `docs/DECISIONS.md` |
| Build autonomy | `docs/BUILD-AUTONOMY.md` |
| Product modes | `docs/PRODUCT-MODES.md` |
| Operational realtime / device actions | `docs/OPERATIONAL-REALTIME.md` |
| Mobile Companion | `docs/MOBILE-COMPANION.md` |
| Application compatibility | `docs/APPLICATION-COMPATIBILITY.md` + `docs/INSTALLED-APPLICATIONS.md` (presentation/trust invariant) |
| Minimal USB bootstrap | `docs/MINIMAL-USB-BOOTSTRAP.md` |
| Owner/Development USB Git update channel | `docs/DEV-USB-GIT.md` |
| Creator installation / verified-media consumer boundary | `docs/CREATOR-INSTALLATION.md` |
| Host independence | `docs/HOST-INDEPENDENCE.md` |
| Physical media | `docs/PHYSICAL-MEDIA.md` |
| Development workflow | `docs/DEVELOPMENT-WORKFLOW.md` |
| Remote/control capability boundary | `docs/REMOTE-CONTROL.md` |
| MCP system capabilities / ownership boundary | `docs/MCP-SYSTEM-CAPABILITIES.md` |
| Windows Desktop visual test automation (developer-only runbook, not a Runtime/MCP owner) | [`tools/visual-test-bridge/README.md`](../tools/visual-test-bridge/README.md) |
| Multi-repository product composition | `docs/DEVELOPMENT-WORKFLOW.md#integração-multi-repositório--composição-do-produto-2026-11-13` + ADR-031 in `docs/DECISIONS.md` |
| Promotion gates | `docs/PROMOTION-GATES.md` |
| Release signing | `docs/RELEASE-SIGNING.md` |
| Release trust ceremony | `docs/RELEASE-TRUST-CEREMONY.md` |
| Release pipeline/channel/manifest | `docs/RELEASE-PIPELINE.md`, `docs/RELEASE-CHANNEL.md`, `docs/RELEASE-MANIFEST.md` |
| Release bundle / portable image compatibility boundary | `docs/RELEASE-BUNDLE.md` |
| Public site | `docs/PUBLIC-SITE.md` |
| Meridian visual identity / Surface source ownership | `docs/DESKTOP-IDENTITY.md` |
| Internet first-party app boundary | `docs/INTERNET-APP.md` |
| Storage | `docs/STORAGE-ARCHITECTURE.md` |
| Update nomenclature | `docs/UPDATE-NOMENCLATURE.md` |
| Legacy migration ledger | `docs/SOURCE-MIGRATION.md` |

Exact values and gates remain owned by their matching files under `docs/contracts/`.

## Planning router and execution window

The planning hub is `../00-PLANOS-PRIORITARIOS/`.

It separates:

- **document status** — whether a plan/research/reference is useful, ready, historical or superseded;
- **execution eligibility** — whether implementation may actually start in the current product window.

**Default execution model: parallel product completion by owner.** Independent owners advance concurrently and synchronize only at real contract/artifact adoption points. A client-only change must not wait for USB; a Surface change must not trigger Desktop/Creator work until a new product candidate is intentionally composed; Creator consumes verified media rather than rebuilding upstream. Runtime/Control Plane keep their own authority and gates. Current priorities are read from `MVP.md`, `docs/CURRENT-STATE.md`, current PRs/branches and the owner-specific SSOT — never from a dated paragraph in this index.

## Active plans / proposals / references

| Topic | Route | Document status | Execution now |
| --- | --- | --- | --- |
| Planning/priorities router | `../00-PLANOS-PRIORITARIOS/README.md` | Planning index; non-canonical | Consult when planning or reconciling scope; no mandatory roadmap preflight for owner-defined implementation |
| Root historical/active plans | `../00-PLANOS-PRIORITARIOS/REGISTRY.md` | Classified centrally as reference/ready/guide/etc. | Plans do not authorize work; current Window/owner and relevant evidence decide |
| OS foundation audit and consolidation handoff | `../00-PLANOS-PRIORITARIOS/plans/FOUNDATION-001-OS-ARCHITECTURE-CONSOLIDATION.md` | **REFERENCE**; historical consolidation handoff, not canonical implementation status | Execution-eligible only when a current owner defect/gate requires that specific slice; no independent queue or physical authorization |
| OrdaX Web Research | `../00-PLANOS-PRIORITARIOS/plans/WEB-001-WEB-RESEARCH.md` | Source contracts and inert router implemented; no provider enabled | **DEFERRED FOR EXECUTION** until MVP closure and revalidation |
| Meridian visual integration | [`architecture/MERIDIAN-PROVENANCE.md`](architecture/MERIDIAN-PROVENANCE.md) | Audited C; PR-01 only | No production/default/release authority |

The planning router exists to organize reports/plans and cross-chat handoffs. It **does not become a second canonical documentation authority**; this file, contracts, current state and canonical topic owners continue to define authority.

The Meridian route points to immutable approved evidence on the experimental branch instead of copying the experimental runtime into `main`.

## Document lifecycle

Use one active owner per responsibility.

- **CANONICAL**: current source of human-readable policy/design for that responsibility.
- **ACTIVE GUIDE/RUNBOOK**: current operational explanation; cannot redefine canonical contracts.
- **PLAN/PROPOSAL**: future intent, not implemented state.
- **REFERENCE**: useful planning/design/history retained for consultation, but not a current state owner or execution queue.
- **EVIDENCE**: immutable or append-only record of a proof/observation.
- **SUPERSEDED**: replaced by another named document; must not remain in the active reading path.
- **ARCHIVED**: retained only for history.

Execution eligibility is orthogonal to lifecycle. A `READY` plan may still be `DEFERRED FOR EXECUTION`.

When replacing a document:

1. update the canonical owner first;
2. update links/tests/contracts in the same change;
3. mark the old document `SUPERSEDED BY <path>` if it must remain temporarily;
4. move/remove it only after no live reference requires the old path.

Do **not** create `foo-v2.md`, `foo-final.md`, `foo-new.md` or parallel plans for the same active responsibility. Update the owner or record an ADR.

## Plans versus state

All root planning files are subordinate to the authority order above, including:

- [snapshot de execução de 02/10](https://github.com/ordaxsystems/ordax-os/blob/ba81a08db707d032464ae18e521073ef7e416f4f/PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md) — **arquivado no histórico Git e removido da árvore ativa**; nunca usar suas prioridades USB-first como instruções atuais;
- [snapshot funcional Surface/apps](https://github.com/ordaxsystems/ordax-os/blob/3f304b05af33e40658025ff289523560b298153c/PLANO-FUNCIONAL-SURFACE-E-APPS.md) — historical reference removed from the active tree; current ownership is in repository contracts, `ordax-surface`, `ordax-apps` and canonical topic docs;
- [análise comparativa de legado de 18/09](https://github.com/ordaxsystems/ordax-os/blob/c0b3b8555be487f4a105797ebe71fbec9149e97d/PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md) — snapshot histórico removido da árvore ativa; migração vigente é registrada em `docs/SOURCE-MIGRATION.md`;
- [baseline pré-USB histórico](https://github.com/ordaxsystems/ordax-os/blob/0f8749e8ccfa004628fec2dd59c5218aba331de2/PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md) — source-closure snapshot removed from the active tree; live physical gates come from `docs/PROMOTION-GATES.md`, contracts and current owners;
- [snapshot da fundação pré-MVP](https://github.com/ordaxsystems/ordax-os/blob/7ceb1de7ba6cc5c2daa14757a161afc3ae007a33/PLANO-04-FUNDACAO-ECOSSISTEMA-PRE-MVP.md) — referência histórica removida da árvore ativa; decisões atuais vivem nos owners/contratos canônicos;
- `PLANO-07-PERSONAL-ORDAX-E-TRABALHO-INTELIGENTE.md` — execution plan/reference; `docs/PERSONAL-ORDAX.md` is the canonical foundation owner;
- `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md` — Network reference; any historical self-declaration of MVP canonicity is subordinate to `MVP.md`, contracts and canonical owners.

The planning hub at `../00-PLANOS-PRIORITARIOS/` catalogs these files and is the preferred destination for new reports/plans. Existing root files must not be moved until references are audited and successors are explicit.

Do not use a plan as an append-only implementation log. New factual state should converge to `docs/CURRENT-STATE.md`, machine-readable contracts, evidence, or the canonical topic owner. A plan should primarily retain intent, dependencies, gates and future work.

If a plan becomes stale, update its classification or supersede it; never treat its age or its historical status label as evidence that the implementation still matches it.

## Trust / signing status

Este índice **não replica flags operacionais de trust, assinatura ou autorização física**. Consulte `docs/CURRENT-STATE.md`, `docs/PROMOTION-GATES.md` e os contratos machine-readable de trust/release correspondentes para os valores atuais. Evidências datadas ficam em `docs/evidence/`; não copie seus valores para este roteador como estado vigente.

### Assinaturas e benefícios

Owner: `ACCOUNT-SYNC-AND-PLANS.md` e `contracts/entitlements.json`; a apresentação de referência é compartilhada pela landing/Conta. O plano de execução é `../00-PLANOS-PRIORITARIOS/plans/COMMERCE-001-SUBSCRIPTIONS-AND-BENEFITS.md`. Catálogo não ativa billing ou serviços.
