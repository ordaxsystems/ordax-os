# Meridian integration validation — 2026-10-14

Explicit user authorization: use the Meridian/USB visual direction in the actual
Web, integrate the Store appearance, retain unimplemented resources as labelled
mocks, and reuse the existing Web hero imagery. This is a presentation adoption,
not a new backend, official catalog, provider or Native lifecycle implementation.

## Changes and ownership

- Web keeps Central, its account key, existing preferences, desktopReducer and
  WindowLayer. MeridianHome supplies editorial Day/Work/Ecosystem perspectives,
  existing alpine day/night image hero and explicitly identified planned cards.
- Shared `ui/meridian.tokens.css` and `ui/meridian.css` load in Web and Native/USB.
  Native Store cards/hero/navigation consume the same visual language while their
  existing catalog/request/activation owners remain unchanged.
- Store presentation source moved from the standalone composition into
  `workspace/components/store/presentation/`; compatibility entries keep the old
  standalone URL. Both presentations use one renderer, fixtures and demo reducer.
- The Web Store mounts in its existing managed window using a ShadowRoot for
  styling, element IDs and listener scope. No iframe or global URL/title mutation.
  Local navigation, scroll and mock state survive minimize/restore/compact/view
  changes. AbortController/timer cleanup runs when the window is closed.
- A ready verified catalog still opens the real, fail-closed Store by default.
  With unavailable Web transport the planned view stays visible and labelled.
  Switching catalog modes hides/preserves the demo session; fixtures are never
  inserted into an official snapshot or converted to execution authority.
- Dock pins reuse existing shortcut metadata; opening focuses/reuses the existing
  window. Pins have no running marker until a real managed window exists.
- Original reference digests remain intact in their ledgers; adoption history
  records explicitly authorized presentation changes. No dependencies installed,
  new credentials, account changes, host installs or physical operations.

## Automated checks

| Check | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/test_web_store_catalog.mjs tests/test_store_preview.mjs tests/test_verified_store_projection.mjs tests/test_store_update_request_batch.mjs` | 44 passed |
| `python -m unittest discover -s tests -p test_surface_ui_contract.py` | 27 passed |
| `python -m unittest discover -s tests -p test_surface_web_builder.py` | 8 passed |
| `npm.cmd run typecheck --workspace tools/surface-web` | Passed |
| `npm.cmd run build --workspace tools/surface-web` | Passed; includes typecheck |
| `npm.cmd run build:store-preview --workspace tools/surface-web` | Passed; original standalone entry still builds |
| `npm.cmd run verify --workspace tools/surface-web` | Passed; 34 reference files, lifecycle/geometry and fail-closed AI |

Total: 79 automated tests passed. No contract test was relaxed. The Web builder
check caught ownership moving out of Central; Central now retains the canonical
preference subscription and passes presentation values to MeridianHome. The
reference verifier required explicit adaptation records for moved/renamed views;
upstream digests were preserved. The offline source check caught a documentation
localhost URL inside the composition tree; the README now uses a host/port label,
without changing the offline guard.

The canonical main JS remains above the existing 500 kB warning threshold
(approximately 727 kB, 207 kB gzip). Store remains a lazy resource, approximately
139 kB (40 kB gzip). Its encapsulated presentation CSS is included in that module.
No unrelated shell/service refactoring was introduced to suppress the warning.

## Browser checks

[Recorded passing observations](browser-results.json) cover the live Web at port
4201, actual compiled Web at port 4205, and compiled standalone Store at port 4204.
The production checks include lazy Store and compact-action chunks, mobile menu,
real/demo separation, URL isolation, dialogs, material propagation and closing.

A development/HMR run encountered a failed fetch of the existing compact-actions
module; its canonical error boundary kept an expand fallback. The final compiled
bundle loaded the compact actions, opened its mobile menu and expanded the window
without console errors or warnings. This is distinguished from a production defect.
Temporary viewport overrides were reset. Local preview servers are development
infrastructure, not a hosted deployment or Native hardware proof.

![Compiled Web Central with the existing alpine hero](central-hero.jpg)

![Store integrated into the existing Web window](loja-integrada.jpg)

![Compiled Central on mobile](central-mobile.jpg)

![Compiled Desktop in Grafite](desktop-grafite.jpg)

## Remaining boundaries

Native/USB shared visual wiring was inspected and covered by source contracts;
no physical boot, touch, hardware or Native lifecycle proof was performed. The
Meridian experiment on port 4203 is a reference checkout, not the active Web owner.
Mocks preserve intended resources for incremental implementation; project files,
agenda, routines and device integration do not claim a live backend. Account,
Spaces, Intelligence and official Store availability keep their canonical ports.
