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

**Follow-up gate:** the Owner QEMU proof now requires ordered `STARTED → COMMITTED → FINISHED` callback receipts from the *privileged* WebKit view, plus absence of its load-failed/web-process-terminated signals, before the 15-second stable observation qualifies. These are actual opt-in serial events from the same isolated guest, not synthetic markers or screenshot substitutes. The original QMP pixel threshold remains unchanged. This gate is a source change until CI runs on its exact head; it is not proof that WebKit currently paints the welcome screen.

**Current state:** new WebKit diagnostics and regression assertions are committed on the draft PR. The exact new head has not yet produced a fully green Creator/visual QEMU test. Do not merge, publish or overwrite the physical USB on the strength of earlier green handoff/heartbeat checks.

## Driver-scoped WebKitGTK rendering experiment (2026-10-18)

CI evidence on source `eb5a7e11d6a227fb4728139100f7fb794a04071f` proves the privileged WebKit view emitted real `STARTED`, `COMMITTED`, `FINISHED` callbacks but the QMP framebuffer still had only three quantized colors. This excludes a missing initial page-load callback; it does **not** prove successful painting. WebKitGTK 2.48 has upstream DMA-BUF/Wayland render-path incompatibilities on some drivers. The Owner graphical launcher now selects `WEBKIT_DISABLE_DMABUF_RENDERER=1` only when its **actual active DRM card0 driver** resolves to `virtio_gpu`. This is a bounded virtual-driver compatibility experiment, not a global environment override, unrelated product change or assertion of success. QEMU serial evidence must prove the branch was selected; the real framebuffer >=24-color and 15-second liveness gates remain unchanged. Source and CI proof are required before accepting this as the root cause. The Stable/MVP profile and non-virtio GPUs are unchanged. No USB write or release is authorized.

## Renderer classification triage (Creator #39111221955)

The exact `a6cf22bc` disposable QEMU boot independently passed the EROFS build, verified media, exact local checkout, privileged WebKit page events and native heartbeat, but timed out because `virtual_drm_transport_selected=false`; its bounded serial log contained no virtual-renderer selection marker. The first implementation required a `driver` symlink at a single path, which cannot be assumed for every DRM/sysfs topology. The Owner-only classifier now reads the actual DRM device path, the bound-driver symlink *or* kernel `DRIVER=virtio_gpu` uevent, with a virtio-child/module cross-check. If the classifier still fails, a QEMU-only boot-token-gated log reports the non-sensitive sysfs path/driver evidence and the proof fails immediately after WebKit and heartbeat instead of exhausting the entire window. This is not a framebuffer PASS. Stable/MVP and physical GPUs remain unaffected; no release or physical write is authorized.

## QEMU PCI GPU identity — exact evidence

Creator [#39112121542](https://github.com/ordaxsystems/ordax-os/actions/runs/39112121542) failed closed immediately after true privileged WebKit page-load and heartbeat because the system identifies DRM `card0` through `/sys/bus/pci/drivers/virtio-pci` and `/sys/devices/pci0000:00/0000:00:02.0`, with `DRIVER=virtio-pci`, not the virtio-child symlink previously assumed. The guest serial proves those exact sysfs paths. QEMU and the upstream Linux VirtIO DRM driver document the modern VirtIO GPU PCI identity as vendor `0x1af4`, device `0x1050`. The Owner-only selector now also checks that exact PCI pair together with the bound `virtio-pci` driver; it must not select arbitrary VirtIO devices or Intel/AMD/NVIDIA GPUs. The next disposable boot must verify selection *and* the unchanged genuine framebuffer threshold before this can be accepted; no current release is promoted.


## Same-media second offline QEMU boot proof (pending CI)

The official Owner Creator now tests **two separate real QEMU launches against the same copy** of the SHA-256-verified, disposable USB image. The first launch must complete every WebKit lifecycle, health and real QMP framebuffer gate; the guest QEMU process is then stopped and awaited (all host disk handles closed), and a second QEMU process boots the *same* ext4-backed disposable media, again with no network and with independent serial and framebuffer evidence. A failure during either boot fails the workflow; the second boot is not simulated by duplicate log markers or booting a fresh seed. The process restart models a virtual cold power-cycle and **does not** assert graceful guest shutdown, complete First Run user state, physical notebook boot or update rollback. Physical writing remains disallowed. The schema retains its existing identity and adds explicit second-boot evidence. The new gate is pending the exact updated PR-head CI result.


## Test-owned Chromium deterministic shutdown (pending source-gated CI)

A separate Windows Chromium First Run test had failed with `EBUSY` while deleting its temporary `ordax-browser-smoke-*` profile. The canonical `tools/browser-proof/chromium.mjs` formerly stopped only the process parent; Chrome subprocesses retained the lock. It now terminates the *specific process tree it spawned* on Windows using `taskkill /PID <owned_pid> /T /F`, waits for process exit, and only then removes the disposable profile. No generic `taskkill /IM chrome.exe`, global kill, user browser profile, additional controller or workaround service. Linux/macOS continue to receive bounded graceful CDP close then their owned process shutdown. A focused Node regression tests shutdown on all platforms and Windows descendant termination. Both are subject to the exact-commit CI and a Windows smoke rerun; no First Run PASS is claimed by code change alone.


## First Run end-to-end proof as a required Owner Creator gate

The existing Chromium scenario `tools/surface-native/first-run-browser-smoke.mjs` is now invoked directly by the canonical Owner Creator CI, before building offline runtime dependencies. It exercises the real UI and source modules, Native state adapter, local-only account, save failure and retry, resumed cursor, and identity ownership changes. The existing Python First Run state contract tests are executed in the same preflight, with the process-tree shutdown regression. This avoids a duplicate runner or a second app implementation. GitHub Actions Chrome availability and exact-commit results are **pending**; a green DOM/adapter test does not prove actual physical USB user data persistence or a completed wizard on the native notebook.


## Offline graphical runtime upstream APK lock refresh — 2026-10-18

The official [Surface Runtime Candidate discovery #39141123619](https://github.com/ordaxsystems/ordax-os/actions/runs/39141123619), source `37163fd113fda6e1690cf1c18bc399c25f14c71a`, produced a complete 253-package resolution report. Its retained artifact ID `12141134662` has archive SHA-256 `ef1f3bf0607d1ecbf757127dda4975dafdee013ea6820fe893ba10f80aafa41d`. All 253 package names remain, with zero missing or extra packages; the only version drift is `libcurl 8.14.1-r3 → 8.14.1-r4` and `libexpat 2.8.5-r0 → 2.9.0-r0`. The Owner Creator CI #39139622997 failed on the old pinned libexpat version before QEMU; that run is not a graphical regression. Updated the **same canonical** `bootstrap/surface-runtime/source.json` package lock and evidence, and maintained fail-closed current-head reproducibility status. No runtime image bytes were promoted or physically written. Required next: discovery must revalidate the entire newly committed lock, double EROFS builds must match byte for byte, and Owner QEMU double offline boot must pass at the refreshed source SHA. All physical/write/release gates remain blocked until independently proven.
