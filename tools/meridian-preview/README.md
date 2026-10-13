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
