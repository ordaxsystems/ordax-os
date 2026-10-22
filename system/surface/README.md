# Surface

`system/surface/` is the single user-facing Surface source for OrdaX shell, windows/workspaces, explorer, settings, design tokens and shared interaction behavior.

The same product Surface serves every applicable execution mode:

```text
Web
Mobile (Android / iOS)
Desktop
USB
Native disk
```

Those modes may host/render the Surface differently, but they do not own separate screens, CSS, design systems or application policy.

## Visual source

The first graphical source lives under `system/surface/ui/` as standards-first HTML/CSS/JavaScript modules with no remote asset or framework dependency. This is an implementation baseline, not a permanent framework choice.

`surface-state.mjs` keeps interaction state independent from DOM rendering. `surface.mjs` mounts the shared UI against the platform-neutral `ordax.surface-host/1` contract. Design tokens and responsive behavior remain shared CSS.

Environment wiring is intentionally outside the Surface under `system/composition/`. The Web composition combines the shared Surface with `system/adapters/web/runtime.mjs`; Desktop/Mobile/native composition roots may select different adapters without copying the UI.

## Workspace presentation read boundary (proposed)

PR-01 documents a future composition-only Workspace presentation reader in `docs/contracts/workspace-presentation-reader.md`. It is **not implemented** by this README or PR-01. Current Native/Web reducers, `workspace-store/2`, `workspace-metadata-source/1`, and `surface-render-lifecycle/5` keep their existing authority and behavior.

The proposed reader is internal to composition, read-only, metadata-only, and separate from Workspace commands and domain authorization. It must not become an external-app API or a second Workspace/store/lifecycle.

## Stable native boundary

The native verified-release handoff remains intentionally layered but small:

```text
system/entrypoint          # stable guardian
 -> system/supervisor      # Git/update + Surface lifetime
 -> system/surface/entrypoint
 -> system/surface/bin/ordax-surface
```

`system/entrypoint` owns only the child supervisor lifetime and a local state-file heartbeat watchdog; it does not perform Git or network work. `system/supervisor` owns bounded Git update discovery/application, candidate preflight, update transaction state, health acknowledgement, rollback and Surface restart/reload decisions. `system/surface/entrypoint` remains the stable native graphical launch boundary. The owner/development USB attempts a thin native graphical host using the existing shared Web composition: Cage provides the DRM/Wayland kiosk compositor, Barkery/WebKitGTK provides the browser runtime, and a loopback-only HTTP server inside the replaceable graphical runtime gives the ES-module tree normal origin semantics. The Surface source itself is not duplicated.

The graphical stack is **not** part of the fixed Git-first development base. The base stops at kernel/hardware support, network, CA trust, Git and a minimal signed-package acquisition client. `bin/ordax-surface`, which arrives through `ordax-pull`, materializes the replaceable Cage/Barkery/Mesa runtime under `/state/ordax/runtime/native-surface/` from signed Alpine packages and launches it in a chroot. Therefore ordinary Surface/host/runtime changes remain pullable and do not require rewriting the USB image.

The first physical provisioning attempt proved the Git-first path and exposed that Alpine v3.22 no longer ships the earlier Cog package on x86_64. The native host therefore uses `barkery-browser`, which is available in Alpine v3.22 community and still renders the same checked-out Surface through WebKit. Runtime identity is versioned so a failed or obsolete host candidate under `/state` cannot be mistaken for the current one.

A later physical attempt proved the full Cage/Barkery runtime could be installed, but also exposed an incorrect dependency on an HTTP applet in the fixed bootstrap BusyBox. The bootstrap intentionally excludes that server applet. The Surface launcher now bind-mounts the checked-out `system/` tree into the graphical chroot and starts Python's loopback-only `http.server` from the already provisioned Barkery runtime. This keeps HTTP hosting inside replaceable Git-controlled runtime state rather than widening the immutable bootstrap.

The next physical attempt reached Cage/seatd and exposed three host prerequisites rather than a new bootstrap requirement: the development base had not configured IPv4 loopback, Alpine's Cage build expected an Xwayland binary, and wlroots rejected a seat with no discovered libinput devices. The Git-controlled launcher now brings `lo` up as `127.0.0.1/8`, prepares `/dev/shm` and extends an existing runtime in place with Xwayland instead of rebuilding the full runtime.

On 2026-09-17 the target notebook then successfully rendered the shared OrdaX Surface fullscreen through the complete Git-first native path. Primary input was validated in the following iterations: the runtime gained eudev/libinput classification, the temporary no-input wlroots tolerance was removed, and stale `/run/seatd.sock` state is now recovered safely before compositor startup. The subsequent physical boot confirmed both keyboard and mouse/touchpad operation inside the Surface. This closes native rendering and primary-input bring-up on this hardware. Long-run stability, suspend/resume, audio, acceleration quality, power management and broader hardware coverage remain separate physical validation gates. The detailed evidence is recorded in `docs/evidence/physical-native-surface-2026-09-17.md`.

