# Owner/Development USB removable-root guard — 2026-10-13

Scope: `owner-development` only. This evidence does not authorize or claim a Stable/MVP change, an Independent Base cutover, or physical hardware proof.

## Blocker

The fixed initramfs legacy PID1 located the writable `ORDAX` root only by filesystem label. A label collision could therefore select a different block device before the ext4 health check and writable mount.

## Correction

For boot entries derived by the Owner/Development Creator, the cmdline now carries the canonical distribution-profile identity. The fixed PID1 treats that profile specially and requires, before any writable mount:

- partition 2 is ext4 with label `ORDAX`;
- the parent block device reports removable media;
- the same parent has exactly one partition 1 that is vfat with label `ORDAX-ESP`;
- exactly one complete matching removable medium exists;
- discovery is bounded and fails to the local recovery shell when missing or ambiguous.

The canonical boot entries remain profile-neutral. The Creator derives Owner-only entry files and rewrites only the derived development manifest, preserving the Stable/MVP source entries and their existing behavior.

## SSOT

`bootstrap/initramfs/source.json` owns the low-level discovery contract and points to `docs/contracts/distribution-profiles.json#profiles.owner-development`. The Owner Creator validates that its workflow still matches the canonical profile before deriving boot entries.

## Proof boundary

Repository tests and CI can prove source composition, parser/build validity and regression behavior. They do not prove a real notebook, firmware, USB controller or storage device. The physical acceptance gate remains a boot from newly published Owner/Development media followed by network, Git, `ordax-pull`, `ordax-run`, reboot persistence and rollback checks.
