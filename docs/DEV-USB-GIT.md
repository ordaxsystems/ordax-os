# OrdaX Development USB — Git-first

Status: **CANONICAL FOR THE CURRENT DEVELOPMENT USB**

This is an owner/development profile. It does not replace the canonical product path based on signed immutable releases under `/ordax/releases/<commit>`.

## Windows Creator: developer installation and channel isolation (2026-10-10)

The Owner/Development Creator is packaged separately from the public Stable/MVP
Creator. Its GitHub prerelease is
`https://github.com/ordaxsystems/ordax-os/releases/tag/creator-owner-prototype`.
The exact asset is `OrdaX-Creator-Owner-Prototype.zip`. The complete
folder (GUI, privileged RAW writer, seed, provenance and README) must be
extracted before running `OrdaX-Creator.exe`.

Before this bundle is published, `tools/creator/verify_owner_dev_bundle.py`
checks its exact source commit, ZIP/hash manifest, member allowlist and seed
digest. This is a **developer-only** test channel; it uses ephemeral prototype
trust, not public release signing, and the Windows Creator is not
Authenticode-signed. Never publish this asset as Stable or link it as the public
`/download/` offer.

Writing a target USB is destructive: use only a disposable, positively
identified removable USB and the Creator's exact-device confirmation/UAC
workflow. Neither a GitHub merge nor an artifact build grants permission to
select or overwrite a connected device. The notebook's internal disk must
remain untouched. First boot requires network for a new checkout; ordinary
system/Surface changes thereafter track `main` through the Git owner.

The development Base's kernel/rootfs A/B and bootloader upgrades have
additional promotion/fallback gates. This bundle does **not** imply that every
Base update has been physically proven, that a fresh notebook boot passed, or
that a public signed Stable release is available.

## Goal

The development USB exists only to cross the boundary that Git cannot cross by itself:

```text
UEFI
 -> kernel + initramfs
 -> drivers/storage
 -> development network
 -> Git client
 -> /workspace/ordax (partial clone of main; runtime checkout = system/)
```

The OrdaX source itself is **not** preseeded on the USB. `main` remains the source authority.

## Daily loop

After the development base has been flashed once and the notebook can boot it:

```text
edit/commit on remote main
 -> notebook: ordax-pull
 -> notebook: ordax-run
```

`ordax-pull` tracks:

```text
https://github.com/ordaxsystems/ordax-os.git
branch: main
checkout: /workspace/ordax
materialized runtime/control paths:
- system/
- bootstrap/base-update/ (control logic only)
- bootstrap/dev-base/{ordax-dev-init,ordax-network,ordax-pull,ordax-rollback,ordax-run}
- bootstrap/recovery/entrypoint
- selected trust/update contracts
```

A new checkout uses Git partial clone (`blob:none`) plus sparse checkout. Git commit/history metadata remains available for update/rollback. The live product tree `system/` is materialized together with the small repository-owned base-update control plane, the fixed development/recovery helper sources, and the trust/contracts they need. Kernel/initramfs binaries and build toolchains are not copied into the runtime checkout; base bytes are built separately and staged for the next boot.

After the Git-controlled supervisor is running, those fixed helper sources refresh the physical development copies of `ordax-dev-init`, network, pull, rollback, run and recovery. The refresh is bounded to that allowlist and does not turn the checkout into an arbitrary root-filesystem copier. This provides the bridge needed for later Git commits to repair the pre-runtime development helpers without rewriting the USB.

Before updating an existing checkout, `ordax-pull` fails closed when:

- `origin` no longer matches the configured repository;
- the local branch is not the configured branch;
- the checkout contains local tracked or untracked changes;
- the fast-forward pull fails.

Only a successful explicit `ordax-pull` clears a rollback pin.

## Rollback semantics

Before a pull that actually advances `HEAD`, the old commit is remembered as `previous-commit`.

`ordax-rollback`:

1. validates that the previous value is a full hexadecimal commit SHA;
2. verifies that the commit exists locally;
3. records `pinned-commit` before changing `HEAD`;
4. resets the runtime checkout to that commit;
5. records it as `current-commit`.

The pin is intentionally **sticky across reboot**. While it is present and matches the current checkout, `ordax-dev-init` skips automatic network/pull and runs the pinned runtime directly. This prevents a reboot from silently undoing a rollback.

To leave rollback mode and follow `main` again:

```text
ordax-pull
```

If the pin and actual checkout disagree, automatic pull and automatic execution are blocked and the development base falls into maintenance instead of silently choosing a version.

## Persistent state

Development Git state is stored outside the checkout:

```text
/state/ordax/current-commit
/state/ordax/previous-commit
/state/ordax/pinned-commit   # only while rollback is fixed
```

The worktree remains:

```text
/workspace/ordax
```

Both live on the persistent development root filesystem on the `ORDAX` bootstrap/proof partition used by the current owner-development USB.

## What is on the USB base

Only the development substrate is preseeded:

