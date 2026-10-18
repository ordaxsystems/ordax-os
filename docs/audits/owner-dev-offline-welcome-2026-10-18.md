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
- **Follow-up resolved:** the subsequent source-commit assertion revealed a PR-only identity mismatch: the growth proof inherited GitHub's synthetic merge SHA. The workflow now exports the exact Owner checkout SHA to that proof. The full Creator test, source identity, prepared ext4 proof and final ZIP gate subsequently passed in [run 39098554696](https://github.com/ordaxsystems/ordax-os/actions/runs/39098554696).
- **Required before merge or publication:** green Owner preflight, full Creator disposable RAW proof, prepared ext4 growth equivalence and file preservation, kernel/initramfs/Surface regressions, exact bundled SHA/source identity and no inadvertent physical writes.
- **Required before claiming notebook success:** an Owner-specific offline cold-boot demonstration proving the real welcome screen, local session/First Run persistence, Wi-Fi join and optional skip, reboot, online transactional pull and failed-update rollback. Portable v2 QEMU Stable proofs alone do **not** establish Owner graphical First Run.
- **Related non-Owner gates:** report unrelated Surface Web / public-site failures separately; do not bypass or relabel them as passed.

The PR must remain **draft** while any release, Owner cold-boot, or hardware gate is missing. No production rollout, disk repartition, Stable promotion, or Alpine migration is authorized by this audit.

## Additional fail-closed Owner offline QEMU handoff proof

The Creator PR path now boots a disposable **copy** of the exact verified USB RAW image with the existing kernel and initramfs. QEMU presents the disk as removable USB, has no NIC, and must observe actual serial output from the Owner Base, exact seeded Git commit and the automatic local Surface handoff before allowing package construction to continue. No sentinel replaces the product entrypoint. A bounded failure or recovery shell is **FAIL**, not a passing boot.

This direct-kernel TCG proof is **not** UEFI, proof of a rendered Welcome screen, Wi-Fi hardware or physical notebook. Those remain independent release gates.

**QEMU device identity:** `usb-storage` defaults to a USB hard disk; the Owner initramfs intentionally rejects that as non-removable. The QEMU proof explicitly uses the documented `removable=on` property so it emulates an actual USB stick; the production removable-media validation is unchanged.

## Stronger Owner QEMU health condition

Following the first handoff-only success in CI run `39096292079`, the same disposable QEMU verification now requires a **real native Surface cold-boot heartbeat** acknowledged by the existing supervisor for the exact commit, absence of runtime failures/rollbacks, and 15 more seconds of observed guest stability. The runner remains offline and is still *not* proof of framebuffer pixels, physical notebook or Wi-Fi chip behavior. The Owner-first-run release decision must remain blocked if this stronger gate fails.

## Verified checkpoint on commit 3252d85e

