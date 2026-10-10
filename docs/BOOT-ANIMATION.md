# OrdaX boot animation — native preview and early boot boundary

Status (2026-10-10): **Native Surface source candidate**, not a physically proven
early-boot splash. The UEFI/kernel/Development Base currently uses console text.

## Source asset (owner-supplied)

Original: `ordax-os-boot.mp4` from user Library
- Original SHA-256: `bcab385c001833529cd40b9bb8685e5eb33b7fec12b308d4a3a047965f500769`
- H.264 1280×720, 24 fps, 8.833333 seconds, AAC soundtrack.

Prepared runtime asset:
- `system/surface/ui/boot/ordax-os-boot.mp4`
- SHA-256 `8216fd455d49106edc070a5cba3496a7918123237874e4788745829e59a561f6`.
- H.264 1280×720, 24 fps, 8.833333 seconds, **audio removed**.
- `system/surface/ui/boot/ordax-os-boot-poster.png`, SHA-256
  `af821207a952cb739ef41d9026b52cbb9e6c7058bb11a5e078fcf7afaa3f03dd`.

The media is not embedded in this source PR: binary assets must be uploaded as
exact, reviewable files to the paths above and verified before changing the
candidate status or merging. Do not fetch runtime graphics from a third-party
URL or dynamically generate binary media from text/base64 in app source.

## Two distinct stages

**1. Native graphical Surface loading:** owned by
`system/composition/native/index.html` and `system/surface/ui/boot-screen.*`.
The optional MP4 plays fullscreen **only while the verified Surface loads**,
and the existing boot card remains the fail-safe presentation.
No external dependencies, autoplay only muted, no forced 8.8s delay;
`ready()` stops the video immediately and `fail()` exposes the error.
If reduced motion is requested or the runtime cannot decode H.264,
the conventional accessible boot card remains visible. This component
arrives through Git in Owner/Development and does not require reflashing USB.

**2. True early startup (UEFI → kernel/initramfs → Development Base):**
not implemented. Owner is `bootstrap/initramfs` or `bootstrap/dev-base`,
not the browser. A compact verified framebuffer/DRM splash renderer, versioned
asset delivery with Base A/B and real hardware verification are prerequisites.
An MP4 embedded in initramfs is not directly playable by BusyBox: adding a
heavy video codec stack before the development Git/network boundary would be
the wrong architecture. Boot, maintenance/TTY recovery and kernel errors must
always bypass or override graphics. Boot must never wait for full video playback.
Consult `docs/contracts/branding.json` and `docs/DEV-USB-GIT.md`.

## Acceptance before activation

1. Upload media files at the exact paths; independently recompute both SHA-256
   hashes and compare with the single branding contract.
2. Run `python -m unittest tests.test_surface_boot_screen -v` and existing
   native/Web browser smoke proofs.
3. Test Native host with a supported H.264 runtime, no unsupported controls,
   no unwanted audio and no blank screen when decoder/source unavailable.
4. Test reduced-motion fallback, rapid `ready()`, failure/maintenance state
   and no additional boot latency.
5. Test real Developer USB after the Creator bundle is independently verified.
   A graphical Surface success must not be misreported as a UEFI splash proof.
6. Keep the Stable/MVP USB release chain independent and signed. Any early Base
   assets require exact-source candidate binding, rollback and physical proof.

