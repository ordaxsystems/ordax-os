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
- `/?material=pearl`: Central, Pérola mineral material.
- `/?material=petrol`: Central, dark Petróleo material.
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
loading and error scenarios. Settings owns the material collection choice and
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

## Meridian Round 3 — composition and continuity

Desktop removes its permanent topbar; Central retains it. A shared taskbar
renderer exposes scoped app shortcuts and active/minimized state. Search is at
the lower left; progressive system details are at the lower right. Contextual
Intelligence and continuity summaries derive from existing isolated storyboards.
No canonical adapter, service or production palette is introduced.

See [Round 3 coverage and captures](../../docs/evidence/meridian-round3/coverage.md).
With the preview host running on 4203, run only the focused check:

```sh
node tools/meridian-preview/round3-smoke.mjs
```

Output defaults to `out/meridian-round3`. Uses disposable Chromium and leaves the
host running. Does not replace independent audit. Round 2 fixes and old runners
remain unchanged. Main is untouched; Meridian is not ready for merge.

### Presentation-aware navigation follow-up

Sidebar destinations stay in the current presentation: pages in Central, existing
preview windows in Desktop. Section content is reused, not copied. The duplicate
Central presentation shortcut is absent in Desktop. Central provides an Início
sidebar page link to return home without switching presentation. See [focused navigation evidence](../../docs/evidence/meridian-navigation/README.md).
Run `node tools/meridian-preview/navigation-smoke.mjs` against the active 4203 host.

## Independent Round 3 audit

The [final audit](../../docs/evidence/meridian-round3-audit-2026-10-13/relatorio.md)
covers the real db7b4a1 HEAD and subsequent objective corrections. Historical
Round 3 and follow-up evidence is preserved separately. Classification C allows
further visual refinement, not integration or merge.

```sh
node tools/meridian-preview/round3-audit-smoke.mjs
```

This independent runner starts/stops its own loopback host, enables page focus in
the disposable Chromium profile for native focus-event checks, and records
navigation, window geometry, keyboard, AX and foreground-context results.
ORDAX_PYTHON and MERIDIAN_EVIDENCE_DIR work as above. It does not replace the
existing smokes or the independent Round 2 journey matrix.

## Meridian Round 4 — rail, touch and window chrome

See [the focused delivery and 24 captures](../../docs/evidence/meridian-round4/coverage.md).
Rail/dock pointer labels, scoped dock scroll feedback, window chrome and low
landscape density are refined together in Argila/Grafite. Audited navigation,
maximization, foreground and context boundaries remain in the same preview.

```sh
node tools/meridian-preview/round4-smoke.mjs
```

Uses the running host at 4203 and disposable Chromium. Output defaults to
out/meridian-round4; MERIDIAN_EVIDENCE_DIR can select another proof directory.
It covers only Round 4 refinements; emulated touch is not physical touch acceptance.
Earlier smokes and evidence remain intact. No integration, main update or merge readiness.

## Independent Round 4 audit

See [the 44-item independent audit](../../docs/evidence/meridian-round4-audit-2026-10-13/relatorio.md). Classification C freezes the Meridian visual direction and allows measured final fixes. Integration, merge and canonical/physical acceptance remain separate.

```sh
node tools/meridian-preview/round4-audit-smoke.mjs
```

Starts/stops its own loopback host and uses disposable Chromium. ORDAX_PYTHON and MERIDIAN_EVIDENCE_DIR work as above. Includes six viewports in both materials, native touch followed by keyboard and another gesture, tooltip Escape, AX/geometry/motion, and observer/listener/frame cleanup. MERIDIAN_R4_AUDIT_FOCUSED=1 skips geometry cases except 844x390; it is a focused diagnostic, not the complete matrix. Previous runners and failed attempts remain preserved.

## Meridian Visual Freeze — 2026-10-13

[The visual SSOT](../../docs/design/MERIDIAN-VISUAL-SYSTEM.md) consolidates the
four rounds and final audit correction 44d2ef0. It freezes the direction, not
production runtime or every CSS pixel. Materials, geometry, states, motion,
responsive/accessibility principles and comparison references live there;
prior coverage/audit reports are historical evidence.

No Round 5 or product source change. No new integration/default theme. Main is
unchanged. Future shell changes require an objective cause recorded in that owner.

## Material collection — 2026-10-14

Explicit user-requested extension of the approved mineral concept: Argila,
Grafite, Pérola and Petróleo. This extends material tokens and decorative art;
it does not redesign the shell, promote a production theme or integrate services.
The visual owner above records the exception and the measured Argila accent
contrast correction. Historical Freeze hashes and captures remain unchanged.

Choose a material in Settings, Central personalization or Quick Settings →
the current material tile. Settings and the quick panel use one renderer and
one catalogue. Their miniatures consume the actual material tokens. The choice
preserves this session's context, drafts and windows; reload uses the URL's
initial material, or Argila when none is valid. No new preference store is added.

With the existing host running on 4203, run the focused material check:

```sh
node tools/meridian-preview/materials-smoke.mjs
```

Reuses the disposable Chromium owner and writes evidence to
`out/meridian-materials` (override with `MERIDIAN_EVIDENCE_DIR`). It checks palette
selection, samples, text contrast, continuity and narrow viewports. This is not
the complete previous audit matrix, canonical CI, physical USB or screen-reader
acceptance. The preview stays available and production compositions stay separate.


## System-page review — 2026-10-14

The user requested realistic product presentation without on-screen lab labels.
`/?journey=setup` now starts at welcome and groups progress into seven stages;
`/?journey=identity` opens a full-page account experience. Network cards, account
alternatives, recovery and errors use product-facing language. The preview title
is OrdaX. The code remains explicitly demo-injected, in memory, with the existing
loopback host/CSP and no remote commands or credential collection.
This user-authorized review supersedes the frozen copy/layout for these screens
only; the dated freeze/audit evidence is preserved. See DESKTOP-IDENTITY for scope.

Direct presentation links: `/?journey=setup&step=network` opens the Wi-Fi screen;
`/?journey=identity` opens account entry. A `step` is accepted only when it exists
in the selected definition; all later transitions remain guarded by navigation.
The normal shell omits lab controls and example labels in the header/tray. Use
`/?review=1` (also combinable with other parameters) to expose the existing review
marker/scenario controls. These controls and scenarios are retained, not deleted.
