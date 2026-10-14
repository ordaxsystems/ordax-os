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

## Active canonical map
## Guia de retomada transversal

[INTELLIGENCE-HANDOFF.md](../INTELLIGENCE-HANDOFF.md) é a entrada curta para continuar a integração Intelligence + ChatGPT/MCP + apps entre repositórios. **Não é outro owner de inteligência nem status**: `docs/INTELLIGENCE.md`, contratos, código e `docs/CURRENT-STATE.md` mantêm suas prioridades. Antes de implementar, verificar PRs experimentais e o owner correto.

| Responsibility | Canonical owner |
| --- | --- |
| MVP scope | `MVP.md` |
| Current state / handoff | `docs/CURRENT-STATE.md` |
| Architecture | `docs/ARCHITECTURE.md` |
| Personal OrdaX orchestration | `docs/PERSONAL-ORDAX.md` |
| Intelligence | `docs/INTELLIGENCE.md` |
| Web Research / external web evidence | `docs/WEB-RESEARCH.md` |
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

## Active plans / proposals

| Topic | Route | Status |
| --- | --- | --- |
| Planning/priorities router | `../00-PLANOS-PRIORITARIOS/README.md` | Active planning index; non-canonical; consult `ROADMAP.md` + `REGISTRY.md` before starting a new implementation front |
| Cross-plan audit | `../00-PLANOS-PRIORITARIOS/reports/PLAN-AUDIT-2026-10-14.md` | Current triage of old plans vs source; not canonical state |
| OrdaX Web Research execution | `../00-PLANOS-PRIORITARIOS/plans/WEB-001-WEB-RESEARCH.md` | P1 ACTIVE; G0 source audit complete, G1 contract/policy foundation in progress; no provider enabled |
| Meridian visual integration | `docs/architecture/MERIDIAN-PROVENANCE.md` | Audited C; PR-01 only; no production/default/release authority |

The planning router exists to organize multiple reports/plans and cross-chat handoffs. It **does not become a second canonical documentation authority**; this file, contracts, current state and canonical topic owners continue to define authority.

The Meridian route points to immutable approved evidence on the experimental branch instead of copying the experimental runtime into `main`.

## Document lifecycle

Use one active owner per responsibility.

- **CANONICAL**: current source of human-readable policy/design for that responsibility.
- **ACTIVE GUIDE/RUNBOOK**: current operational explanation; cannot redefine canonical contracts.
- **PLAN/PROPOSAL**: future intent, not implemented state.
- **EVIDENCE**: immutable or append-only record of a proof/observation.
- **SUPERSEDED**: replaced by another named document; must not remain in the active reading path.
- **ARCHIVED**: retained only for history.

When replacing a document:

1. update the canonical owner first;
2. update links/tests/contracts in the same change;
3. mark the old document `SUPERSEDED BY <path>` if it must remain temporarily;
4. move/remove it only after no live reference requires the old path.

Do **not** create `foo-v2.md`, `foo-final.md`, `foo-new.md` or parallel plans for the same active responsibility. Update the owner or record an ADR.

## Plans versus state

The root planning files remain useful, but they do not all carry the same lifecycle status. The current classification is maintained in `../00-PLANOS-PRIORITARIOS/REGISTRY.md` and audited in `../00-PLANOS-PRIORITARIOS/reports/PLAN-AUDIT-2026-10-14.md`.

In particular:

- `PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md` is a stale/transitional execution overlay and must not outrank current state/contracts;
- `PLANO-FUNCIONAL-SURFACE-E-APPS.md` is an active functional reference/execution ledger, not a reliable current-gap snapshot by itself;
- `PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md` is historical/reference material for selective migration, not an active implementation queue;
- `PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md` preserves a pre-USB baseline; current physical/release gates remain in the canonical promotion/contracts/evidence paths;
- product-specific plans such as OrdaX Network may remain active/canonical when their current source owner explicitly routes to them.

The planning hub at `../00-PLANOS-PRIORITARIOS/` is the preferred destination for **new** reports/plans. Existing root files must not be moved until references are audited and successors are explicit.

If a plan becomes stale, update or supersede it; never treat its age as evidence that the implementation still matches it.

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
