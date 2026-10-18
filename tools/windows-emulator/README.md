# OrdaX Windows Emulator

Development-only host for running the OrdaX post-boot experience on Windows without booting the Linux kernel, initramfs or USB image.

## Purpose

- reuse the real OrdaX first-run UI and contracts;
- load the repository-backed Surface in the same development session;
- enable fast UI work with Vite reload instead of rebuilding kernel/rootfs/media;
- provide a stable browser window that MCP/Desktop tooling can inspect and interact with;
- follow the same local-first `main` update cadence used by the Owner/Development USB;
- keep the Dev USB as the authority for real boot, hardware, kernel and native integration.

This is an execution target, not a third OrdaX distribution.

## Run

From the repository root:

```bash
npm install
npm run emulator:windows
```

The emulator listens on `127.0.0.1:4202` and opens `/tools/windows-emulator/index.html`.

For a Vite-only session without Git synchronization:

```bash
npm run emulator:windows:vite
```

## Development update behavior

The normal `npm run emulator:windows` command starts `dev-supervisor.mjs` before Vite.

The supervisor mirrors the Owner/Development USB update cadence where that behavior is safe on a developer worktree:

- starts the local checkout immediately; network is not on the critical path;
- targets `origin/main` by default (`ORDAX_REPO_BRANCH` may override it);
- checks the remote every 5 seconds by default (`ORDAX_UPDATE_INTERVAL_SECONDS` may override it, minimum 5 seconds);
- uses bounded `git ls-remote`/`git fetch` calls;
- applies remote movement only as a clean `--ff-only` fast-forward;
- if Git/network fails, the running emulator is preserved;
- if the worktree contains local development edits, automatic Git application pauses instead of deleting those edits; Vite hot reload remains active;
- if local HEAD and `origin/main` have diverged, automatic application pauses rather than resetting or force-updating the worktree.

That last distinction is intentional. The physical Dev USB owns a disposable runtime checkout and may repair it automatically; the Windows emulator is also an active source-development worktree, so it must not erase edits made by the developer or GPT/MCP.

## Current host behavior

- kernel: absent by design;
- first-run: real `system/surface/ui/first-run.mjs`, with the same `tokens.css`, `color-palettes.css`, `first-run.css`, `meridian.tokens.css` and `meridian.css` owners used by Native; the former setup storyboard is archived under `docs/evidence/first-run-ssot-2026-10-17/` and is no longer exported by the runtime journey catalog;
- first-run receipt: browser `localStorage`, isolated under the emulator-specific state key;
- preferences: the same `createWebPreferenceStore` adapter and `createPreferenceRuntime` domain service consumed by the post-onboarding Surface; locale/time zone persist across that transition. Completed older emulator receipts seed only missing regional preferences through the same policy used by Native, preserving newer Settings choices;
- online identity actions: unavailable for now, so local-only onboarding remains supported;
- network/hardware management: unavailable for now and must stay visibly unavailable rather than being faked;
- post-onboarding Surface: repository `system/composition/web/` with `?preview=layout`, through the canonical loopback-only preview gate; identity/host capabilities remain unavailable rather than simulated as authorized;
- reset: use the `Reiniciar primeiro uso` development control.

The page exposes `window.__ORDAX_EMULATOR__` so automation can identify the target, inspect the first-run state and reset the flow without pretending that native kernel capabilities exist.

## Smoke proof

With the emulator running:

```bash
npm run emulator:windows:smoke
```

The smoke proof opens an isolated Chromium/Edge session and validates the real OOBE contract. It also contains the full OOBE-to-Surface proof for execution on a machine with the complete workspace dependencies installed.

## Architecture rule

Do not copy Surface/OOBE implementation into this directory. Emulator-only code may provide host adapters and development controls, while product UI and business rules remain owned by `system/`.

Do not add kernel, Buildroot, initramfs or Creator steps to this target. Changes that only affect this emulator or shared UI should not require kernel/media builds.
