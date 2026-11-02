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

Chromium adapter suites run **serially** (`--test-concurrency=1`) because simultaneous browser processes on resource-limited Windows hosts caused a reproducible child-process close timeout; the identical 12 checks passed with serialized browser execution on the physical Windows test host. Individual E2E assertions and evidence gates remain unchanged.\n\nA separate **real child-process integration test** drives this same NDJSON CLI end-to-end in Chromium (including semantic click, window selection, accessibility, E2E and artifact publication). It is an adapter fixture, not a substitute for product Windows E2E. The Bridge supports `launch`, `close`, `list_windows`, `select_window`, `navigate`, `inspect`, `assert`, `click`, `type`, `screenshot`, `get_logs`, `get_accessibility_tree`, `run_e2e`, `compare_visual`, `collect_artifacts`, and `scan_layout`. Window IDs returned by `list_windows` are stable within the bridge process, and `select_window({id})` selects a window for subsequent actions without mouse coordinates. Electron window activation is permitted only in the isolated test desktop. Prefer semantic `{"role":"button","name":"Ajustes"}` or `{"testId":"..."}` targets; bounded CSS is available only where a semantic target does not exist.

The layout scanner is **modal-aware**: when a visible `aria-modal=true` dialog is mounted, it measures its active controls and reports the background desktop separately in `excludedBackgroundTargets`; inert or `aria-hidden=true` subtrees and disabled controls do not produce false overlap alarms. Raw `interactiveElements` is the total document count; `scannedInteractiveElements` reports how many active controls were checked and `unscannedInteractiveElements` reports any controls beyond the 300-item bound. Visible modal controls are selected before applying that bound. `visibleHitTargets` represents active candidates, and `disabledInteractiveElements` is a separate diagnostic. This keeps First Run overlays from being misdiagnosed as dozens of overlapping underlying OS controls.

