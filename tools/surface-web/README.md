# Canonical OrdaX Web build

Presentation: system/surface/workspace/components/central. Thin entry: system/composition/web/main.tsx.
Approved reference: ordaxsystems/lovable-core-ui@89438133b322e3ef87e862c80af3a3dbe18251f5.
Central and classic desktop share one account session, navigation metadata and themes; they are views of one page.
Root package.json/package-lock.json own dependencies.

From repository root:

    npm ci --ignore-scripts --no-audit --no-fund
    npm run build --workspace tools/surface-web
    npm run verify --workspace tools/surface-web
    python tools/surface-web/build.py build --source-commit <full-git-sha> --out-dir out/web-client
    python tools/surface-web/build.py verify --out-dir out/web-client
    node tools/surface-web/browser-smoke.mjs --bundle-dir out/web-client

npm run preview --workspace tools/surface-web serves compiled presentation at
http://127.0.0.1:4201/. The reference's controls select panels and desktop view within the same page. No alternate product route
or redirect. Node >=22.18 is needed on the build/proof host, not user browsers.

Chrome/Chromium or Edge is required for proof; ORDAX_CHROME_BIN can specify the
executable. Evidence is generated under out/web-viewport-proof.

Framework, assets and font are locally bundled. Candidate receipts contain
source-input and emitted-file digests; they are not signed releases.
Account session and read-only Spaces use the existing same-origin adapters. Pending controls and unavailable states
remain in their existing sources and grant no authority. Native/Account browser proofs
share only test infrastructure under tools/browser-proof.

Window controls are owned by the shared Central reducer and WindowLayer. Both
presentations keep app nodes mounted across minimize/compact/restore and view
changes. Compact mode reserves a lower viewport track; collapse/minimize return
space to the upper area. Close/reload do not retain local drafts. This is still
a presentation increment; automated viewport/lifecycle checks were updated,
not executed locally. See the shared lifecycle record in Desktop Identity.

Account/Spaces wiring is source-ready, not a production activation claim.
The host origin must serve the existing /auth/session, /auth/logout,
 /account/spaces and /login/ routes. /conta/ is the public account destination.
A standalone Vite/static origin without this gateway stays unavailable; no
cookie extraction, cross-origin proxy, credentials or second backend is added.
Space selection reuses ordax.space-selection/1 and the Native domain service
with a session-only Web record adapter. No Space is selected automatically;
catalog removal/archiving, account changes and logout invalidate context.
Reloading the page requires choosing again; no selection sync or persistence
is advertised. The current Web adapters do not provide projects,
activity, devices, subscription/usage or inference. These cards retain their
layout and destinations with explicit availability states instead of demo data.
Identity changes remount only the session workspace to clear local account
drafts/windows; refresh of the same subject preserves its app instances.
Account tests and browser assertions were updated as source only, not executed
locally under the standing user restriction.

Appearance uses the existing Web preference-store adapter and canonical
preference-runtime/catalog. The one mounted provider feeds Central/Desktop and
Ajustes, including wallpaper and native control color scheme. No direct storage
calls remain in Central. Theme persists locally where the browser permits;
failed saves keep session appearance and surface a notice in Ajustes. View mode
is session-only UI state. No account sync or backend preference endpoint added.
Preference regression source is included in existing CI, not run locally under
the standing restriction.
