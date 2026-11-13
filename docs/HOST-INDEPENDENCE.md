# Host Independence

Status: CANONICAL FOR PROTOTYPE

## Goal

The OrdaX architecture must not require WSL, QEMU, PowerShell, Bash, a specific Linux distribution or a specific desktop operating system as a source authority or mandatory development/install dependency.

This does not mean hardware can be accessed without platform APIs. It means platform differences are isolated behind small adapters while the product logic, media format, verification rules and provisioning plan remain shared.

## Host-neutral cores and owners

Portable behavior remains split by canonical owner rather than copied into one repository:

```text
ordaxsystems/ordax-creator     # Creator Core + host adapters + media consumer
ordaxsystems/ordax-os          # OS artifact/media contracts + producers/proofs
ordaxsystems/ordax-desktop     # Windows shell/packaging; no raw-media ownership
```

Creator host adapters may use unavoidable Windows/Linux/macOS device APIs, but the **Creator Core in its own repository** owns target/media-consumer policy. OS-side `tools/creator/` may produce/verify payloads and release evidence but must not duplicate the independent Core. Desktop may launch Creator but must not implement a second privileged writer.

## OrdaX Creator

The intended end-user media-preparation product is one independently owned product: `OrdaX Creator` (`ordaxsystems/ordax-creator`).

Responsibilities:

1. identify target media safely;
2. download or select signed OrdaX artifacts;
3. verify integrity/authenticity;
4. create the canonical two-partition layout;
5. materialize the bootstrap and selected release;
6. verify writes;
7. preserve the Native SSD/NVMe/HDD installation foundation for explicit post-MVP activation, without exposing it in the Stable/MVP product;
8. never depend on WSL or a user-installed Linux environment.

Different host builds may use different OS APIs internally, but they expose the same behavior and consume the same contracts.

## Build independence

A user preparing the MVP OrdaX USB must not need a kernel toolchain, WSL or QEMU. Future Native installation must preserve the same host-independence rule when activated post-MVP.

Official kernel/initramfs artifacts can be built by reproducible CI/build infrastructure from source contracts, signed, and then consumed by OrdaX Creator.

Developers may build locally when their host supports the required toolchain, but local build capability is optional rather than an architectural dependency.

## QEMU policy

QEMU is optional test infrastructure, never an architectural requirement.

```text
QEMU_REQUIRED_FOR_PRODUCT=NO
QEMU_REQUIRED_FOR_CREATOR=NO
QEMU_REQUIRED_FOR_SOURCE_AUTHORITY=NO
```

Disposable emulation may be used when useful, but equivalent contracts must also support static image verification, CI checks and real-hardware validation. No canonical source rule may assume QEMU exists.

## Shell policy

Portable core behavior must not be implemented only as shell scripts.

Small shell/PowerShell launchers are acceptable as developer convenience wrappers, but they cannot be the only implementation of a canonical operation.

## No duplicated platform product

Platform adapters are infrastructure boundaries, not forks.

Forbidden:

```text
creator-windows-with-its-own-policy
creator-linux-with-different-policy
```

Required:

```text
shared Creator policy/core
   -> Windows raw-device adapter
   -> Linux raw-device adapter
   -> macOS raw-device adapter
```

All adapters must pass the same conformance tests wherever the host permits the operation.