`run_e2e` always tests the **actual OrdaX Native boot root** and state. The optional `semantic-journey` adds 1–30 caller-supplied typed click/type/inspect/**assert** actions. Unlike the read-only `inspect` operation, `inspect` *inside a journey* requires one mounted, visible element and **cannot silently pass when absent**. `assert` verifies a unique element, visibility, optional bounded `textContains`, `minWidth` and `minHeight` using explicit timeouts (100–30,000 ms). Failed steps emit an `e2e-failed-NN.png` screenshot and fail the invocation. `navigate` is confined to local Web previews and cannot navigate the installed Electron app away from its product origin. The bridge does not fabricate unavailable screens.

Screenshots, trace ZIPs and structured diagnostics are stored under `out/visual-test-bridge`. Trace ZIPs and diagnostics are also **append-only**: if a directory already contains artifacts from an earlier process or `collect_artifacts` is called again, the bridge assigns a `-v02`, `-v03`, etc. suffix rather than overwriting a prior receipt; existing evidence remains untouched. An explicit caller-supplied output directory should be dedicated to testing, not a real profile. Screenshot identifiers are **append-only within a bridge process and artifact directory**: requesting an existing name fails rather than overwriting a prior baseline. Repeated `run_e2e` calls and repeated failing steps receive distinct evidence filenames, so the first screenshot cannot silently mutate into a later state. Diff PNGs are append-only, automatically naming repeated differences with `-v02`, `-v03`, etc., using exclusive creation; repeated comparisons remain executable without overwriting baseline evidence. `compare_visual` also accepts `referenceCapture`: first use `screenshot({name:"web-home"})`, close that disposable session, launch the installed Electron in the **same bridge process**, then use `compare_visual({name:"desktop-against-web",referenceCapture:"web-home"})`. Both sessions retain independent trace files; visual mismatches produce a red-pixel transparent `*-diff.png` artifact. This does not bypass OS/API permissions, imply visual equivalence at different viewport sizes, or approve a new baseline. Baselines live under `tools/visual-test-bridge/baselines` and must be explicitly reviewed and committed; a missing baseline fails closed. Comparisons use channel tolerance 10 and maximum mismatched ratio 0.001 by default. No PII-bearing screenshots may be committed: ephemeral test profiles only.

## Installed Windows CI proof

The path-scoped `.github/workflows/visual-test-bridge.yml` runs the adapter contract separately from an **installed-product** job. The installed job selects the most recent **successful main-only** Windows Desktop NSIS workflow artifact (already compiled; **no kernel, Buildroot, USB or new installer compilation**), validates artifact identity and installed OS provenance, installs into a new temporary directory on a disposable GitHub-hosted Windows runner and invokes `installed-e2e.cjs`.

**Twenty consecutive independent full installed Electron journeys** must each pass actual Native boot/root, first-run wizard (`Início → Conta → Segurança → Revisão`), Home/Conta/Ajustes/Sistema windows, CSS/DOM inspection, accessibility checks, visual differentiation, screenshot generation and clean teardown. Every iteration writes its own trace, screenshots and diagnostics under `out/visual-test-bridge/installed/run-NN`; a `runs.json` receipt and exact installed executable SHA-256 are published as CI artifacts. Failure on the **first** journey aborts the remaining repetitions to avoid wasting runner resources. **A passing adapter fixture or 20 boot-only runs does not satisfy the full installed navigation gate.** An authorized OrdaX Runtime MCP receipt remains a separate independent acceptance test, never simulated.

This runner is ephemeral and must never be repointed to the human Windows desktop. GitHub artifacts expire, so resolution of the latest successful artifact fails closed when missing; neither an expired nor an unverified bundle is silently replaced.

## Existing cross-owner First Run dependency (do not duplicate)

The Windows Desktop four-stage First Run is already fixed in **[OrdaX OS PR #2343](https://github.com/ordaxsystems/ordax-os/pull/2343)**. That owner's native composition establishes `productMode: windowsDesktopHost ? "desktop" : "usb"` for the **same Surface renderer**, and its contract removes the USB-only Network step and the old standalone Device step from the Desktop presentation. This Visual Bridge PR must **not copy that patch** or forge `productMode` in JavaScript, cookies, query parameters, or the Playwright fixture.

An older, already-published main installer `61ac8aafc6f0969ceab616482dbe3644942ccfbd` still displays **six** First Run steps, so the full navigation gate intentionally fails with the exact stage list. The boot-only 20/20 success from [run 41401406068](https://github.com/ordaxsystems/ordax-os/actions/runs/41401406068) is valid for that narrower test but **is not full navigation proof**.

The bridge selects only a completed successful **main** NSIS, so it does not consume an unverified draft installer from a separate branch. A single cheap **ubuntu-24.04 installed-source job** runs in parallel with the adapter suite and fails closed if the owner First Run PR has not merged; only when it passes does GitHub allocate a Windows runner for the installed E2E. The source/run SHA are passed through job outputs, avoiding duplicate checks or downloads. This reduces expensive Windows runner usage without converting a missing full E2E into success. A cheap, read-only GitHub provenance preflight now requires **owner PR #2343 to be merged** and its merge commit to be an ancestor of the exact successful main NSIS source SHA. It runs **before checkout, npm installation and the large artifact download**, and does not replace E2E or duplicate First Run source-text logic. After the owner merges #2343 and the canonical Windows build succeeds, rerun the bridge's installed gate on the new artifact. The independent Surface Web first-use bug (account refresh still holding local-only Security disabled) is tracked with its owner in [Surface issue #71](https://github.com/ordaxsystems/ordax-surface/issues/71). There is no bypass of these gates.

## Security and proof gate

- Electron is invoked through Playwright's documented experimental `_electron.launch` support (Electron 40 is above the supported v21+ minimum). The Electron application's `contextIsolation`, `sandbox` and `nodeIntegration:false` remain unchanged. Automation explicitly requests Chromium sandbox.
- The developer CLI listens **only to stdin**; there is no CDP port exposed by this code and no generic terminal or OS control operation.
- Electron/Native child processes receive a **limited OS environment allowlist** (PATH, TEMP, user profile, Windows system directories, optional Linux display vars) and the established test-profile flags; GitHub tokens, Groq/OpenAI API keys, OrdaX Platform credentials, `NODE_OPTIONS` and arbitrary `ORDAX_*` entries never inherit from the agent. In development only, the existing explicit `ORDAX_DESKTOP_LOCAL_DEV=1` opt-in is permitted.
- Every Electron session gets a fresh disposable `OrdaX OS Desktop Dev Test` profile using the host's **existing** test-profile guard; production userData is never selected.
- **Do not run Electron tests in a human's interactive Windows session**. Use dedicated user/VM or isolated CI runner to avoid stealing mouse focus; hidden/offscreen rendering is not declared proven.
- A GitHub workflow or MCP execution requires an existing authorized runner/device. This file does not change OrdaX Runtime/Platform grants. Invoking the local CLI over an MCP terminal must be authorized by the Runtime owner; a dedicated MCP adapter, if needed, belongs in `ordax-runtime`.
- 20 consecutive full desktop E2E runs and installed-app proof are promotion gates, not statuses inferred from source code or unit tests.
- No kernel, USB, Buildroot or EROFS changes are required for this test tool.