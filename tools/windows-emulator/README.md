# OrdaX Windows Emulator

Development-only host for running the OrdaX post-boot experience on Windows without booting the Linux kernel, initramfs or USB image.

## Purpose

- reuse the real OrdaX first-run UI and contracts;
- load the repository-backed Surface in the same development session;
- enable fast UI work with Vite reload instead of rebuilding kernel/rootfs/media;
- provide a stable browser window that MCP/Desktop tooling can inspect and interact with;
- keep the Dev USB as the authority for real boot, hardware, kernel and native integration.

This is an execution target, not a third OrdaX distribution.

## Run

From the repository root:

```bash
npm install
npm run emulator:windows
```

The emulator listens on `127.0.0.1:4202` and opens `/tools/windows-emulator/index.html`.

## Current host behavior

- kernel: absent by design;
- first-run: real `system/surface/ui/first-run.mjs`;
- first-run persistence: browser `localStorage`, isolated under emulator-specific keys;
- online identity actions: unavailable for now, so local-only onboarding remains supported;
- network/hardware management: unavailable for now and must stay visibly unavailable rather than being faked;
- post-onboarding Surface: repository `system/composition/web/index.html`;
- reset: use the `Reiniciar primeiro uso` development control.

The page exposes `window.__ORDAX_EMULATOR__` so automation can identify the target, inspect the first-run state and reset the flow without pretending that native kernel capabilities exist.

## Architecture rule

Do not copy Surface/OOBE implementation into this directory. Emulator-only code may provide host adapters and development controls, while product UI and business rules remain owned by `system/`.

Do not add kernel, Buildroot, initramfs or Creator steps to this target. Changes that only affect this emulator or shared UI should not require kernel/media builds.
