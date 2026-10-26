# Owner/Development Base — verified component cache

Status: implementation candidate on PR #2243 integration path. It is **not** permission to promote Stable, release unsigned bytes, or write a physical USB.

## Single technical owner

- Producer: `bootstrap/independent-base/build.py --profile owner-development`.
- Source inputs/fingerprint: `tools/ci/portable_component_cache.py`, component `independent-base-owner`.
- Consumers: `independent-base-experiment.yml`, `creator-owner-dev-git.yml`, `dev-base-channel.yml`.
- One cache key: `ordax-portable-component-v1-<runner.os>-<runner.arch>-independent-base-owner-<independent_base_owner fingerprint>`.
- Cache is exact-key only. No `restore-keys` fallthrough to other inputs or the `minimal` profile.
- The fingerprint includes Owner helpers, firmware/modules installer, kernel build+Kconfig fingerprint, Buildroot configuration/scripts, upstream pins, post-build handoff, network and recovery code, and pinned execution environment.

## Acceptance on a cache hit

1. Restore the original `rootfs.tar`, `rootfs.cpio.gz`, `independent-base.erofs`, `provenance.json`, and the canonical cache manifest.
2. Re-run `bootstrap/independent-base/build.py verify --profile owner-development` against the current checkout.
3. Re-run `portable_component_cache.py verify --component independent-base-owner`. It checks the complete artifact set, SHA-256 digests, profile/candidate flags, fingerprint and immutable producer provenance.
4. Emit a separate per-integration receipt binding `build_source_commit` to `integration_source_commit` with `provenance_rewritten=false`.
5. Validate the same `rootfs.tar` using `tools/dev-base-channel/independent_rootfs.py` and the real Dev Channel consumer. An older build SHA is only permitted with a matching, verified integration receipt.
6. Run QEMU / first and second offline boots, rollback, and final signature gates normally. Reusing the Base **never** skips functional validation.

## Miss or corruption

- Exact cache miss: Buildroot runs, produces provenance for the current commit, and is verified and recorded before save.
- Invalid cache content/manifest/profile/fingerprint: **fail closed**. Never silently use bytes with mismatched identity, change source commits, or fall back to Alpine.
- The logs emit `ORDAX_OWNER_BASE_CACHE_HIT=true|false`; a false value prints the reason `build-affecting-input-or-environment`.
- Documentation and test-only changes do not participate in the Base fingerprint. Changes in scripts installed into the rootfs, toolchain/kernel/Kconfig, modules, firmware and build profile do.

The separate GitHub Cache and Cloudflare R2 policy for the graphics EROFS is defined by `docs/CI-SURFACE-CACHE-SSOT.md`; this document does not add a second owner for that artifact.

## Release status

A cached Owner Base is merely a candidate. It cannot attest to physical USB boot, Surface health, signed Stable acceptance, or release promotion. The PR #2243 gates remain mandatory.
