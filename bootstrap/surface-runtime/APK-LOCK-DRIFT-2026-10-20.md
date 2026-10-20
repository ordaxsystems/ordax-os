# Surface Runtime APK lock drift — 2026-10-20

## Observed failure

The `Portable v2 QEMU Boot Proof` run **39497041046**, job **118884738087**, on source commit `e0b8caa6ed447710465b8ab5ee91a599ccfaa3c3`, stopped while installing the exact 253-package Surface Runtime lock:

```text
ERROR: unable to select packages:
  ca-certificates-20261020-r0:
    breaks: world[ca-certificates=20260909-r0]
    satisfies: neon-0.33.0-r0[ca-certificates]
               glib-networking-2.80.1-r1[ca-certificates]
```

This failure occurred before QEMU boot. It identifies the stale CA certificate pin but does not by itself prove the complete resolved package lock.

## Full lock discovery

The canonical `Surface Runtime Candidate` workflow **39498448185**, job **118889498483**, ran against commit `c0293cbf6315753e23fc5b1d0164313482d2eae6` and uploaded its machine-generated full-lock report as artifact **12298438720** (ZIP SHA-256 `53bb6f445852cc79290044970932a37dc3f4652aff719c6c4cde690b5786579b`). The resolver found **253 packages, zero missing, zero extra, and one version change: `ca-certificates` 20260909-r0 → 20261020-r0**. It failed closed because the committed lock was stale, as intended.

`source.json` now updates only that package pin and records the discovery run, artifact, package count and reproof gate. The two earlier lock updates, libcurl and libexpat, remain documented in [APK-LOCK-DRIFT-2026-10-08.md](APK-LOCK-DRIFT-2026-10-08.md).

## Acceptance

- [x] Exact-version conflict identified in the canonical Portable v2 QEMU run
- [x] Full 253-package resolver report retrieved; zero missing or extra packages
- [x] Only the package version reported by the full-lock resolver updated
- [ ] Surface Runtime Candidate repeats the EROFS build byte-for-byte on the updated lock
- [ ] Portable v2 QEMU boot proof passes on the updated Surface Runtime
- [ ] Physical boot and promotion remain separate authorization gates
