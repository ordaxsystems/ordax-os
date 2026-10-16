# OrdaX Windows MVP Emulator

Development host for the same **Native Surface used by the OrdaX MVP USB**. This is not OrdaX Web and is not a separate distribution.

## What it runs

`npm run emulator:windows` starts a local-first supervisor, watches `origin/main` every 5 seconds when the worktree is clean, launches Vite on `127.0.0.1:4202`, waits until the real Native composition is healthy, and then opens a dedicated Windows preview window at:

`http://127.0.0.1:4202/system/composition/native/`

The preview is owned by the emulator supervisor rather than Vite's generic `--open` behavior, so startup fails instead of silently opening the wrong route or no usable window. The UI, OOBE, launcher, apps and product contracts are the Native MVP composition. The Windows host only replaces the Linux/kernel-facing boundary.

## Fidelity rule

Do not copy or fork the MVP UI into this directory. Emulator-specific code may only implement host transport, hardware/system adapters, development supervision and verification. If a feature exists in the MVP, the emulator must consume the same Surface/service/contract code.

Current Windows-backed native ports include:

- first-run state persistence;
- local Surface session credentials/lock state using the MVP scrypt policy and retry backoff;
- preferences persistence;
- isolated MVP user File Space with listing, import/export, text read, rename, copy, move, trash/restore and bounded previews;
- anonymous/unconfigured account session boundary;
- network status from the real Windows interfaces;
- system metrics from the real Windows host;
- power/battery status from Windows when available;
- privileged App Data bootstrap bridge (bindings are expanded as MVP app-data ports are wired).

Hardware actions that cannot safely be performed by a development emulator must remain unavailable until a contract-correct Windows adapter exists. They must never be faked merely to make a UI look enabled.

## Commands

```text
npm run emulator:windows
npm run emulator:windows:vite
npm run emulator:windows:smoke
```

The smoke test resets only the emulator's first-run state, opens the real Native MVP composition, completes the real OOBE and requires a ready Native workspace with launcher apps. JavaScript exceptions fail the test.

Persistent emulator state is stored outside the repository under the Windows local application-data directory (`OrdaX/MvpEmulator`).

## Authority

The physical MVP USB remains authoritative for Linux kernel, initramfs, bootloader, device drivers and exact physical-hardware behavior. For Surface/OOBE/apps/services, the emulator must run the same Native MVP code so visual and functional corrections made during development carry directly to the USB product.
