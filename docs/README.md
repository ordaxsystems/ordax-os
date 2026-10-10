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
| Architecture | `docs/ARCHITECTURE.md` |\n| Personal OrdaX orchestration | `docs/PERSONAL-ORDAX.md` |
| Decisions / ADRs | `docs/DECISIONS.md` |
| Build autonomy | `docs/BUILD-AUTONOMY.md` |
| Product modes | `docs/PRODUCT-MODES.md` |\n| Operational realtime / device actions | `docs/OPERATIONAL-REALTIME.md` |
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

The root planning files `PLANO-00-ESTADO-ATUAL-E-PRIORIDADES.md`, `PLANO-FUNCIONAL-SURFACE-E-APPS.md` and `PLANO-02-EVOLUCAO-E-REAPROVEITAMENTO-DO-LEGADO.md` are planning aids. They may be useful and detailed, but they do not outrank `CURRENT-STATE`, `MVP.md`, ADRs or contracts.

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
