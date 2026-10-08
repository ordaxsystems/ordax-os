# Surface APK lock drift — 2026-10-08

## Reproduction

The verified offline Surface runtime currently pins all transitive Alpine APK versions in `bootstrap/surface-runtime/source.json`. The `Portable v2 QEMU Boot Proof` for #1407 (run 37794806524, job 113371366707) failed at `Build and verify exact offline Surface runtime`, before starting QEMU:

```text
ERROR: unable to select packages:
  tiff-4.7.2-r0:
    breaks: world[tiff=4.7.1-r0]
```

This failure occurred before Windows-compatibility execution planning or a QEMU boot. The #1408 QEMU run uses the same Surface APK lock.

## Recovery authority

The only source of truth is the complete transitive `apk_package_lock` in `source.json`. The existing `Surface Runtime Candidate` workflow executed `bootstrap/surface-runtime/discover_lock.py` and uploaded the machine-generated drift report as artifact **11559496802** from run **37797603686** on commit `785255cdb6328b54b5618b9016844f42a2e1f8b3` (ZIP SHA-256 `8b5d9604b06a79b456ec2de291db035ac326ef9f91d5ecad41ce1d6c163f554a`). The full resolved lock contained **253 packages, zero missing, zero extra, exactly one version change: TIFF 4.7.1-r0 -> 4.7.2-r0**. Those results, not the truncated QEMU error, justify changing this single pin in the canonical contract.

The same PR must demonstrate resolver validation, two independent byte-reproducible EROFS builds and a complete QEMU boot. The canonical Surface Runtime Candidate run **37798187669**, artifact **11560175180** (ZIP SHA-256 `e269c87f172f1a1dddc38d9da992dcac185978ffe2f1c2e99164266c8ba46157`), re-resolved the exact 253-package lock, built twice and proved identical file-tree, normalized tar and EROFS digests: `7c5bd1eda95451f7e38511b1fd19caad5d62ef434f15930f2fa43971d92f5ec8`, `0dfedac3c59fbfb54b0f06669906382cd69c3036f32803ae85a92f1789179f9f`, `c8d80ac6704742ac9f2e6708386a0f2e743294fc98ed84d9b09755ffabdef3b5` (1,052,020,736 bytes). The current reproof is now recorded in the SSOT. **This does not prove QEMU, authorize public promotion, or authorize physical installation.** All source proofs remain candidate-only. Keep `candidate-not-promotable`, `physical_artifact_authorized=false` and offline-first boot guarantees unchanged.

Tracked in https://github.com/ordaxsystems/prototipo-ordax-os/issues/1413. This file is evidence and triggers the canonical lock-discovery workflow, not an alternative lock or execution path.

## Acceptance

- [x] Full transitive resolver drift report retrieved and reviewed from canonical CI
- [x] Updated the one changed canonical package pin with exact CI artifact identity
- [x] CI verifies re-resolution exactly matches current 253-package lock
- [x] CI produces two byte-identical EROFS builds and immutable provenance
- [ ] Full portable QEMU proof passes on the updated lock
- [ ] Only after current proof, update the canonical reproducibility receipt and close pending gate
