# Meridian integration provenance

Status: PLAN ROUTER / PROVENANCE ONLY

This document is the canonical documentation route from `main` to the frozen Meridian visual study and its audited integration plan. It does not make Meridian a runtime owner, a default visual system, a release gate, or production-ready behavior.

## Authority and scope

Runtime source, machine-readable contracts, `docs/CURRENT-STATE.md`, and the canonical owners on the current `main` remain authoritative for implementation. Meridian provides perceptual direction only through its frozen Visual System. The integration plan governs future migration sequencing only within the limits approved by the independent architecture audit.

No file under the experimental Meridian runtime becomes canonical by being referenced here. Do not merge or cherry-pick the experiment into `main`.

## Immutable provenance

| Artifact | Immutable reference | Meaning |
| --- | --- | --- |
| Visual Freeze | `e7cf628a01878c484d47997721518fe6f2330c10` | Frozen visual SSOT for the experimental Meridian direction |
| Frozen experiment + final visual audit baseline | `d42b485665e60ec8998726cd4d16cfcaa8529e55` | Historical experiment/evidence baseline |
| Initial integration plan | `55c95eaf77cd52361af7154c66edfc6b6495a70f` | First remotely preserved architecture proposal |
| Corrected plan + independent architecture audit | `14b898438dedb89501d237a3a6a58e4cc9fb10d4` | Classification C; authorizes only controlled PR-01 |
| Main audited by the architecture review | `5a90d66ff2e96e7eed138a0651b9d96b37a06279` | Runtime/contracts baseline observed by the audit |

Exact immutable documents:

- Visual System: https://github.com/ordaxsystems/ordax-os/blob/14b898438dedb89501d237a3a6a58e4cc9fb10d4/docs/design/MERIDIAN-VISUAL-SYSTEM.md
- Corrected integration plan: https://github.com/ordaxsystems/ordax-os/blob/14b898438dedb89501d237a3a6a58e4cc9fb10d4/docs/architecture/MERIDIAN-INTEGRATION-PLAN.md
- Independent architecture audit: https://github.com/ordaxsystems/ordax-os/blob/14b898438dedb89501d237a3a6a58e4cc9fb10d4/docs/evidence/meridian-integration-plan-audit-2026-10-14/relatorio.md
- Audit revalidation data: https://github.com/ordaxsystems/ordax-os/blob/14b898438dedb89501d237a3a6a58e4cc9fb10d4/docs/evidence/meridian-integration-plan-audit-2026-10-14/revalidacao.json
- Documentary verification data: https://github.com/ordaxsystems/ordax-os/blob/14b898438dedb89501d237a3a6a58e4cc9fb10d4/docs/evidence/meridian-integration-plan-audit-2026-10-14/verificacao-documental.json

The immutable links above intentionally preserve the approved documents without copying the experimental runtime or creating a second visual SSOT in `main`.

## Approved next step

The independent audit classified the corrected plan as **C** and authorizes only **PR-01 — baseline de integração e contrato de leitura**.

PR-01 may document the proposed composition-only Workspace reader, current Native/Web baselines, invariants, gaps, and causal test harnesses. PR-01 must not create an operational reader, reducer/store, new lifecycle, Meridian UI, domain adapter, compact Native implementation, visual-system preference, material/tokens integration, or any later PR work.

The two audit blockers added during approval remain open:

- **B-08:** prove Preferences read/save rollback compatibility before new visual/pin preferences advance.
- **B-09:** specify in PR-01 and later prove composite window identity, authorization generation, and coherent reader revisions before an operational reader exists.

Starting PR-01 does not authorize PR-04/05, public opt-in, remote Intelligence E2E, production release, or physical readiness.

## Future changes

Every implementation PR must start from the then-current `main`, revalidate materially relevant deltas, and use canonical owners/projections/lifecycles. The experimental branch remains reference/evidence, not an implementation base.

If the Meridian codename is later removed because the visual language becomes ordinary OrdaX, these immutable historical references remain unchanged for provenance.

## Scoped Launch-Baseline revalidation — First Run (2026-10-16)

The Launch Baseline in `MVP.md` supersedes the former interpretation that an already-started user flow should be reduced merely to keep an old minimal-MVP boundary. First Run is an existing canonical Surface flow with real state, identity, network, preference and local-session owners, so completing that flow is not authorization to migrate the Meridian experimental shell.

For the First Run scope only, the historical `PR-01 only` sequencing above is revalidated as a gate on the proposed **general Meridian shell/Workspace-reader migration**, not as a prohibition on evolving the already-canonical OOBE. The implementation must continue to satisfy these invariants:

- no import, merge or cherry-pick from the experimental Meridian runtime;
- no Meridian reducer/store, lifecycle, backend, identity owner, preference owner, network manager or local-session owner;
- Meridian contributes product intent and perceptual direction only; canonical OrdaX contracts remain authoritative;
- preference writes required for OOBE completion use a confirmed persistence path and rollback on pre-receipt failure, addressing B-08 for this scoped flow without creating a visual preference;
- B-09 remains a blocker for any future composite Workspace reader; this First Run work creates no such reader and therefore does not bypass it;
- keyboard configuration persists through the existing Native keyboard owner and reports `restartRequired` honestly instead of simulating live XKB reconfiguration;
- the completed First Run receipt remains the only completion authority.

This scoped revalidation preserves every immutable reference above and does not authorize public promotion, physical-media writes, or any later Meridian shell migration stage.
