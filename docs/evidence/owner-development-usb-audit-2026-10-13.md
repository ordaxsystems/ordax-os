# Owner/Development USB audit — 2026-10-13

Scope: `owner-development` only. Stable/MVP and the Independent Base workstream are out of scope.

## Audited source state

- `main` at audit start: `9a02f05d708dd4ba0d6c9e871fd283bd7859f1a5`.
- Parallel PRs were preserved; no work was based on or written into the Independent Base PR.
- The canonical distribution profile still assigns normal Development updates to Git `main` via `bootstrap/dev-base/ordax-pull`, while Base candidates remain on the separate exact-commit Base channel.
- The published `creator-owner-prototype` asset was updated on 2026-10-12. No later commit was found in the boot ESP, kernel, initramfs, Development bootstrap, Development Base helpers, recovery, Creator implementation, or the bootstrap/media contracts audited for reflash relevance.
- Creator Owner/Development storage planning is separate from the public planner and requires at least 5 GiB for the writable `ORDAX` ext4 partition while preserving at least 1 GiB for `ORDAX-DATA`; the same owner planner is used during preparation and final data-volume formatting.

## Concrete continuity gap found and fixed

`ordax-diagnose` is part of the seeded Development Base and is exposed by the maintenance shell, but it was omitted from both:

1. the `ordax-pull` sparse checkout; and
2. the physical helper refresh allowlist in `system/services/base-update/dev-helpers.sh`.

That meant a diagnostic helper correction could not reach an already-created Development USB through the documented `main -> ordax-pull` path and would unnecessarily depend on rebuilding/recreating media.

This audit closes that gap by adding exactly `bootstrap/dev-base/ordax-diagnose` to the existing sparse checkout and existing helper-refresh owner. No second updater, rollback owner, network manager, PID1, or Base channel is introduced.

## Physical gate still required

Repository and CI evidence do not replace hardware proof. The next physical gate is to recreate the Owner/Development USB with the current Development Creator when the existing media has the historical undersized root layout, then prove on the target notebook:

1. UEFI boot from the selected USB while internal disks remain untouched;
2. network plus CA/HTTPS and Git checkout;
3. `ordax-pull` and `ordax-run` reaching the graphical Surface;
4. reboot preserving `/workspace/ordax` and `/state/ordax`;
5. a new `main` commit applying through Git without media rewrite;
6. `ordax-rollback` pinning the previous commit across reboot until an explicit pull releases it; and
7. local `ordax-diagnose` output being available before graphical-runtime success.

Base candidate activation remains a separate follow-up gate and must continue to use the existing immutable exact-SHA Base owner with known-good/rollback semantics.
