# OrdaX Visual Test Bridge (developer tool)

One **local process**, not a product service. Source and Native host remain in `ordax-os`; the visual renderer remains pinned from `ordax-surface`. MCP device permissions remain exclusively in `ordax-runtime` / `ordax-platform`. This tool does not grant access, start a remote listener, or replace the existing Chromium CDP smoke.

## Install and run

```powershell
cd tools/visual-test-bridge
npm ci
npm test
$env:ORDAX_VISUAL_ISOLATED_SESSION="1"  # only in dedicated Windows runner/VM, NOT interactive user desktop
node cli.cjs
```

Send **newline-delimited JSON** to stdin. Example for a dedicated Windows VM with the verified Desktop installed:

```json
{"id":"1","op":"launch","args":{"mode":"electron-installed","executablePath":"C:\\isolated\\OrdaX OS Desktop Dev.exe"}}
{"id":"2","op":"list_windows"}
{"id":"3","op":"run_e2e","args":{"scenario":"native-smoke"}}
{"id":"4","op":"inspect","args":{"target":{"css":"#ordax-root"}}}
{"id":"5","op":"get_accessibility_tree"}
{"id":"6","op":"scan_layout"}
{"id":"7","op":"collect_artifacts"}
{"id":"8","op":"close"}
```

For source development use `mode=electron-development`, the exact Electron executable at `tools/windows-desktop/node_modules/electron/dist/electron.exe` and `appPath=<absolute path to tools/windows-desktop>`. Use the existing `local-dev.cjs` to attach the **pinned** external Surface for Native development; no second visual source is created. For Web previews choose `mode=web`, `url=http://127.0.0.1:<port>/...`; only loopback URLs are accepted and the browser runs headless. The Web context blocks off-origin HTTP requests, cross-origin redirects, off-origin WebSockets, and service workers; canonical same-origin Vite HMR remains allowed. This does not modify or restrict the actual Electron product's networking. The preview service must already be started by its canonical owner.

The Bridge supports `launch`, `close`, `list_windows`, `select_window`, `navigate`, `inspect`, `click`, `type`, `screenshot`, `get_logs`, `get_accessibility_tree`, `run_e2e`, `compare_visual`, `collect_artifacts`, and `scan_layout`. Window IDs returned by `list_windows` are stable within the bridge process, and `select_window({id})` selects a window for subsequent actions without mouse coordinates. Electron window activation is permitted only in the isolated test desktop. Prefer semantic `{"role":"button","name":"Ajustes"}` or `{"testId":"..."}` targets; bounded CSS is available only where a semantic target does not exist.

`run_e2e` always tests the **actual OrdaX Native boot root** and state. The optional `semantic-journey` adds 1–30 caller-supplied typed click/type/inspect actions; it does not fabricate unavailable screens. Test cases must fail if required controls are absent.

Screenshots, trace ZIPs and structured diagnostics are stored under `out/visual-test-bridge`. `compare_visual` also accepts `referenceCapture`: first use `screenshot({name:"web-home"})`, close that disposable session, launch the installed Electron in the **same bridge process**, then use `compare_visual({name:"desktop-against-web",referenceCapture:"web-home"})`. Both sessions retain independent trace files; visual mismatches produce a red-pixel transparent `*-diff.png` artifact. This does not bypass OS/API permissions, imply visual equivalence at different viewport sizes, or approve a new baseline. Baselines live under `tools/visual-test-bridge/baselines` and must be explicitly reviewed and committed; a missing baseline fails closed. Comparisons use channel tolerance 10 and maximum mismatched ratio 0.001 by default. No PII-bearing screenshots may be committed: ephemeral test profiles only.

## Installed Windows CI proof

