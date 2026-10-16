# Store preview validation — 2026-10-14

Scope: the explicitly requested standalone Meridian Store presentation. The user
subsequently authorized tests, npm/build and necessary fixes. No real host port,
OAuth service, downloader, physical device, release or production Store integration
is exercised or enabled. UI actions mutate the existing demonstrative reducer in
browser memory only. This is evidence, not source or release authority.

## Automated verification

All commands ran from the repository root with the existing dependencies; no new
package was installed and no lockfile was changed.

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/test_web_store_catalog.mjs tests/test_app_store_contract.mjs tests/test_verified_store_projection.mjs tests/test_store_update_request_batch.mjs` | 49 passed, 0 failed |
| `node --experimental-strip-types --test tests/test_store_preview.mjs` | 12 passed, 0 failed |
| `python -m unittest discover -s tests -p test_surface_web_builder.py` | 8 passed, 0 failed |
| `npm.cmd run typecheck --workspace tools/surface-web` | Passed, including the separate preview Vite config |
| `npm.cmd run build --workspace tools/surface-web` | Passed; includes canonical Web type-check |
| `npm.cmd run build:store-preview --workspace tools/surface-web` | Passed; 19 modules, isolated `out/store-preview` |
| `npm.cmd run verify --workspace tools/surface-web` | Passed; 34 reference files/assets with recorded edits reversed |

The 12 new regressions load the actual preview module through Vite and cover
metadata/accent/type search, idle queue, oldest-only advancement, accepted versus
installed, duplicate requests, cancellation before execution, refusal to cancel a
running request, failed-update version retention and continuation, explicit
reinstallation, model blocking, connector authorization cancellation and missing
agent dependency. They do not create a host implementation. Preview JavaScript is
bundled and behavior-tested; it is not separately covered by TypeScript checkJs.

The main Web build retains its existing >500 kB chunk warning (716.32 kB main JS,
204.23 kB gzip). The final isolated preview is 69.29 kB JS (22.25 kB gzip), 31.79 kB
CSS (7.09 kB gzip), the canonical 931.30 kB symbol PNG and the local 48.25 kB Inter
font. Vite plugin-timing notices are informational. No unrelated shell or canonical
brand asset was rewritten to silence warnings.

## Fixes made during validation

- Added a dedicated build/preview recipe because the canonical single Web entry
  intentionally does not include this standalone page. Production output is
  untouched by the separate `out/store-preview` target.
- Removed two unused Meridian token references to absent experimental images.
- Extracted serial queue/cancellation transitions into a pure presentation adapter
  delegating to the existing reducer and `DEMO_FAILING` fixture; removed the
  duplicate item-specific failure check and tested actual behavior.
- Recorded the shared metadata search change as a reversible adaptation in
  `web-layout-reference-2026-10-10.json`. The original upstream SHA-256 remains
  intact; verification passed after this provenance correction.

## Browser verification

[28 passing observations](browser-results.json) were recorded through the browser
UI. Development URL: `http://127.0.0.1:4201/store-preview/`. The actual final build
was served with `preview:store-preview` at `http://127.0.0.1:4204/`.

Coverage: discovery and explicit mock labels; metadata search, type/order and return
context; permission/version detail; favorites; failed Notas update retaining 0.4.1;
update-all permission review; offline pause and queued cancellation; independent
successful Files 0.5.2 and Lint 0.2.1 outcomes; known inventory during error/loading;
retry; model task filtering and disabled installation; cancelled/approved simulated
connector authorization; explicit removal preserving data and voluntary reinstall;
mobile navigation and layouts at 390×844, 820×1180 and 1440×1000 without horizontal
overflow. Console observations were empty for errors/warnings. The compiled entry
loaded and metadata search worked without development-time TypeScript imports.
Temporary viewport overrides were reset after checking.

![Compiled preview, desktop Argila](desktop-argila.jpg)

![Compiled preview, mobile Grafite](mobile-grafite.jpg)

## Remaining boundaries

Real installation, receipts, grants, OAuth, signed model lifecycle, account state,
backend integration, Native execution, physical rollback and production promotion
remain outside this preview. The contract tests and simulated browser flows do not
prove these capabilities. User visual review and any later integration through
canonical owners remain separate gates.
