# OrdaX OS Desktop Dev — Windows (Alpha)

A local, installable development shell for **the canonical Native Surface**.
This is not a separate Windows port of OrdaX OS or a fake USB kernel. The Surface,
First Run, preference contracts and UI are loaded from `system/`; the existing
`tools/windows-emulator/dev-supervisor.mjs` retains the Git fast-forward policy.

## Development

From the repository root:
```
npm ci
cd tools/windows-desktop
npm ci
npm start
```

Build an **unsigned per-user NSIS installer** from Windows:
```
npm run dist:win
```
Installer output: `out/windows-desktop-installer/` from repository root.
The CI workflow `windows-desktop-dev.yml` builds an artifact in pull requests.

## Runtime, source parity and Pull

- Electron is a thin sandboxed window; Node.js is provided by Electron in Node mode.
- The Native Surface is the real `system/composition/native/index.html`.
- Development mode uses the current repository directly; dirty worktrees pause Pull.
- Installed mode bundles a **read-only snapshot**, so it can open offline.
- When Git and GitHub are accessible, installed mode clones the canonical
  `ordaxsystems/ordax-os` branch `main` into the user's private app-data directory,
  verifies the exact official remote, then reuses `dev-supervisor.mjs` to perform
  bounded fast-forward Git updates. No reset/discard on divergence or local edits.
- If Git acquisition fails, the bundled snapshot opens with Pull **inactive**;
  this is documented in the app log and is not presented as successful update.
- Existing partial checkouts are preserved for investigation, never deleted.
- The installer itself is not automatically replaced by OrdaX Pull: native
  shell upgrades and signed public release update gates remain separate.

The app saves First Run and preferences under the Windows user's application
data directory. It never touches the physical USB or claims USB/UEFI boot parity.
The host adapters remain fail-closed for local login authority, network hardware,
power, privileged app-data, and other capabilities not available on Windows.

## Verification

```
node --test tools/windows-desktop/runtime.test.cjs
node --test tests/test_windows_emulator_native_host.mjs
```

Run the installer on an isolated Windows test profile, then verify actual
window rendering, First Run persistence, and an observed Git remote-check +
fast-forward update. Those proofs must be recorded before declaring a complete
desktop build. This alpha is **not** promoted to Stable/MVP.