The path-scoped `.github/workflows/visual-test-bridge.yml` runs the adapter contract separately from an **installed-product** job. The installed job selects the most recent **successful main-only** Windows Desktop NSIS workflow artifact (already compiled; **no kernel, Buildroot, USB or new installer compilation**), validates artifact identity and installed OS provenance, installs into a new temporary directory on a disposable GitHub-hosted Windows runner and invokes `installed-e2e.cjs`.

**Twenty consecutive independent full installed Electron journeys** must each pass actual Native boot/root, first-run wizard (`Início → Conta → Segurança → Revisão`), Home/Conta/Ajustes/Sistema windows, CSS/DOM inspection, accessibility checks, visual differentiation, screenshot generation and clean teardown. Every iteration writes its own trace, screenshots and diagnostics under `out/visual-test-bridge/installed/run-NN`; a `runs.json` receipt and exact installed executable SHA-256 are published as CI artifacts. Failure on the **first** journey aborts the remaining repetitions to avoid wasting runner resources. **A passing adapter fixture or 20 boot-only runs does not satisfy the full installed navigation gate.** An authorized OrdaX Runtime MCP receipt remains a separate independent acceptance test, never simulated.

This runner is ephemeral and must never be repointed to the human Windows desktop. GitHub artifacts expire, so resolution of the latest successful artifact fails closed when missing; neither an expired nor an unverified bundle is silently replaced.

## Existing cross-owner First Run dependency (do not duplicate)

The Windows Desktop four-stage First Run is already fixed in **[OrdaX OS PR #2343](https://github.com/ordaxsystems/ordax-os/pull/2343)**. That owner's native composition establishes `productMode: windowsDesktopHost ? "desktop" : "usb"` for the **same Surface renderer**, and its contract removes the USB-only Network step and the old standalone Device step from the Desktop presentation. This Visual Bridge PR must **not copy that patch** or forge `productMode` in JavaScript, cookies, query parameters, or the Playwright fixture.

An older, already-published main installer `61ac8aafc6f0969ceab616482dbe3644942ccfbd` still displays **six** First Run steps, so the full navigation gate intentionally fails with the exact stage list. The boot-only 20/20 success from [run 41401406068](https://github.com/ordaxsystems/ordax-os/actions/runs/41401406068) is valid for that narrower test but **is not full navigation proof**.

The bridge selects only a completed successful **main** NSIS, so it does not consume an unverified draft installer from a separate branch. A cheap, read-only source-SHA probe now refuses pre-#2343 installers **before downloading the large artifact**; this probe does not replace E2E. After the owner merges #2343 and the canonical Windows build succeeds, rerun the bridge's installed gate on the new artifact. The independent Surface Web first-use bug (account refresh still holding local-only Security disabled) is tracked with its owner in [Surface issue #71](https://github.com/ordaxsystems/ordax-surface/issues/71). There is no bypass of these gates.

## Security and proof gate

- Electron is invoked through Playwright's documented experimental `_electron.launch` support (Electron 40 is above the supported v21+ minimum). The Electron application's `contextIsolation`, `sandbox` and `nodeIntegration:false` remain unchanged. Automation explicitly requests Chromium sandbox.
- The developer CLI listens **only to stdin**; there is no CDP port exposed by this code and no generic terminal or OS control operation.
- Every Electron session gets a fresh disposable `OrdaX OS Desktop Dev Test` profile using the host's **existing** test-profile guard; production userData is never selected.
- **Do not run Electron tests in a human's interactive Windows session**. Use dedicated user/VM or isolated CI runner to avoid stealing mouse focus; hidden/offscreen rendering is not declared proven.
- A GitHub workflow or MCP execution requires an existing authorized runner/device. This file does not change OrdaX Runtime/Platform grants. Invoking the local CLI over an MCP terminal must be authorized by the Runtime owner; a dedicated MCP adapter, if needed, belongs in `ordax-runtime`.
- 20 consecutive full desktop E2E runs and installed-app proof are promotion gates, not statuses inferred from source code or unit tests.
- No kernel, USB, Buildroot or EROFS changes are required for this test tool.
