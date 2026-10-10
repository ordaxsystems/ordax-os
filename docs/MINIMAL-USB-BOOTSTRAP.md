# Minimal USB Bootstrap

Status: CANONICAL FOR PROTOTYPE

## Goal

The bootstrap seed contains only the minimum trusted substrate required to boot and reach the selected acquisition mechanism. It is not a preinstalled copy of the complete OrdaX product.

There are two supported acquisition profiles:

- owner/development Git-first: network -> Git -> partial+sparse checkout of `main` -> `system/entrypoint`;
- canonical signed release: network -> signed release acquisition -> verification -> immutable activation.

The profiles share the same source authority (`main`) and the same principle: ordinary `system/` changes must not require reflashing the USB.

## Physical layout model

Three contracts coexist during migration and must not be confused.

### Capacity-independent bootstrap seed — transitional source artifact

```text
ORDAX-ESP
ORDAX
```

Exactly two seed partitions.

The seed is capacity-independent and remains the source object described by `docs/contracts/physical-media.json`. It is retained while the existing boot chain is proven; it is **not** the durable MVP product layout.

### Current physical owner/development proof — transitional

```text
ORDAX-ESP
ORDAX
ORDAX-DATA
```

Exactly three prepared-target partitions.

This is governed by `docs/contracts/physical-prepared-media.json` and remains useful for current real-hardware validation. It must not be promoted as the long-term Stable/MVP storage architecture.

### Durable Stable/MVP USB target — v2

The durable product bootstrap is governed separately by `docs/contracts/portable-bootstrap-v2.json`. Unlike the transitional network-first seed, the **MVP product USB is offline-capable on first boot**: the Creator must already place one signed/verified `system.erofs` release on `ORDAX-DATA` and initialize the ext4 state image so `current` and `known-good` point to that exact release.

This does not preinstall the full product on the ESP. `ORDAX-ESP` remains boot/bootstrap-only. The product release stays under `ORDAX-DATA/.ordax/releases/`.


```text
ORDAX-ESP   FAT32
ORDAX-DATA  exFAT
```

Exactly two physical product partitions. There is no fixed physical `ORDAX` system partition.

```text
ORDAX-DATA/
├─ user files...
└─ .ordax/
   ├─ releases/<version>.erofs
   └─ state/persistent-state.img   # ext4 inside
```

The Creator Core geometry is `PlanPortableTargetStorage`. The storage contract is `docs/contracts/portable-usb-v2.json`, backed by `docs/contracts/storage-architecture.json`.

The v2 storage proof is intentionally non-destructive. The physical writer must remain on the transitional profile until v2 storage, kernel prerequisites, boot/initramfs handoff, recovery and physical-write planning have passed their independent gates.

## Bootstrap seed payload

### ORDAX-ESP

Only boot-critical material:

```text
UEFI bootloader
loader configuration
verified kernel
verified initramfs
recovery entry when required
```

### ORDAX main partition

Common roots are limited to bootstrap/runtime state. The exact payload depends on the acquisition profile.

Owner/development Git-first base:

```text
/ordax/dev-base/            # minimal runtime substrate
  shell/libc/libs
  selected drivers/modules
  selected firmware
  network tools
  CA certificates
  Git
  apk client + Alpine trust keys   # signed runtime acquisition only

/workspace/ordax/           # created at runtime, persistent, not preseeded
/state/ordax/               # Git state + replaceable runtimes after switch_root
```

The apk client is not permission to turn the base into a normal package-managed desktop. Pulled `system/` code may use it to materialize versioned, replaceable runtime roots under `/state`; Cage/Cog/Mesa and other high-level product/runtime packages remain outside the fixed seed.

Canonical signed-release base:

```text
/ordax/bootstrap/
  network/
  release-acquisition/
  recovery/

/ordax/releases/            # initially empty
/ordax/current              # unset until first release is verified
/ordax/state/               # empty/minimal runtime root
/ordax/home/                # user-data root
```

## Explicitly absent from the seed

```text
normal full Surface/runtime preinstall = NO
normal apps preinstall = NO
high-level services = NO
stable device identity service = NO
Remote Core = NO
Control Plane = NO
SSH = NO
complete repository checkout = NO
build toolchain = NO
WSL/QEMU payload = NO
legacy repository dump = NO
```

