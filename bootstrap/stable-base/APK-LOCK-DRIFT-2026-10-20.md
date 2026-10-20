# Stable Base APK lock drift — 2026-10-20

## Observed failure

The `Portable v2 QEMU Boot Proof` run **39476365071**, job **118813346675**, on commit `73d6923ca2cb9e7c37fcc712f21dda9c20414c48`, stopped while resolving the exact Stable Base APK lock:

```text
ERROR: unable to select packages:
  ca-certificates-20261020-r0: breaks: world[ca-certificates=20260909-r0]
```

This is direct resolver evidence that the configured repository no longer offers the pinned `ca-certificates` version and currently resolves `20261020-r0`. The failure did not produce or boot a new Stable Base candidate.

## Source update and reproof gate

`source.json` now pins only `ca-certificates` to `20261020-r0`. The other 39 package pins and the 40-package lock scope are unchanged. The contract records the CI run, job, source commit and old/new versions in `apk_package_lock_refresh`.

The Stable MVP Base Candidate run **39497041081**, job **118884662201**, re-resolved and built the updated 40-package lock from source commit `e0b8caa6ed447710465b8ab5ee91a599ccfaa3c3`. It reported normalized rootfs tar SHA-256 `df668955408b50adc3541daca844440eac2aa1cd47deab25de40bb59564e5a5f`, EROFS SHA-256 `081fef6e9c9c4c991363f07ddcc08856b2a3ed65b5ec844108da43cd232396a6`, and uploaded candidate artifact **12297049355** (ZIP SHA-256 `8727e15cc902c13bbf1bf8ca17e31857819005c3b10d20aa5c2999a1f7abfa6e`). `source.json` now records this proof. The separate Portable v2 QEMU run still failed while building the Surface Runtime because its own package lock has the same stale CA certificate pin; this does not invalidate the successful Stable Base candidate.

The candidate remains unpromoted and `physical_artifact_authorized` stays `false`. This evidence does not prove QEMU boot or authorize physical installation.

## Acceptance

- [x] Exact-version resolver failure identified in canonical QEMU CI
- [x] Only the package version named by that failure refreshed in the source lock
- [x] Stable Base Candidate re-resolves all 40 locked packages successfully
- [x] Candidate artifact provenance is reviewed and recorded
- [ ] Physical-artifact authorization remains a separate gate
