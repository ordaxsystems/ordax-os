# OrdaX Windows Emulator

Development host for the real Native composition used by OrdaX OS USB.
The frame loads `system/composition/native/index.html` from First Run through
the desktop. There is no emulator-owned welcome UI or Web preview handoff.
All product markup, behavior, styles and Meridian tokens come from `system/`.

## Run

From the repository root, with workspace dependencies already installed:

```bash
npm run emulator:windows
```

Open `http://127.0.0.1:4202/tools/windows-emulator/index.html`.

To test from another computer on the same trusted local network, set `ORDAX_EMULATOR_HOST` to the development PC LAN address before starting Vite (for example `192.168.100.197`). The default remains loopback-only. This exposes the development host and its mock state endpoints to that LAN; it is not a production server or a bridge to USB hardware.
The existing development supervisor watches origin/main and applies only a clean
fast-forward. Local edits pause Git updates; Vite continues serving the checkout.
Network failure or divergence never causes reset/discard of source work.

For a server without automatic Git synchronization:

```bash
npm run emulator:windows:vite
```

## Native capability boundary

`native-host.mjs` supplies development-only implementations of the existing
Native preference, First Run receipt and safe navigation cursor endpoints.
They validate canonical contracts and persist in `out/windows-emulator-state/`,
separate from physical USB state. Resetting First Run preserves preferences.
Unreadable persisted data is not silently overwritten.

The emulator does not provide Linux/kernel boot, Wi-Fi control, power actions,
disk access, local authentication credentials, verified package installation,
privileged WebKit App Data or Intelligence host IPC. Unsupported endpoints fail
closed; the existing Native UI reports their capability availability. No fake
privileged browser bridge or authenticated identity is installed.

Existing older emulator browser-storage keys remain untouched; they are no longer
runtime authorities. The canonical Native adapters now own the UI's ports.

The development-only First Run reset stays outside the Native frame and is not
shipped as product UI. It is hidden in the normal emulator view; append
`?dev-controls=1` to the URL when you need the reset tool.

## Verification

```bash
node --test tests/test_windows_emulator_native_host.mjs tests/test_first_run_journey_ssot.mjs
npm run emulator:windows:smoke
```

The browser smoke requires fresh development state at the welcome step. Use the
development reset control deliberately before a disposable OOBE proof; the smoke
does not clear an existing session automatically. It asserts the Native entry,
completes canonical First Run and checks persistence after reload.

Native UI parity in this host is not a proof of physical USB boot, drivers,
release provenance, stable/MVP promotion or on-device capability availability.
