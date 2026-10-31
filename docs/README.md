# OrdaX Documentation Index

Status: CANONICAL DOCUMENTATION ROUTER

This file is the entry point for documentation under `docs/`. Its purpose is to prevent stale plans and historical evidence from competing with current architecture.

## Authority order

When two files disagree, use this order:

1. **Source + machine-readable contracts** under `docs/contracts/` for exact structured behavior.
2. **`docs/CURRENT-STATE.md`** for the current human-readable implementation/proof snapshot.
3. **`MVP.md`** for current public MVP scope.
4. **`docs/DECISIONS.md`** for architectural decisions and rationale.
5. **Canonical topic documents** listed below for active design/runbook detail.
6. **Plans/proposals** for future work only.
7. **`docs/evidence/`** for dated proof/history; evidence proves what happened but does not define what should happen now.
8. **Superseded/archived material** has no current authority.

A prose document never silently overrides a machine-readable contract. A snapshot never silently overrides current source.

Historical wording inside a root `PLANO-*` such as `CANONICAL`, `P0`, `mandatory`, or equivalent does **not** change this authority order. If that wording conflicts with this router, `MVP.md`, current contracts or a canonical topic owner, the higher-authority source wins and the plan is interpreted as planning/reference material.

## Active canonical map
## Guia de retomada transversal

[INTELLIGENCE-HANDOFF.md](../INTELLIGENCE-HANDOFF.md) é a entrada curta para continuar a integração Intelligence + ChatGPT/MCP + apps entre repositórios. **Não é outro owner de inteligência nem status**: `docs/INTELLIGENCE.md`, contratos, código e `docs/CURRENT-STATE.md` mantêm suas prioridades. Antes de implementar, verificar PRs experimentais e o owner correto.

| Responsibility | Canonical owner |
| --- | --- |
| MVP scope | `MVP.md` |
| Current state / handoff | `docs/CURRENT-STATE.md` |
| Architecture | `docs/ARCHITECTURE.md` |
| Personal OrdaX orchestration | `docs/PERSONAL-ORDAX.md` |
| Spaces + professional composition (single user journey) | `docs/SPACES-AND-PROFILES.md` + `docs/contracts/spaces-and-profile-packs.json` |
| Decisions / ADRs | `docs/DECISIONS.md` |
| Build autonomy | `docs/BUILD-AUTONOMY.md` |
| Product modes | `docs/PRODUCT-MODES.md` |
| Operational realtime / device actions | `docs/OPERATIONAL-REALTIME.md` |
| Mobile Companion | `docs/MOBILE-COMPANION.md` |
| Application compatibility | `docs/APPLICATION-COMPATIBILITY.md` |
| Minimal USB bootstrap | `docs/MINIMAL-USB-BOOTSTRAP.md` |
| Physical media | `docs/PHYSICAL-MEDIA.md` |
| Development workflow | `docs/DEVELOPMENT-WORKFLOW.md` |
| Promotion gates | `docs/PROMOTION-GATES.md` |
| Release signing | `docs/RELEASE-SIGNING.md` |
| Release trust ceremony | `docs/RELEASE-TRUST-CEREMONY.md` |
| Release pipeline/channel/manifest | `docs/RELEASE-PIPELINE.md`, `docs/RELEASE-CHANNEL.md`, `docs/RELEASE-MANIFEST.md` |
| Public site | `docs/PUBLIC-SITE.md` |
| Storage | `docs/STORAGE-ARCHITECTURE.md` |
| Update nomenclature | `docs/UPDATE-NOMENCLATURE.md` |
| Legacy migration ledger | `docs/SOURCE-MIGRATION.md` |

Exact values and gates remain owned by their matching files under `docs/contracts/`.

## Planning router and execution window

The planning hub is `../00-PLANOS-PRIORITARIOS/`.

It separates:

- **document status** — whether a plan/research/reference is useful, ready, historical or superseded;
- **execution eligibility** — whether implementation may actually start in the current product window.

The current execution window is **MVP closure first**. Until the current MVP is closed, future plans remain preserved but are not implementation queues. Work that is already required by `MVP.md`, contracts, `CURRENT-STATE`, `PROMOTION-GATES` or another canonical owner continues under that owner; the matching plan does not become a second source of work.

## Active plans / proposals / references

