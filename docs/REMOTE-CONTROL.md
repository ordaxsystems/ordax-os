# OrdaX Remote / Control Capability

Status: OPTIONAL FOR BOOTSTRAP / PRODUCT REQUIREMENT REGISTERED / RUNTIME POST-MVP

## Decision

The prototype does not require SSH, Remote Core or Control Plane to boot, develop normally or receive ordinary updates.

Normal update path:

```text
Git/GitHub
 -> release or delta
 -> OrdaX updater
 -> verify
 -> activate
```

Therefore:

```text
SSH_REQUIRED=NO
REMOTE_CORE_REQUIRED_FOR_BOOTSTRAP=NO
REMOTE_CORE_REQUIRED_FOR_DAILY_DEVELOPMENT=NO
CONTROL_PLANE_REQUIRED_FOR_BOOTSTRAP=NO
```

## Why this stays documented

A future product may still benefit from optional remote capabilities such as:

- device diagnostics;
- logs/events;
- remote recovery assistance;
- paired-device management;
- support tooling.

Those capabilities should only be implemented when a concrete requirement exists.

## Concrete product requirement

A concrete product requirement now exists: authenticated OrdaX Web/Mobile clients must
eventually observe live business/device state and may request narrow remote actions.

Initial examples are:

- Pizzaria: order state and production-queue continuity across desktop and phone;
- Impressão 3D: print-job progress, printer connectivity/faults and later explicitly
  authorized actions such as pause/cancel.

This does **not** promote Remote/Control into the first USB bootstrap. The pre-MVP work is
limited to the provider-neutral schemas in `system/contracts/operational-realtime.mjs`
and `docs/contracts/operational-realtime.json`.

The shared product path is:

```text
Web / Mobile / Desktop / Native / MCP
 -> authenticated OrdaX account + Space
 -> Operational Realtime for observation
 -> Action Gateway for mutation requests
 -> exact Device Agent capability grant
 -> device adapter
 -> receipt + audit
```

Account sync is not the command bus. Push notifications are not command transport.
A client request is not authority.

## If implemented later

Remote management must be a normal release component, not a reason to enlarge the initial USB without evidence.

Requirements:

- OrdaX-owned application protocol if useful;
- mature audited secure transport/crypto;
- explicit authorization;
- structured capabilities instead of unrestricted shell as the default;
- no custom ciphers, key exchange or signatures;
- no private keys in Git.

SSH is not the planned fallback by default. Add any emergency remote path only after a specific need is demonstrated and documented.

## Migration rule

Do not import the legacy SSH/QEMU/F7 remote stack into this clean-room repository.

The legacy implementation remains evidence of previous experiments only. Reuse individual security invariants if they become relevant, not the subsystem itself.
