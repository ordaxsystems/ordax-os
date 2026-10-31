# Surface Runtime APK lock and media reproof — 2026-10-22

## Package resolution

The full transitive APK lock was re-resolved against the signed Alpine v3.22 indexes after the Surface media/runtime manifest added PipeWire, WirePlumber, Pulse-compatible utilities and GStreamer PipeWire support. The canonical resolver report is [surface-media-audio-package-resolution-2026-10-22.json](../../docs/evidence/surface-media-audio-package-resolution-2026-10-22.json), generated from source `3dbcd4ae694ee7b487009edd59412d402369d3aa` by workflow run **39740144085**. The report artifact is **12408552782** (ZIP SHA-256 `60432f2fdc2152ffeefcc5e818dbdf48538ad826ee72988fd97da61c6b0976d8`); the report SHA-256 is `2b7d89c9e9ba8ff18fb1e1342c9a6e391417beb1d00d6755453aa94304eb2140`.

The resolver found **324 packages**, up from 305: zero missing, zero version changes and 19 additional transitive/runtime packages. Lock SHA-256: `dfabd41c5760c705541f2d84351e3dada972ba818743e406b1a92452fe1c8320`. Resolution is discovery evidence only; it did not build or install a runtime. The committed lock remains centralized in `system/surface/runtime/packages.txt` and `bootstrap/surface-runtime/source.json`.

## Current-lock reproducible runtime

Surface Runtime Candidate run **39743126535** evaluated source `4e67c9643e4e78c6ab071d84ba62a4005ec44a67`. Two independent builds had matching tree manifest, normalized tar and EROFS bytes:

- Tree manifest SHA-256: `3372add84e7be149c11b7f8e6d1aaaf20a5af18e16d950c546d50c1df9b317c1`
- Normalized tar SHA-256: `ee263b12adfc73805d7e752877c0e3f525ef2f31128a01bcee149175ee301411`
- EROFS SHA-256: `6160275670bbb7485cf5d89ca9c1ef1c53fa347574c6b9001634c469dca67106` (1,145,323,520 bytes)

The metadata artifact is **12410487038**, archive SHA-256 `46900749be9cf8660dfdaeacb7d9f8b5cca0e980b3cc7c2d7f9f5bfc6406dfd3`. The workflow retains proof metadata, not a runtime image for physical-media writing.

## Offline handoff

Portable v2 QEMU run **39743125963** on the same source passed direct-kernel boot, armed one-shot fallback and the same disk through OVMF/systemd-boot. Networking was disabled and first boot did not require network. The proof metadata artifact is **12411065881**, archive SHA-256 `f29555b1f29d174962171845d37e1349c4f01290ac115bb5aa5308cb23df6d5c`.

This verifies the signed offline software handoff and recovery path in QEMU. It does not prove a complete graphical Surface session or audio playback on hardware. The device-less PipeWire startup probe validates the service and socket without opening an output device. Physical speaker/headset, hot-plug and volume tests remain gates. Camera and microphone capture remain denied without explicit consent. USB physical boot and Secure Boot are still separate promotion gates.

## Acceptance

- [x] Signed-index resolver reports the complete 324-package transitive lock.
- [x] Current-lock EROFS builds match byte-for-byte.
- [x] Offline Portable v2 handoff, one-shot fallback and UEFI boot pass in QEMU.
- [ ] Validate output routing against physical speakers/headsets and hot-plug hardware.
- [ ] Validate Stable/MVP USB boot on supported hardware.
- [ ] Prove or explicitly defer Secure Boot before public promotion.
