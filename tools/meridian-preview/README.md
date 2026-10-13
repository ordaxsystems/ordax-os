# Meridian visual preview

A branch-only frontend study for OrdaX USB Central and Desktop. This launcher is
not part of the product composition or USB image. Architectural ownership and
acceptance criteria remain in [DESKTOP-IDENTITY](../../docs/DESKTOP-IDENTITY.md#meridian-visual-study--2026-10-13).

## Open

From the repository root, with Python 3.10+:

```sh
python tools/meridian-preview/serve.py --port 4203
```

Open `http://127.0.0.1:4203/`. No package installation or build is needed.
The host listens only on loopback and serves an allowlist of visual resources.
It provides no API, proxy, filesystem browser or write endpoint.

Presentation links:

- `/`: Central, Argila material.
- `/?material=ink`: Central, Grafite material.
- `/?surface=desktop`: Desktop.
- `/?journey=setup`: first-use storyboard, optional network/account.
- `/?journey=recovery&material=ink`: independent recovery storyboard.
- `/?journey=update`: update, deferred restart and known-good review.
- `/?area=spaces`, `/?area=profiles`, `/?area=store`: catalogue views.

These options are checked against the experiment catalogue. They do not change
production preferences. Refreshing resets every fictional action and draft.

## Explore

Use the lower-left presentation switch for Central/Desktop. Open apps from the
dock, minimise, restore, maximise, float or place them in the compact region.
Narrow layouts show one compact app at a time, selectable by its title.
The shared launcher keeps all open apps reachable, including non-pinned apps.

In Central, switch between Day, Work and Ecosystem perspectives. Pick or create
a Space, inspect project continuity, preview a professional profile, review a
Store item, inspect device capabilities and view account/privacy controls.
The `Meridian · estudo visual` control opens connected, guest, offline, empty,
loading and error scenarios. Settings owns the Argila/Grafite choice and
presentation accessibility options. Ctrl/Meta+K opens local visual search.

## Boundaries

- `main.mjs` explicitly injects the source in `demo/`; production entry points do
  not import the experiment or fixtures.
- All mock changes are in memory. No account, AI call, message delivery, package
  installation, permission grant, sync or device access takes place.
- Notes and messages accept example text only, which is discarded on refresh.
- Window examples present interaction design; they are not another app runtime.
- Canonical brand, Inter font and presentation switch policy are referenced from
  their current owners. New art and icons were authored for this branch.
- Existing light, dark and native palettes and their settings remain untouched.

The initial study used syntax checks and captures only. The separate technical
audit is recorded in [the dated report](../../docs/evidence/meridian-audit-2026-10-13/relatorio.md),
including passed checks and unresolved canonical gates. No physical USB test or
production activation follows from this preview.

Run focused UI regressions with the existing Chromium proof runner:

```sh
node tools/meridian-preview/browser-smoke.mjs
```

Python must be available as `python`, or selected with `ORDAX_PYTHON`.
`ORDAX_CHROME_BIN` can select Chromium; `MERIDIAN_EVIDENCE_DIR` selects the proof
output directory (default `out/meridian-proof`). The runner uses a disposable
browser profile and a loopback preview host, then stops both. These checks are
included in the existing Surface Web Candidate workflow.


## Meridian Round 2

The [Round 2 coverage report](../../docs/evidence/meridian-round2/coverage.md)
maps the visual journeys to the audit backlog, canonical owners, limitations and
captures. It does not supersede the audit or declare merge readiness.

The preview composition explicitly injects `demo/storyboards.mjs`. The shared
journey renderer presents first use, local session, USB, update/recovery,
Intelligence, package lifecycle, Spaces, settings, files and communication. The
journey catalogue is available under the visible study marker; operational
entries also appear in Central, System, Settings and the corresponding catalogue.
Closing a journey preserves its place in this page session. Refresh resets it.

New states are screen scenarios, not services: progress advances on explicit
reviewer actions; the one streaming animation reveals fixed example text. No
credential, valid pairing code, real publisher trust or real action receipt is
created. Login failure can lead to local use without a cloud account.

To repeat only the small Round 2 preview check, first start the host at port 4203
using the command above, then run:

```sh
node tools/meridian-preview/round2-smoke.mjs
```

It uses the existing disposable Chromium runner and the already-running host;
it leaves that host running. Output defaults to `out/meridian-round2` and can be
changed with `MERIDIAN_EVIDENCE_DIR`. The checked-in evidence contains 23 focused
checks plus screenshots. This does not run Foundation, the complete browser
matrix, build, CI, backend or physical USB checks.

The earlier `browser-smoke.mjs` remains the independent audit regression runner.
Its existing assertions are retained, with the two Space-switch interactions
updated for explicit impact review. The full runner was not rerun in Round 2;
its new result belongs to the independent audit, not the historical 155-check
result. No workflow gate has been removed or weakened.

## Independent Round 2 audit

See [the independent report](../../docs/evidence/meridian-round2-audit-2026-10-13/relatorio.md),
which preserves failures and distinguishes representation from integration.

Run the additional state, journey and responsive checks with:

```sh
node --test tests/test_meridian_storyboard.mjs
node tools/meridian-preview/round2-audit-smoke.mjs
```

The browser runner starts/stops its own loopback host and uses the shared
disposable Chromium runner. ORDAX_PYTHON and MERIDIAN_EVIDENCE_DIR work as above.
Set MERIDIAN_AUDIT_FOCUSED=1 only for the explicitly reported focused state/keyboard
subset; this skips the complete screen/viewport matrix and is not its replacement.
The full matrix records failures without discarding later independent results.
No assertion from the earlier two smokes has been removed or weakened.
