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

`source.json` updates only that package pin and records both the discovery evidence and the completed reproof. The two earlier lock updates, libcurl and libexpat, remain documented in [APK-LOCK-DRIFT-2026-10-08.md](APK-LOCK-DRIFT-2026-10-08.md).

## Current-head reproof

On PR head `b84b168f1770be019ad9324bb8b6a2a069eed37c`, Surface Runtime Candidate run **39499129666** resolved all **253 packages** and independently rebuilt identical images. The tree manifest SHA-256 is `08ee3b37caeb0d2a470eecaeb371cc768fd7d2cc341e65e2b1da61cc16174dfc`, normalized tar SHA-256 is `a1462ded28fe81a26319171f5ab1ade8841e901fd917ff673a63c7e92159cd40`, and EROFS SHA-256 is `7871ff30bf381c3dd63c42f63ebc26eaaf3ce0f2611aaa7c168cdb7744d66ef7` (1,052,020,736 bytes). The proof artifact is **12299416785**, ZIP SHA-256 `bd73cf8a8f5ad1457bee34197219c19547da114e7740eecc1814de5938cfbaa8`.

Portable v2 QEMU Boot Proof run **39499129739** passed the offline first boot, verified the exact Surface Runtime handoff marker and hash, exercised rollback/recovery and UEFI boot. Its proof artifact is **12300111202**, ZIP SHA-256 `477c160ef30f3629afd5f284ed333a116a93c7b9197558a59cf2b33033f862d3`. The pinned initramfs proof also passed in run **39499129901** (artifact **12299364095**, ZIP SHA-256 `364817db37cb94fa0c1cb35cf359c0f6d3a497ebf9a22740f6ef3ea79109d571`). These are CI/QEMU proofs only; physical boot, Secure Boot and promotion remain separate gates.

## Acceptance

- [x] Exact-version conflict identified in the canonical Portable v2 QEMU run
- [x] Full 253-package resolver report retrieved; zero missing or extra packages
- [x] Only the package version reported by the full-lock resolver updated
- [x] Surface Runtime Candidate repeats the EROFS build byte-for-byte on the updated lock
- [x] Portable v2 QEMU boot proof passes on the updated Surface Runtime with network disabled
- [x] Pinned initramfs accepts the exact real artifacts and rejects tampering
- [ ] Physical boot and promotion remain separate authorization gates
