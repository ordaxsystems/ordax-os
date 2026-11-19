# OrdaX Desktop Adapter

Status: CANONICAL OS-SIDE CAPABILITY BOUNDARY

`system/adapters/desktop/` contains the **OS-owned side of desktop capability contracts**. The Windows application host, Electron lifecycle, NSIS packaging and Desktop delivery belong to `ordaxsystems/ordax-desktop`; this directory must not become a second Desktop implementation.

The shared Surface remains owned by `ordaxsystems/ordax-surface` and is selected by the OS composition. Platform-specific capability differences stay behind public ports/adapters rather than copied UI or app source.

## Authority model

OrdaX Desktop runs as a normal user application by default.

```text
system/surface
  -> capability interfaces
     -> system/adapters/desktop
        -> unprivileged desktop runtime
           -> narrow privileged helper only for an approved operation
```

The desktop runtime must not expose a generic privileged shell, arbitrary command execution, or unrestricted raw-device API to the Surface.

## Initial capabilities

The adapter may implement these capability families:

- local file open/save and user-selected directory access;
- native notifications;
- app protocol/deep-link handling;
- safe background work supported by the host;
- local application/file integration;
- desktop application version and signed updater state;
- OrdaX release download and cryptographic verification;
- removable-device discovery;
- explicit OrdaX USB creation and post-write verification;
- bootable-device pairing, diagnostics and recovery assistance.

Every capability must declare whether it is:

- unprivileged;
- user-consent gated;
- privileged-helper gated;
- unavailable on the current host.

## Store boundary

The OS-side Windows Store transport is owned by this adapter (`verified-store-catalog-host.mjs`, `store-lifecycle-host.mjs` and `store-artifact-transport.mjs`) and consumes the canonical [Store services and verified projection](../../services/apps/README.md). It reuses the signed catalog, generated package policy and runtime-component lifecycle; it must not become a second Store, catalog, updater or installation authority. The Windows host/shell/package delivery remains owned by `ordaxsystems/ordax-desktop`.

## Creator boundary

Creator is an independent product/source owner in `ordaxsystems/ordax-creator`. Desktop may expose or launch the Creator experience, but this adapter does not own Creator Core, media policy or physical-write authorization.

The direct dependency is a verified OrdaX media/candidate contract. Creator validates the authorized artifact, requests explicit target consent and performs its own bounded write/readback path. Do not rebuild Creator or duplicate its device policy inside this adapter.

## Update separation

Two update channels exist and must never be conflated:

```text
OrdaX Desktop application
  -> signed desktop-app updater

OrdaX bootable/native system
  -> verified OrdaX release acquisition/activation
```

Updating the Windows application must not silently write a USB or alter the host boot configuration. Downloading an OrdaX OS release must not silently install it to an internal disk.

## Verified Store boundary on Windows

The Desktop host may transport the read-only `ordax.verified-app-store-catalog/1` snapshot and an authority-free lifecycle proposal, but it does not own a second catalog or installer. Every install/update/remove request is revalidated against the signed catalog, generated first-party package policy and canonical runtime-component state.

Install/update artifact URLs are derived from signed identities; redirects, foreign origins, wrong length/hash and oversized artifacts fail closed. The canonical Go component owner performs verify/stage/arm and returns only a durable `pending_health=unknown` generation—health, promotion, rollback and cleanup remain with the component Supervisor. Remove uses the same signed owner and durable removal state. Renderer input cannot select artifact URL/version, trust root or signing authority.


## Shared Surface invariant

Desktop-specific code may provide capabilities and host chrome integration, but must not recreate:

- desktop UI;
- window manager UI;
- settings UI;
- first-party apps;
- design tokens;
- account/product behavior.

Those remain in the shared `system/surface/`, `system/apps/` and `system/services/` trees.

## Implementation baseline

The current Windows host is implemented and delivered from `ordaxsystems/ordax-desktop`. This OS adapter remains framework-neutral and supplies only the capability/host boundary needed by the composed product. Do not reintroduce the former `tools/windows-desktop` product implementation, choose a second shell framework here, or make the OS repository a competing Windows packager.

No private signing key, device private key, access token or release-authority secret belongs in this directory or in a shipped client bundle.
