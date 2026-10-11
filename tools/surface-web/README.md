# Canonical OrdaX Web build

Presentation: system/surface/workspace/components/central. Thin entry: system/composition/web/main.tsx.
Approved reference: ordaxsystems/lovable-core-ui@89438133b322e3ef87e862c80af3a3dbe18251f5.
Central and classic desktop share the same presentation data and themes; they are views of one page.
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
Service connections are the next stage. Pending controls and unavailable states
remain in their existing sources; labeled demonstrations grant no authority. Native/Account browser proofs
share only test infrastructure under tools/browser-proof.

Window controls are owned by the shared Central reducer and WindowLayer. Both
presentations keep app nodes mounted across minimize/compact/restore and view
changes. Compact mode reserves a lower viewport track; collapse/minimize return
space to the upper area. Close/reload do not retain local drafts. This is still
a presentation increment; automated viewport/lifecycle checks were updated,
not executed locally. See the shared lifecycle record in Desktop Identity.