The exact Owner Development pipeline passed: [Creator Owner Development Git USB #39098554696](https://github.com/ordaxsystems/ordax-os/actions/runs/39098554696). Its successful steps include canonical offline Surface runtime build/verify, Owner RAW materialization, direct-kernel USB QEMU boot, exact Creator ZIP verification, and deletion of ephemeral signing secrets; the publication step was **skipped** because the branch is a PR. Related [Owner Development Preflight #39098554679](https://github.com/ordaxsystems/ordax-os/actions/runs/39098554679) and [Foundation Contract #39098554690](https://github.com/ordaxsystems/ordax-os/actions/runs/39098554690) also passed.

The QEMU Owner gate now checks real serial output from the seeded Git checkout and offline Surface, native Supervisor acknowledgment of a healthy cold-boot Surface, 15 seconds of sustained guest observation and absence of known restart, failure or recovery markers. The check operates without network and does not fabricate Welcome/UI pixels or a successful notebook boot. The last change also preserves verified child mounts through the switch_root self-bind.

**Remaining mandatory release evidence:** graphical Welcome pixels and First Run navigation on target hardware, selectable Wi-Fi SSIDs/association, optional offline continue, same-device reboot, automatic post-setup main update, failed-pull rollback and absence of an unexpected black screen. Record physical evidence bound to the exact seed/source SHA. No automatic publication or physical write on this evidence alone.

## QEMU framebuffer observation (post-heartbeat; candidate verification)

The Creator proof now requests a local-only QMP `screendump` from the **same** running offline QEMU guest after 15 seconds of native Surface heartbeat stability. It validates an actual binary PPM framebuffer, dimensions and payload length, and requires a sufficiently nonblank, varied color composition rather than interpreting a VGA console or a black screen as a graphical UI. The image and QEMU receipt are retained for seven days as an Actions artifact (`owner-usb-qemu-framebuffer`) on the PR run, not released to Owner USB customers. If QMP cannot capture a framebuffer or its pixels look blank/terminal-like, the Creator PR gate fails before ZIP packaging. This is a real observation from the disposable guest, not mocked proof data.

This test cannot identify UI labels or prove First Run navigation. In particular, `welcome_screen_rendered_proven` remains `false` until human review of framebuffer evidence and target-hardware proof; `notebook_boot_proven` remains `false`. All physical release controls stay in force.

## QEMU graphical framebuffer gate — current blocker (2026-10-18)

The latest actual Owner QEMU framebuffer validation **FAILED** in [Creator #39101703718](https://github.com/ordaxsystems/ordax-os/actions/runs/39101703718), commit `b309a501`. The offline EROFS, verified seed, ext4 growth, and actual serial heartbeat passed beforehand, but the QMP screendump was console-like: `lit_fraction=1.000`, `quantized_colors=4` (required 24). The failure artifact is `owner-usb-qemu-framebuffer`, retained for seven days. This is an explicit **release blocker**; no amount of serial heartbeat alone proves a rendered Welcome UI.

The next run also collects the guest's real bounded serial log with the actual framebuffer as CI evidence, so the graphics/DRM/Cage transition can be diagnosed without fabricating UI or relaxing the color threshold. Do **not** label the latest Creator pipeline successful, merge, release, or instruct physical USB overwrite until the graphical gate passes and the separate hardware checks are satisfied.

## Real QEMU framebuffer and WebKit diagnostic follow-up (18 October)

Actual evidence from Creator run [#39105524816](https://github.com/ordaxsystems/ordax-os/actions/runs/39105524816), artifact `owner-usb-qemu-framebuffer`, was inspected **as pixels**, not inferred from heartbeat: a 1280×800 pale-white frame with a visible mouse pointer, no OrdaX welcome elements; the PPM has three actual RGB colors (the quantized gate also counted three). The accompanying real serial log confirms kernel DRM `virtio_gpu` initialized, `fbcon` allocated its framebuffer, Cage started, and the native Surface supervisor eventually acknowledged process health. It does **not** prove that WebKit successfully loaded or painted UI content. The current Creator fail is correct and blocks release.

The Owner-specific WebKit lifecycle probe now records only fixed status codes from the **actual** privileged Surface WebView callbacks: start, commit, finish, failure and web-process termination. QEMU opts in with `ordax.owner_qemu_graphics_probe=1`; ordinary physical boots and Stable/MVP never emit these debug serial events. No page URL, user data or exception payload is written to serial. A terminated privileged WebKit process now yields a nonzero host exit rather than masquerading as a healthy desktop. The QEMU evidence artifact already preserves a bounded guest serial trace. The framebuffer pixel gate is unchanged.

An independent Foundation failure in the previous run was caused by First Run contract tests tied to old copy and fixed Meridian pixel dimensions. Tests have been aligned with the **active UI labels** and the required non-install, scrolling-body/fixed-footer layout invariants. This is not a change to the First Run UX itself.

**Current state:** new WebKit diagnostics and regression assertions are committed on the draft PR. The exact new head has not yet produced a fully green Creator/visual QEMU test. Do not merge, publish or overwrite the physical USB on the strength of earlier green handoff/heartbeat checks.
