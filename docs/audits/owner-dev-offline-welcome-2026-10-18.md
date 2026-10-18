# Owner/Development USB — Offline Graphical Boot Gate (2026-10-18)

Status: **engineering candidate; not approved for physical boot or release**. Tracking: [PR #1949](https://github.com/ordaxsystems/ordax-os/pull/1949), issues #1935 and #1932.

## Goal

Power on the Owner Development USB and reach the existing OrdaX First Run welcome screen **without Internet, APK provisioning, PowerShell, terminal commands, manual `ordax-pull`, or manual `ordax-run`**. After the user configures network, the existing runtime/supervisor checks `main` and uses the same transactional update and known-good fallback; offline use must remain available.

Keep Alpine in the development Base for this gate. Its replacement and all Stable/MVP work are separate.

## Single authorities, no duplicate package graph

| Responsibility | Existing canonical source |
| --- | --- |
| Graphical runtime dependencies, package lock and EROFS creation | `bootstrap/surface-runtime/source.json`, `bootstrap/surface-runtime/build.py` |
| USB Owner composition and release block | `.github/workflows/creator-owner-dev-git.yml` |
| Runtime image copying, SHA-256 pin, provenance and Owner-only geometry | `tools/creator/verify_owner_dev_offline_runtime.py` |
| Initramfs EROFS/overlay mount helper | `bootstrap/initramfs/portable_mount.c`, installed by `bootstrap/initramfs/build.py` |
| Owner USB early boot handoff | `bootstrap/dev/entrypoint` |
| Surface graphical host | `system/surface/bin/ordax-surface` |
| Base A/B and local boot selection | `bootstrap/dev-base/ordax-dev-init` |
| Disposable GPT/ext4 proof | `tools/creator/proof/disposable_media.py`, `tools/creator/proof/prove_prepared_ext4_growth.sh` |
| Stable physical media contract (unchanged) | `docs/contracts/physical-media.json` |

**Boot invariant:** the EROFS image is already on the seed, its producer receipt matches the exact bundled bytes, and BusyBox validates the SHA-256 pin before the initramfs mounts the immutable EROFS plus ephemeral tmpfs overlay. The graphical launcher consumes `ORDAX_SURFACE_RUNTIME_MODE=verified-erofs-overlay` and must not install/upgrade APKs during this path. The Base A/B pivot retains `/run`, so it cannot silently lose the mount. The running Owner verified EROFS emits `runtime_mode=verified-erofs-overlay`, `evidence_scope=development` and a pinned SHA-256 in the existing proof context (not `canonical-stable-mvp`). The shared read-only proof resolver and both diagnostic collectors reject forged Stable scope or absent digests.

**Geometry invariant:** the 512-MiB baseline proof contract is not changed. The Owner-only seed size is derived from actual staged content, capped at 6 GiB; the prepared-ext4 proof creates a larger disposable target bounded to 7 GiB. This is **not** a statement about arbitrary device capacities, and the media proof never authorizes a physical write.

## Evidence and promotion gates

- **Proven in CI (run 39091773231):** the real runtime producer completed; the final staged image passed `OWNER_DEV_OFFLINE_WELCOME_RELEASE_GATE=PASS`, including SHA-256/EROFS and provenance validation. The derived offline Owner seed was 4 GiB.
- **Prior blocker corrected:** a fixed 768-MiB target was smaller than the derived 4-GiB seed. Run 39093579863 subsequently reported `CREATOR_PREPARED_EXT4_GROWTH_PROOF=PASS`, matching the upstream `resize2fs` baseline and preserving the filesystem tree.
- **Follow-up:** the subsequent source-commit assertion revealed a PR-only identity mismatch: the growth proof inherited GitHub's synthetic merge SHA. The workflow now explicitly exports the exact Owner checkout SHA to that proof. Revalidation is required before the Owner Creator gate can pass.
- **Required before merge or publication:** green Owner preflight, full Creator disposable RAW proof, prepared ext4 growth equivalence and file preservation, kernel/initramfs/Surface regressions, exact bundled SHA/source identity and no inadvertent physical writes.
- **Required before claiming notebook success:** an Owner-specific offline cold-boot demonstration proving the real welcome screen, local session/First Run persistence, Wi-Fi join and optional skip, reboot, online transactional pull and failed-update rollback. Portable v2 QEMU Stable proofs alone do **not** establish Owner graphical First Run.
- **Related non-Owner gates:** report unrelated Surface Web / public-site failures separately; do not bypass or relabel them as passed.

The PR must remain **draft** while any release, Owner cold-boot, or hardware gate is missing. No production rollout, disk repartition, Stable promotion, or Alpine migration is authorized by this audit.

## Additional fail-closed Owner offline QEMU handoff proof

The Creator PR path now boots a disposable **copy** of the exact verified USB RAW image with the existing kernel and initramfs. QEMU presents the disk as removable USB, has no NIC, and must observe actual serial output from the Owner Base, exact seeded Git commit and the automatic local Surface handoff before allowing package construction to continue. No sentinel replaces the product entrypoint. A bounded failure or recovery shell is **FAIL**, not a passing boot.

This direct-kernel TCG proof is **not** UEFI, proof of a rendered Welcome screen, Wi-Fi hardware or physical notebook. Those remain independent release gates.
