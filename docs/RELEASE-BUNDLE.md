# Release Bundle Contract

Status: CANONICAL TOOLING CONTRACT — V1 LEGACY + PORTABLE V4 MVP PATH; RELEASE PUBLICATION STILL EXPLICIT

OrdaX release acquisition v1 consumes exactly one signed artifact:

```text
system.tar
```

The archive materializes the normal post-bootstrap system under:

```text
/ordax/releases/<commit>/system/
```

The bootstrap activates that immutable release through `/ordax/current` only after the signed manifest, artifact hash, archive structure and materialized tree pass verification.

## Bundle source contract

The bundler receives a source root containing `system/` and emits a new `system.tar`. For the Native product release, that source root is prepared by `tools/native-release-assembly/build.py`: it starts from the canonical shared `system/` source and injects only explicitly contracted, prebuilt Native release tools plus their provenance. The bundler itself remains platform-neutral and does not compile or invent Native content.

### External Surface assembly (canonical source cutover)

The UI presentation code is now owned by `ordaxsystems/ordax-surface` as a
pinned Git revision in [`docs/contracts/surface-source.json`](contracts/surface-source.json).
The `tools/surface-source/assemble.py` recipe (invoked through the single
`.github/actions/assemble-surface` action) creates a disposable release source
root. It retains the OS-owned services/Native host, omits every tracked OS copy
under `system/surface/{ui,workspace}`, and inserts only the verified external
visual source. The assembled output includes
`system/surface/source-provenance.json` with both commit identities and the
source fingerprint. It is the *same system/ input* for the existing deterministic
release-bundle and portable EROFS builders, not another bundler or update channel.

The **source ownership cutover is complete**, but source assembly is not Native activation authority. `tools/native-release-assembly/build.py` injects OS-owned Native helpers into the final composed/signed system payload after the exact external visual revision has been verified. Owner/Development and Stable activation retain their own QEMU/health/rollback/physical gates. `ordax-os` no longer tracks a competing visual source under `system/surface/{ui,workspace}`; those paths exist only in disposable staging/release trees. No network checkout of Surface is allowed during ordinary Stable device boot.

Required:

- `system/` is a real directory with mode `0755`;
- `system/entrypoint` exists, is a non-empty regular file and has mode `0755`;
- directories are `0755`;
- regular files are `0644` or `0755`;
- symlinks, hardlinks, devices and other special file types are forbidden;
- the output archive cannot be created inside the source `system/` tree;
- existing output is never overwritten.

The release acquisition agent independently enforces the same runtime safety boundary when extracting the archive. The bundler does not replace device-side verification.

## Determinism

`tools/release-bundle` normalizes archive metadata so identical input bytes, paths and modes produce byte-identical output:

- lexical path order;
- uid/gid `0`;
- empty user/group names;
- timestamp fixed to Unix epoch;
- no host-specific ownership metadata;
- canonical modes preserved;
- USTAR archive format.

CI builds the tool for Linux and Windows and proves two independent bundle invocations are byte-identical.

## Portable USB v2 EROFS compatibility bridge — retained, not target architecture

The durable USB architecture needs a compressed read-only filesystem image, while the signed release protocol v1 remains immutable for compatibility. The following bridge is therefore retained **only for legacy v1/v2 consumers and regression coverage**; it is not the Stable/MVP target architecture:

```text
canonical system/
 -> tools/release-bundle policy
 -> deterministic system.tar
 -> portable-release-image builder
 -> deterministic system.erofs candidate
```

`system.tar` remains the only artifact accepted by `release-manifest/1`, the v1 signer and the current acquisition agent. The EROFS candidate does **not** silently become a v1 release artifact.

`tools/portable-release-image/build.py` first revalidates the normalized tar metadata boundary, then creates `system.erofs` with fixed timestamp, fixed filesystem UUID, root ownership and LZ4 compression. CI must build the image twice and require byte-identical output, then run EROFS integrity verification.

This candidate does not publish, sign, activate or authorize physical media. The newer v4 path below is the Stable/MVP release architecture; do not infer a future design requirement from this retained v1 bridge.

**Bridge owner:** `ordaxsystems/ordax-os` release protocol/bundle tooling. **Removal condition:** remove this bridge only after every supported acquisition, rollback and compatibility path has stopped consuming `release-manifest/1` + `system.tar`, and tests/contracts prove no live v1 consumer remains. Until then it may be maintained for backward compatibility, but it must not gain new product responsibilities or become a second release authority.

## Portable v4 Stable/MVP path

The current USB Stable/MVP path no longer treats the v1 tar bridge as the final
portable release identity. It uses `prototype-ordax.release-manifest/4` and binds
three exact read-only images:

```text
system.erofs
native-surface-runtime.erofs
local-ai-runtime.erofs
```

The third artifact is content-addressed and tied to the canonical
`ordax.local-ai/1` source lock/model identity. The v4 signer, release-acquisition
agent and Stable boot handoff all validate this schema without changing v1/v2/v3
semantics. Repository CI already proves real-byte v4 materialization with an
ephemeral test key; that proof is intentionally non-promotional.

The canonical Stable/MVP release still requires the matching external private key
for `bootstrap/trust/release-ed25519.json`. That key remains outside Git. A
canonical signature does not itself activate a release or authorize writing a
physical device.

## Release boundary

This tooling does not publish a GitHub Release and does not sign a release envelope by itself.

The current portable MVP pipeline is:

```text
verified OS composition + pinned external/native/runtime inputs
 -> deterministic system.erofs
 -> deterministic native-surface-runtime.erofs
 -> deterministic local-ai-runtime.erofs
 -> release-manifest/4 tied to exact source commit and AI source lock
 -> external canonical Ed25519 signing boundary
 -> release-envelope/1
 -> canonical HTTPS artifact channel
 -> materialize-portable-v4 + verify-portable-v4-exact
 -> disposable boot proof
 -> separate physical-write authorization gate
```

The legacy `system.tar -> release-manifest/1` path remains documented and
verified for compatibility; it is not the target Stable/MVP portable release.

A production release must not be published until the canonical public Ed25519 trust anchor has an explicitly owned private key outside Git and the release-signing gate validates that the external private key matches that trust anchor.

## Current state

```text
RELEASE_BUNDLE_TOOLING_IMPLEMENTED=YES
DETERMINISTIC_SYSTEM_TAR_CONTRACT=YES
DEVICE_SIDE_SAFE_EXTRACTION_IMPLEMENTED=YES
PORTABLE_V4_RUNTIME_ARTIFACTS=PASS_SOURCE_CI
CANONICAL_RELEASE_TRUST_RESOLVED=YES
CANONICAL_SIGNED_STABLE_V4_MATERIALIZATION=PENDING
PRODUCTION_RELEASE_PUBLISHED=NO
PHYSICAL_USB_WRITE_EXECUTED=NO
```

`system/` is the **composed OS release tree** assembled from OS-owned bytes plus exact verified external component revisions; it is not the universal Git source of the product. The presence of bundle tooling must not be interpreted as a completed OrdaX release.