A tiny local status/recovery presentation is allowed only if required to show network, acquisition, verification or failure state.

## Owner/development Git-first boot

```text
UEFI
 -> kernel/initramfs
 -> mount LABEL=ORDAX
 -> switch_root to development base
 -> selected drivers/firmware
 -> network
 -> Git
 -> partial+sparse clone of main when checkout is absent
 -> otherwise git pull --ff-only
 -> /workspace/ordax/system/entrypoint
 -> pulled system may materialize a replaceable runtime under /state
 -> OrdaX
```

Current checkout policy:

```text
REMOTE=origin expected repository only
BRANCH=main expected branch only
LOCAL_MODIFICATIONS=BLOCK_PULL
CLONE_FILTER=blob:none
SPARSE_CHECKOUT=/system/ + /bootstrap/base-update/ + selected update/trust contracts
PERSISTENT_CHECKOUT=YES
ROLLBACK_PIN_SURVIVES_REBOOT=YES
EXPLICIT_ORDAX_PULL_RELEASES_PIN=YES
```

A valid local checkout may boot when the network is unavailable. A rollback is sticky across reboot and must not be silently advanced by boot-time synchronization. A runtime already materialized under `/state` is reusable offline; network is needed only for its first acquisition or a version change that requires new package bytes.

## Canonical signed-release first boot

### Current transitional path

This remains network-first and exists for the current hardware proof. It is not the final Stable/MVP first-boot UX.

```text
UEFI
 -> kernel/initramfs
 -> mount ORDAX ext4
 -> minimal bootstrap
 -> network when no known-good release exists
 -> acquire release envelope/artifacts over HTTPS
 -> verify integrity/authenticity
 -> materialize /ordax/releases/<commit>
 -> atomically activate /ordax/current
 -> launch OrdaX
```

### Durable portable-v2 target

The final MVP path removes the physical `ORDAX` partition. The source-controlled Portable v2 candidate handoff now follows:

```text
UEFI
 -> kernel/initramfs with exFAT + EROFS + loop + ext4 + OverlayFS built in
 -> mount ORDAX-DATA
 -> resolve verified current/known-good release image
 -> attach immutable EROFS release
 -> attach Linux-native ext4 persistent-state image
 -> compose writable runtime without using exFAT as OverlayFS upper
 -> launch verified OrdaX release
```

Activation metadata for the durable USB is intentionally **not** stored as a symlink or mutable pointer directly on exFAT. The fixed ext4 persistent-state image owns `current`, `known-good`, `candidate` and the activation transaction. This keeps Linux activation/rollback state on a Linux-native filesystem with atomic replacement and fsync semantics, while exFAT remains a byte store for immutable releases and user-visible files.

The repository now also has a disposable **mount-handoff proof** for this graph. It re-verifies a signed portable release offline, mounts the real EROFS system tree read-only, mounts the ext4 persistent-state image, composes an OverlayFS runtime system view and proves persistent writes do not mutate EROFS.

The Portable v2 handoff is now implemented in source as a candidate path: the fixed initramfs includes the loop/exFAT/EROFS/ext4/OverlayFS prerequisites, capsule/Base verification, transactional candidate/current/known-good selection, exact signed release verification and `switch_root` into the Stable Base. The older known-good disposable lifecycle evidence remains release-manifest v3 compatibility proof. The current Stable/MVP release shape is release-manifest v4: after exact verification it resolves the content-addressed `local-ai-runtime.erofs`, mounts it read-only under `/run/ordax/runtime/local-ai`, and starts the loopback backend when available; local-AI failure degrades Intelligence instead of blocking boot. Signed/materialized v4 disposable boot plus fallback are now PASS_CI in both direct-kernel QEMU and non-Secure-Boot OVMF/UEFI. The v3 proofs remain compatibility/baseline evidence rather than being relabeled as the current MVP release. This is still **not** a physical Stable/MVP proof: the candidate is not the default `/init`, no authorized physical boot entry or public apply path exists, the canonical public trust is pinned, and Secure Boot/real USB boot remain pending.

Remote access is not needed for either Stable/MVP path.

## After acquisition

Owner/development:

```text
NETWORK_REQUIRED_FOR_VALID_LOCAL_CHECKOUT_BOOT=NO
LOCAL_CHECKOUT_PRESERVED=YES
ROLLBACK_LOCAL=YES
NORMAL_SYSTEM_CHANGE_REQUIRES_REFLASH=NO
```