| Topic | Route | Document status | Execution now |
| --- | --- | --- | --- |
| Planning/priorities router | `../00-PLANOS-PRIORITARIOS/README.md` | Active planning index; non-canonical | Documentation/triage only; follow `ROADMAP.md` |
| Root historical/active plans | `../00-PLANOS-PRIORITARIOS/REGISTRY.md` | Classified centrally as reference/ready/guide/etc. | Per registry; future-plan execution deferred until MVP closure unless a canonical MVP owner already requires it |
| OS foundation audit and consolidation handoff | `../00-PLANOS-PRIORITARIOS/plans/FOUNDATION-001-OS-ARCHITECTURE-CONSOLIDATION.md` | ACTIVE planning/handoff; not canonical implementation status | Only canonical MVP-integrity scope; no independent physical authorization |
| OrdaX Web Research | `../00-PLANOS-PRIORITARIOS/plans/WEB-001-WEB-RESEARCH.md` | P1 READY / not implemented | **DEFERRED FOR EXECUTION** until MVP closure and revalidation |
| Meridian visual integration | `docs/architecture/MERIDIAN-PROVENANCE.md` | Audited C; PR-01 only | No production/default/release authority |

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

- `PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md` — execution overlay/helper;
- `PLANO-FUNCIONAL-SURFACE-E-APPS.md` — functional reference, not canonical current state or changelog;
- `PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md` — dated legacy analysis/reference;
- `PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md` — completed source-closure baseline/reference; live physical gates come from current canonical owners;
- `PLANO-04-FUNDACAO-ECOSSISTEMA-PRE-MVP.md` — ecosystem foundation reference with implemented and future material mixed;
- `PLANO-06-PERFIS-PROFISSIONAIS-E-DISTRIBUICAO-SOB-DEMANDA.md` — **ARCHIVED historical Profile/USB proposal**; superseded for UX and current operation by `docs/SPACES-AND-PROFILES.md`, Profile manifests and contracts. Retained only for referenced provenance;
- `PLANO-07-PERSONAL-ORDAX-E-TRABALHO-INTELIGENTE.md` — execution plan/reference; `docs/PERSONAL-ORDAX.md` is the canonical foundation owner;
- `PLANO-08-ORDAX-NETWORK-COMUNIDADES-E-MENSAGENS.md` — Network reference; any historical self-declaration of MVP canonicity is subordinate to `MVP.md`, contracts and canonical owners.

The planning hub at `../00-PLANOS-PRIORITARIOS/` catalogs these files and is the preferred destination for new reports/plans. Existing root files must not be moved until references are audited and successors are explicit.

Do not use a plan as an append-only implementation log. New factual state should converge to `docs/CURRENT-STATE.md`, machine-readable contracts, evidence, or the canonical topic owner. A plan should primarily retain intent, dependencies, gates and future work.

If a plan becomes stale, update its classification or supersede it; never treat its age or its historical status label as evidence that the implementation still matches it.

## Trust documentation today

Current non-secret trust state is:

```text
LOCAL_PREFLIGHT=PASS
LOCAL_KEY_MATERIAL_GENERATED=YES
CRYPTOGRAPHIC_RECOVERY_VERIFIED=YES
LOCAL_ENCRYPTED_BACKUP_COPY_VERIFIED=YES
EXTERNAL_OFFLINE_BACKUP_CUSTODY_CONFIRMED=NO
EXTERNAL_OFFLINE_BACKUP_REQUIRED_BEFORE_BROAD_DISTRIBUTION=YES
PUBLIC_ANCHOR_PINNED=YES
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=YES
PHYSICAL_AUTHORIZATION_ELIGIBLE=YES
PHYSICAL_WRITE_ALLOWED=NO
CURRENT_SIGNING_BACKEND=local-pem (controlled prototype)
FUTURE_CUSTODY_TARGET=managed non-exportable KMS/HSM
```

The future managed backend is provider-neutral and intentionally deferred. The same-host encrypted backup copy is sufficient for the first controlled prototype because cryptographic recovery was proven, but it is not treated as independent off-device custody; an external/off-device encrypted copy remains required before broad public distribution.

### Assinaturas e benefícios

Owner: `ACCOUNT-SYNC-AND-PLANS.md` e `contracts/entitlements.json`; a apresentação de referência é compartilhada pela landing/Conta. O plano de execução é `../00-PLANOS-PRIORITARIOS/plans/COMMERCE-001-SUBSCRIPTIONS-AND-BENEFITS.md`. Catálogo não ativa billing ou serviços.
