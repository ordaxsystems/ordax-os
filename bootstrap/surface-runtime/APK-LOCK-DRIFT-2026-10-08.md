# Surface APK lock drift — 2026-10-08

## Reproduction

The verified offline Surface runtime currently pins all transitive Alpine APK versions in `bootstrap/surface-runtime/source.json`. The `Portable v2 QEMU Boot Proof` for #1407 (run 37794806524, job 113371366707) failed at `Build and verify exact offline Surface runtime`, before starting QEMU:

```text
ERROR: unable to select packages:
  tiff-4.7.2-r0:
    breaks: world[tiff=4.7.1-r0]
```

This issue is unrelated to the Windows compatibility descriptor changes in #1407. The #1408 QEMU run also uses the same Surface APK lock.

## Recovery authority

The only source of truth is the complete transitive `apk_package_lock` in `source.json`. Run `bootstrap/surface-runtime/discover_lock.py` with the existing `Surface Runtime Candidate` workflow to obtain a full machine-generated drift report. **Do not update individual pins from a truncated error line, allow unpinned installation, override APK conflicts, or fabricate provenance.** Review every package difference before writing a new candidate lock.

The same PR must demonstrate resolver validation, two independent byte-reproducible EROFS builds and a complete QEMU boot. Keep `candidate-not-promotable`, `physical_artifact_authorized=false` and offline-first boot guarantees unchanged.

Tracked in https://github.com/ordaxsystems/prototipo-ordax-os/issues/1413. This file is evidence and triggers the canonical lock-discovery workflow, not an alternative lock or execution path.