Canonical release:

```text
NETWORK_REQUIRED_FOR_KNOWN_GOOD_BOOT=NO
KNOWN_GOOD_RELEASE_PRESERVED=YES
ROLLBACK_LOCAL=YES
NORMAL_SYSTEM_CHANGE_REQUIRES_REFLASH=NO
```

Network/Git are required to acquire new development source or new release bytes, not to boot an already valid local state.

## Development model

Owner/development USB:

```text
system/Surface/app/native-host change
 -> Git push main
 -> ordax-pull
 -> ordax-run
 -> pulled code may provision/update replaceable runtime state
 -> no USB reflash

boot/kernel/initramfs/dev-base hardware support change
 -> separately built base candidate
 -> repository-delivered base-update control stages inactive slot
 -> next boot activates candidate
 -> manual USB reflash only when the bootstrap itself cannot recover/update
```

Canonical release:

```text
system/Surface/app change
 -> Git push
 -> CI builds signed release/delta
 -> updater acquires
 -> verify + activate
 -> no USB reflash
```

## Source/media relationship

Everything needed to reproduce the bootstrap is represented in this repository through source, manifests, configuration, provenance and build recipes. The running development checkout intentionally materializes only the product runtime plus the small base-update control plane; large boot artifacts are built from repository source and delivered as base candidates rather than compiled on the notebook.

Private/runtime data is not committed to public Git. The USB is never source authority.

The transitional bootstrap verifies its stored signed envelope, exact artifact
bytes and materialized release tree before executing the offline `current`.
It reuses the canonical `ordax-release-agent activate-exact` owner for the
selected SHA and rechecks the current identity after verification. If the
verifier is missing, the bytes do not verify or the identity changes, it
enters recovery rather than executing an unverified local entrypoint.
This transitional verification does not prove or authorize physical USB boot.

## Trust boundary

The owner/development Creator may use explicitly marked ephemeral prototype trust for development provenance. This does not satisfy canonical release trust and must never be promoted as such.

The user-controlled release signing ceremony and canonical public-anchor promotion are complete. Release acquisition remains fail-closed to that pinned trust; this does not authorize physical USB writing or claim a Stable/MVP hardware proof.

## Prototype rules

```text
GIT_MAIN_IS_SOURCE_AUTHORITY=YES
BOOTSTRAP_SEED_PARTITIONS=2
TRANSITIONAL_PREPARED_USB_PARTITIONS=3
MVP_TARGET_PREPARED_USB_PARTITIONS=2
MVP_TARGET_PORTABLE_LAYOUT=ORDAX-ESP+ORDAX-DATA
MVP_TARGET_BOOT_HANDOFF_IMPLEMENTED=YES_CANDIDATE
MVP_TARGET_PHYSICAL_BOOT_PROVEN=NO
MVP_TARGET_PUBLIC_PHYSICAL_APPLY=NO
SEPARATE_HOME_PARTITION=NO
REMOTE_CONTROL_PRESEEDED=NO
SSH_PRESEEDED=NO
FULL_SYSTEM_PRESEEDED=NO
COMPLETE_SOURCE_CHECKOUT_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
REFLASH_FOR_NORMAL_SYSTEM_CHANGES=NO
```

If a future requirement proves that device identity, Remote Core or Control Plane is necessary, it must be introduced deliberately through an architectural decision rather than added preemptively.


### Portable v2 bootstrap capsule candidate

The durable USB now has a deterministic bootstrap-capsule candidate at `/ordax/bootstrap/bootstrap.erofs`.

The capsule is deliberately small: the static release agent, local recovery entrypoint and official release-channel pointer. It excludes Surface, normal apps, user data, Git, build tools and every private signing key. The canonical public release trust anchor remains a separate bootstrap-owned object.

CI builds the EROFS capsule twice from normalized tar metadata and requires byte-identical output plus EROFS integrity verification. The candidate initramfs composition now pins the exact capsule SHA-256, and the candidate PID1 verifies and mounts the capsule read-only before continuing. Disposable QEMU media stages those bytes on the ESP. This still does **not** mean a product USB has been physically promoted: canonical trust is pinned, while authorized physical ESP materialization/public apply and real-hardware Stable/MVP boot remain independent pending gates.