A reflash/base update is reserved for the real bootstrap boundary: kernel, initramfs, hardware/driver/firmware support, or the minimal network/Git/acquisition substrate itself.

The development runtime also has two intentionally separate resilience paths outside the normal graphical lifecycle. A persistent `ordax-rescue` agent under `/state/ordax/rescue/` consumes only a closed, target-bound rescue protocol from a separate Git ref, while a persistent host-base telemetry agent under `/state/ordax/telemetry/` reports operational state to an observation-only Supabase relay. Neither mechanism changes the shared Surface source. The rescue agent has no generic remote shell; the Supabase relay has no command semantics.

The guardian/supervisor split and a subsequent supervisor-only update have both been physically exercised on the target notebook. That proves the controlled supervisor refresh path can update itself without falling back to bootstrap maintenance. Candidate preflight now checks critical fetched Git objects before the live checkout is switched; the valid-candidate path is physically exercised, while intentionally broken candidate rejection remains a separate physical exercise.

If DRM/KMS, network during first runtime acquisition, or another graphical host requirement is unavailable, `bin/ordax-surface` falls back to a maintenance console rather than inventing a second visual implementation. The fallback surfaces both native-host and loopback-HTTP diagnostics. Once provisioned under `/state`, the graphical runtime is reusable without downloading it on every boot.

Do not add a plugin/launcher framework merely to prepare for runtime replacement; the stable entrypoint already supplies the required indirection.

## Capability rule

Environment differences are consumed through platform-neutral contracts under `system/contracts/` and implemented by `system/adapters/`.

Shared Surface code may react to capability availability. It must not import concrete Web/Mobile/Desktop/native adapter implementations or branch on platform identity when the difference can be expressed as a capability.

The machine-readable boundaries are:

- `docs/contracts/product-capabilities.json`;
- `docs/contracts/module-boundaries.json`;
- `docs/contracts/runtime-configuration.json`.

## Multimedia runtime

`runtime/packages.txt` is the package selection owner for both development
provisioning and the immutable offline runtime. GStreamer Base/Bad are brought
by WebKit; Good and libav are explicit requirements for the formats exposed by
File Space (including MP3, WAV, FLAC, MP4 and WebM). The development launcher
File Space (including MP3, WAV, FLAC, MP4 and WebM). PipeWire, WirePlumber,
Pulse-compatible controls, ALSA compatibility and the GStreamer PipeWire plugin
are explicit requirements for native output routing. One session wrapper starts
the D-Bus, PipeWire and WirePlumber owners alongside Cage and stops only the
processes it started in a private audio runtime directory, preserving the
established Wayland `XDG_RUNTIME_DIR`. Native Settings routes physical ALSA or
Bluetooth sinks and changes output volume or
mute through one session-token-protected host provider; settings apply to the
current session. If the service or a physical output is absent, Settings reports
that state and the graphical Surface still starts.

The development launcher checks the codec and audio-control payload and extends
an existing dynamic runtime when needed. Verified EROFS runtimes remain immutable
and offline: they receive these dependencies through a newly built, verified
runtime artifact, never an APK install at boot. An older verified runtime can
still boot the Surface; its presence alone does not prove multimedia readiness.
The offline builder runs `runtime/media_runtime_probe.py` against the installed
dependencies before packaging: plugin discovery plus encode/decode round trips
for WAV, WebM, MP4, PNG and JPEG, then starts the session server in a device-less
guest and reads its Pulse-compatible socket. Decode checks use disposable files
and `fakesink`; the software session probe opens no physical device.

Image, media and PDF previews share one bounded streaming reader in the Native
File Space adapter. It validates MIME before consuming bytes, checks advertised
length, enforces the limit while receiving unknown-length bodies, cancels failed
transfers and rejects truncated responses. Supported formats describe preview
input, not a guarantee that a particular host can decode every codec profile.

Player and Image Viewer remain app-owned in `ordax-apps`, consuming the public
File Space ports and verified app lifecycle. No second player/viewer is embedded
in the OS. Physical speaker/headphone output, microphone/camera permission,
GPU decoding and actual playback still need independent device validation.
Camera and microphone requests remain denied until a user-facing permission
flow is connected; installing capture-capable plugins does not activate capture.

## Rendering/runtime technology

The owner/development USB currently uses Cage + Barkery/WebKitGTK as the native host candidate because that keeps the graphical host replaceable while reusing the same Surface source. That host choice is not architectural authority: it may be replaced if physical evidence shows a better runtime.

Framework/runtime selection must satisfy the shared capability/module contracts and remain replaceable. Product/domain semantics belong to shared OrdaX source, not to a UI framework or host shell.

No target-specific visual fork is allowed.