- UEFI boot files;
- Linux kernel and initramfs;
- storage/USB/console drivers;
- kernel modules required by the current development hardware policy;
- Ethernet and USB-tether networking;
- Wi-Fi userspace plus the firmware for the currently selected kernel modules;
- CA certificates and HTTPS support;
- Git;
- seed copies of `ordax-dev-init`, `ordax-network`, `ordax-pull`, `ordax-run` and `ordax-rollback`;
- seed copy of the local recovery entrypoint.

These helper copies are bootstrap seeds, not long-term source authority: once the Git-controlled runtime bridge is available they can be refreshed from the matching repository commit. Normal OrdaX Surface/apps/services/source are not preseeded. The runtime `system/` tree arrives through Git.

## Reflash rule

A normal source change under `system/` does **not** require:

- rebuilding the whole USB image;
- reflashing the USB;
- rebuilding the kernel;
- rebooting the notebook unless that component genuinely requires it.

A base-level change is different. The small shell helper layer used by the development base is now Git-refreshable after the runtime bridge is available, so fixing `ordax-pull`, network, rollback, init or recovery does not by itself require a USB rewrite. Changes to the bootloader, kernel, initramfs, package/rootfs substrate, Git binary itself, or a driver/firmware needed before Git is reachable use the Base path rather than replacing bytes that are currently executing. The repository checkout carries the base-update control logic; the running kernel/rootfs are never overwritten in place.

For kernel, initramfs **and the development rootfs substrate**, main publishes an immutable candidate bound to the exact Git commit. The candidate contains `vmlinuz`, `initrd.gz` and a deterministic `rootfs.tar` built from the same commit. When the running supervisor observes the matching low-level commit, it keeps the current Surface running and records an exact-SHA Base request. The persistent base-update owner consumes that request through the replaceable native runtime, where Python already exists, then acquires the candidate under `/state/ordax/base-update/dev-candidates/<commit>` and atomically materializes its rootfs in the seed Base version store. Python is therefore **not** added to the minimal development Base just for update acquisition. A temporarily unavailable candidate does not block runtime/app updates; the request remains armed while `boot-refresh-required` remains present.

Activation remains deliberately split by layer. The development owner now consumes the exact `dev-base-ready-sha`, revalidates `ORDAX-ESP`, and stages kernel/initramfs into the inactive A/B slot while preserving the known-good current and recovery entries. It then publishes an activation-readiness proof for the same SHA. **Runtime one-shot arming is still intentionally disabled**: `LoaderEntryOneShot` and the reboot handoff remain behind the systemd-boot counting/fallback gates, so staging alone never changes which entry boots next.

The development rootfs is materialized under `/ordax/dev-base/versions/<commit>` and is selected only when an authorized candidate boot supplies matching `ordax.base_candidate=<commit>` and `ordax.base_slot=a|b`. The seed `/ordax/dev-base` starts first; `ordax-dev-init` then pivots into the exact versioned root while preserving `/state`, `/workspace`, `/home`, `/proc`, `/sys` and `/dev`. After a real candidate boot, the persistent owner is already wired to the existing fail-closed promotion gate: cmdline identity, Base heartbeat, checkout SHA, Surface health, Surface heartbeat and boot ID must all agree before the candidate can become current. Promotion preserves the previous slot as recovery, removes the candidate marker and does not request another reboot.

A candidate that cannot select its exact rootfs or cannot satisfy health never becomes the known-good current entry. Disposable CI now proves physical inactive-slot staging and healthy post-boot promotion; exact one-try systemd-boot fallback and real-notebook activation remain separate gates. The UEFI fallback loader remains the final explicitly physical self-update gap.

Early boot branding follows the same rule. Anything displayed only after the development base hands control to `system/` may update with the normal Git loop. A logo/splash shown before Git exists is part of the base/initramfs path and therefore changes on the next base boot. The current prototype still uses text-mode early boot; a branded graphical splash renderer has not yet been implemented.

## Network behavior

Normal unpinned boot prefers Ethernet/USB tether because no credentials are required. If neither is available and a supported Wi-Fi interface is detected, the development base asks for SSID/password and stores its WPA configuration under `/state/network/`.

Pinned rollback boot deliberately does not require network access: if the pin is internally consistent, the known local runtime is started without an automatic pull.

The current kernel already carries the wireless stack and selected module families. Hardware outside those selected drivers may still need a future base/kernel update. Until then, Ethernet or USB tether remains the deterministic fallback.

## CI regression

`tests/test_dev_git_flow.py` exercises a real temporary Git remote and proves:

```text
partial+sparse clone
 -> system/ runtime present
 -> non-runtime tree absent
 -> fast-forward pull
 -> previous/current state
 -> rollback
 -> sticky boot pin without network/pull
 -> explicit pull releases pin
 -> dirty checkout rejected
 -> unexpected origin rejected
```

This is repository/CI evidence only. Real notebook boot/network behavior remains a separate physical gate.
