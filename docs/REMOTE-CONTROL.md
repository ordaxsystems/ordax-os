# OrdaX Remote / Control Capability

Status: OWNER/DEVELOPMENT RECOVERY FOUNDATION IMPLEMENTED / CANONICAL REMOTE ACTIVATION BLOCKED / NOT BOOT-CRITICAL / STABLE-MVP EXCLUDED

## Decision

The OrdaX bootstrap does not require SSH, Device Agent remote control or Control Plane to boot, develop normally or receive ordinary updates.

For the **Owner/Development USB**, a concrete physical-development requirement now exists: when the notebook is booted from the development USB, an authorized operator needs a bounded way to collect diagnostics and recover the normal Git/runtime path without requiring repeated local shell transcription and photographs.

This requirement does not turn Git into a command bus and does not add a generic remote shell.

The normal Owner update path remains:

```text
GitHub main
 -> ordax-pull
 -> verified local checkout
 -> ordax-run
```

The optional Owner recovery path is:

```text
canonical OrdaX Control Plane
 -> authenticated/fenced Device Agent job protocol
 -> exact owner-development device credential
 -> typed Owner recovery capability
 -> local receipt/audit result
```

Therefore:

```text
SSH_REQUIRED=NO
REMOTE_CONTROL_REQUIRED_FOR_BOOTSTRAP=NO
REMOTE_CONTROL_REQUIRED_FOR_NORMAL_GIT_UPDATE=NO
CONTROL_PLANE_REQUIRED_FOR_BOOTSTRAP=NO
OWNER_REMOTE_RECOVERY_BOOT_CRITICAL=NO
STABLE_MVP_OWNER_RECOVERY_INCLUDED=NO
```

## Owner/Development recovery foundation

The portable Linux transport is owned by the canonical `ordaxsystems/ordax-runtime` repository. OrdaX OS owns the distribution-profile boundary, exact artifact pin and local activation policy.

Canonical OS source records:

- `bootstrap/base-update/owner-development/owner-recovery-source.json` — exact Runtime source/artifact pin;
- `bootstrap/base-update/owner-development/ordax-remote` — Owner-only local controller;
- `system/services/base-update/dev-helpers.sh` — atomic promotion to `/usr/local/bin/ordax-remote` on the Development USB.

The controller and its artifact pin deliberately remain **outside `system/`**, because the Native release assembly copies the shared `system/` tree into release staging. The Stable/MVP release tree must not contain the Owner administrative recovery controller or its downloadable-agent pin.

The existing physical Owner sparse checkout already includes `/bootstrap/base-update/`, so the current development USB can receive the controller and pin through its existing `ordax-pull` path. No new sparse rule and no USB reflash are required for ordinary delivery of this helper.

The remote capability allowlist is deliberately narrow:

- `agent.owner.snapshot`;
- `agent.owner.git_status`;
- `agent.owner.pull`;
- `agent.owner.runtime_stop`;
- `agent.owner.runtime_start`.

These actions accept no remotely supplied command/path arguments. Generic shell, arbitrary paths, raw block devices, package installation, Git push, release signing and generic process control remain outside this boundary.

The local controller downloads only the exact content-addressed Runtime artifact bound by source SHA, byte size and SHA-256, and stores device credentials only in persistent local state. The device token must be a regular non-symlink file with mode `0600`.

The controller proves that it is running on the physical Owner media from the same boot identity owned by `bootstrap/initramfs/source.json`: the exact boot token is pinned in `owner-recovery-source.json`, and the kernel command line must contain **exactly one** `ordax.distribution_profile=owner-development` token and no conflicting distribution-profile token. A caller-supplied environment variable does not grant Owner authority. Required BusyBox applets are invoked through `/bin/busybox`, matching the development-base execution model instead of depending on applet symlinks.

## Activation state

Source implementation does **not** imply a live remote-access claim.

The Owner agent remains non-automatic and fail-closed until all of the following are true:

1. the canonical OrdaX Control Plane endpoint is provisioned and authorized for this engineering-device protocol;
2. this physical Owner USB has a canonical device identity and device-scoped credential;
3. the exact pinned agent artifact is downloaded and verified on the device;
4. the authenticated WSS session and at least one read-only recovery action are physically proven.

No parallel Worker, alternate Cloudflare account, Git-hosted credential, operator bearer embedded in source, SSH fallback or temporary command channel may be introduced to bypass those gates.

Failure or absence of the optional remote channel must never block boot, local networking, Git updates, recovery shell or the Surface.

## Stable/MVP boundary

The Owner remote-recovery component is **not** part of the Stable/MVP USB.

Stable/MVP continues to use the public product authority and signed release/update path. It must not inherit Owner engineering credentials, development helpers or administrative recovery capabilities merely because the components share the same repository.

Product-facing remote actions remain a separate Action Gateway / Device Agent capability-grant problem with account, Space, project, device, read/write grant and audit boundaries.

## Product remote requirement

Authenticated OrdaX Web/Mobile clients may eventually observe live business/device state and request narrow remote actions.

Initial examples include:

- Pizzaria: order state and production-queue continuity across desktop and phone;
- Impressão 3D: print-job progress, printer connectivity/faults and later explicitly authorized actions such as pause/cancel.

The shared product path remains:

```text
Web / Mobile / Desktop / Native / MCP
 -> authenticated OrdaX account + Space
 -> Operational Realtime for observation
 -> Action Gateway for mutation requests
 -> exact Device Agent capability grant
 -> device adapter
 -> receipt + audit
```

Account sync is not the command bus. Push notifications are not command transport. A client request is not authority.

## Permanent security requirements

Remote management must use normal versioned components and established transport/crypto primitives.

Requirements:

- mature audited secure transport/crypto;
- explicit device/operator authorization;
- structured capabilities instead of unrestricted shell;
- exact execution identity/fencing for mutable work;
- durable terminal receipts where the protocol requires them;
- no custom ciphers, key exchange or signatures;
- no private keys, device tokens or operator bearer secrets in Git;
- no raw-disk authority through the Owner recovery channel.

SSH is not the planned fallback by default.

## Migration rule

Do not import the legacy SSH/QEMU/F7 remote stack into this clean-room repository.

The legacy implementation remains evidence of previous experiments only. Reuse individual security invariants when relevant, not the subsystem itself.


## Owner Runtime after authenticated pairing

The existing ordax-remote controller now accepts **enable-auto** and
**disable-auto** on an Owner/Development physical boot. enable-auto requires
the canonical device-scoped credential files and persists a 0600 consent marker
under /state/ordax/owner-remote/auto-start-enabled. disable-auto removes the
marker and requests the pinned agent to stop. Credential files are never
printed or embedded in the source tree.

ordax-run checks that explicit marker only **after** starting the Guardian
and launches ordax-remote ensure asynchronously. The controller continues to
enforce the physical boot token, pinned artifact source, file digest/size,
device-scoped pairing and ownership of the running PID. A missing pin, wrong
identity, unavailable network or rejected Control Plane session cannot block
the Surface, boot, local Git updates or rollback.

The source-level connection path is not evidence that the notebook is paired
or reachable through the ChatGPT MCP. Physical activation must still prove
authenticated device enrollment, verified artifact acquisition, WSS session
and at least one audited read-only recovery action. The separate Windows
MCP target does not grant credentials to the Linux USB.
