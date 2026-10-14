# Meridian PR-01 — Workspace/Surface baseline

Date: 14/10/2026 (America/Sao_Paulo)
Scope: PR-01 contract/baseline only
Runtime implementation: **none**

## Baseline source

Branch base: remote `main` at `dfe35c6d5479d2fa9413903b22cc5d1a31c2f64d`.

This is newer than the independent architecture-audit baseline `5a90d66ff2e96e7eed138a0651b9d96b37a06279`.

The observed `aac73ac… → dfe35c6…` delta contains dev-USB documentation sync, pending-decision owner/probe work, Native Intelligence service-boundary work, generated Native component policy changes, and tests. It does **not** modify the reader-baseline files `surface-state.mjs`, `desktop-state.ts`, `window-layer.tsx`, `presentation.mjs`, `workspace-store.mjs`, `workspace-metadata-source.mjs`, or `surface-render-lifecycle.mjs`.

PR-00 provenance is separately reviewed/green. PR-01 does not copy or import the experimental Meridian runtime.

## Current matrix

| Area | Current source truth | PR-01 conclusion |
| --- | --- | --- |
| Native identity | `area-N`; same singleton can reuse `windowId`/`appId` in separate areas | Future identity is `(areaId, windowId)` |
| Native persistence | `ordax.workspace-store/2`; persisted area/window bounds | No schema change |
| Native compact | Absent | Gap remains; no `/3` promise |
| Web identity | `desktop-state.ts` keys current instances/actions by visible `title` | B-01 remains open |
| Web compact | session `normal/maximized/compact`, selection + collapsed | Baseline only |
| Sync metadata | `ordax.workspace-metadata-source/1` = areas + `appIds` | Not foreground/window reader |
| App lifecycle | `ordax.surface-render-lifecycle/5` = render + app-target operations | Not expanded |
| Foreground | no uniform composition-authorized projection | B-09 remains open |
| Identity/Spaces | separate owners/ports | visual foreground never grants access |
| Meridian experiment | absent from `main` | no import/cherry-pick/second runtime |

## Pre-edit test evidence

```text
node --test tests/test_surface_workspace.mjs tests/test_web_central_windows.mjs tests/test_surface_multi_app_profile.mjs
```

Result: **29 passed / 0 failed**, `duration_ms 3898.7441`.

```text
python tests/test_surface_reconciliation_contract.py
python tests/test_surface_ui_contract.py
```

Results: **8 passed** and **27 passed**.

These prove current deterministic/unit/static contracts only. They do not prove real screen-reader use, physical touch, USB hardware, or release readiness.

## Mount/reconciliation baseline

Existing Native reconciliation tests prove stable interactive-node reconciliation, area+window DOM identity, minimize without app-DOM destruction, visual focus stacking, and retained extension/control nodes. PR-01 adds no renderer.

## Performance baseline / proposed budgets

Current evidence is development-host test/harness evidence, not a product performance claim. Later increments measure on the same host/fixture/control build:

- zero app remount caused by material/presentation/clock changes;
- zero listener/observer growth after 50 open/close cycles;
- zero duplicated polling from reader/projection;
- zero full-root replacement after mount;
- no unexplained >10% p95 interaction/first-usable-frame regression versus measured canonical baseline;
- no new >50 ms long task attributable to hover/clock behavior.

No absolute hardware threshold is invented here.

## Accessibility baseline

Automated Surface tests are useful but not equivalent to human/physical accessibility validation. Still pending where applicable: real screen reader, 200%/400% zoom, large text, forced colors/high contrast, physical touch targets, and Native/OS assistive technology.

No pending item becomes PASS through browser emulation or fixtures.

## Environment evidence

Development-host baseline used for the focused checks:

- Windows `10.0.19045.6466`;
- Node `v26.7.0`;
- Python `3.13.14`;
- Git `2.55.0.windows.3`.

This is host evidence only. It is not USB/Linux Native, physical touch, assistive-technology, or release proof.

## Visual reference / shot setup

PR-01 changes no visual implementation, so it does not create replacement Meridian screenshots. The immutable visual reference remains the frozen Visual System/evidence at Meridian audit commit `14b898438dedb89501d237a3a6a58e4cc9fb10d4`, routed for canonical documentation by PR #1768.

Later visual increments must capture the canonical build/renderers against that immutable reference; screenshots remain visual evidence only and never lifecycle/authorization proof. No experimental preview/controller is introduced as the capture runtime here.

## PR-01 acceptance boundary

PR-01 can be accepted only if the proposed composition-only reader contract is reviewable, six invariants are explicit, Native/Web gaps remain honest, baseline tests stay green, no executable reader/reducer/store/lifecycle is added, B-08/B-09 stay open, and no experimental runtime/UI enters `main`.

This baseline does not authorize PR-02, PR-04, PR-05, public opt-in, release, or physical readiness.

## Post-edit validation

After adding only documentation plus two Native baseline/safety assertions:

```text
node --test tests/test_surface_workspace.mjs tests/test_web_central_windows.mjs tests/test_surface_multi_app_profile.mjs
31 passed / 0 failed

python tests/test_surface_reconciliation_contract.py
8 passed

python tests/test_surface_ui_contract.py
27 passed

git diff --check
PASS
```

The two new assertions prove that identical singleton window IDs can coexist in different Native areas and that the existing sync metadata validator does not surface injected window-private extras. They do not implement the future reader.