### Portable-v2 candidate PID1

The fixed initramfs now carries an isolated candidate orchestrator at `/sbin/ordax-portable-init`. It is **not** the default `/init`, and no authorized physical systemd-boot entry points to it. The disposable UEFI proof uses a dedicated loader entry only inside its test media; that does not authorize or prove a real USB boot.

The candidate path is intended only for disposable boot proof through `rdinit=/sbin/ordax-portable-init`. It mounts the ESP read-only, verifies the bootstrap capsule against the initramfs-owned hash, mounts `ORDAX-DATA`, verifies the pinned Stable Base, attaches the ext4 state image, and then evaluates boot slots in this order:

```text
armed candidate (one attempt only)
 -> exact signed offline verification
 -> on failure, reject candidate durably and return to prior slot
current
 -> exact signed offline verification
 -> if invalid, resolve known-good without retargeting slots
known-good
 -> separate exact signed offline verification
 -> if none verifies, enter read-only recovery
```

A structurally incomplete candidate is rejected by the activation-state
owner without discarding a valid previous release. Malformed transaction or
slot identities remain fail-closed. Selection alone cannot authorize boot;
every selected copy must independently pass the canonical exact verifier.

Only after a release passes exact signature/hash verification does the candidate compose the Stable Base overlay, bind the verified `system/` subtree read-only, move all required mounts under the new root and invoke `switch_root` into `ordax-stable-init`.

This does not claim a physically bootable MVP yet. The candidate chain has passed disposable direct-kernel QEMU and non-Secure-Boot OVMF/systemd-boot proof, and canonical public trust is pinned; public physical apply, real USB boot and Secure Boot remain open. The transitional Owner/Development `/init` remains the only boot path physically proven on the target notebook.


### Pinned portable-v2 initramfs composition proof

CI proves that one **real bootstrap capsule** and one **real Stable Base** built from the exact source identity are both cryptographically pinned into the same deterministic initramfs candidate before either artifact is trusted by the Portable PID1.

The proof builds the capsule from the exact static release agent, builds the Stable Base from exact-source kernel modules, passes both EROFS artifacts into `bootstrap/initramfs/build.py`, and verifies that the resulting provenance and in-archive SHA-256 check files match the real bytes.

The two fixed-path verification helpers are then exercised in an isolated initramfs root: exact artifacts must pass and single-byte-tampered copies must fail. This proof does not change the default `/init`, does not promote `ordax-portable-init`, does not boot QEMU and does not authorize physical media. Those remain later gates.


### Portable v2 direct-kernel QEMU gate

After the exact-artifact pin composition gate, the next disposable boot proof uses QEMU with the exact OrdaX kernel plus the pinned initramfs candidate and a sparse regular guest disk containing the **final two-partition layout**:

```text
ORDAX-ESP  FAT32
ORDAX-DATA exFAT
```

The disk contains the verified bootstrap capsule and bootstrap-owned CI trust on the ESP, plus the real Stable Base, ext4 persistent-state image and one signed `release-manifest/2` EROFS product release on ORDAX-DATA. The ext4 state owns `current` and `known-good`.

This gate invokes the candidate PID1 explicitly with `rdinit=/sbin/ordax-portable-init`, disables guest networking and requires both the portable PID1 handoff marker and the Stable Base handoff marker. It proves the durable runtime chain without silently changing the default boot path.

This direct-kernel sub-proof is not itself a UEFI proof. A separate UEFI/OVMF gate exercises systemd-boot; neither disposable proof establishes Secure Boot, an authorized public physical boot entry or real USB hardware.

### Portable v2 UEFI/QEMU gate

After the direct-kernel candidate proof, the same disposable final-layout disk is staged with the pinned `systemd-boot` candidate at the standard fallback path `EFI/BOOT/BOOTX64.EFI`, the exact kernel/initramfs and dedicated portable-v2 loader entries. QEMU then boots it through non-Secure-Boot OVMF with networking disabled.

The disposable UEFI workflow has exercised the firmware -> systemd-boot -> exact kernel/initramfs -> Portable PID1 -> Stable Base chain with networking disabled. It does **not** prove Secure Boot, physical USB boot or public promotion. The public Creator physical apply path remains blocked.
