# OrdaX Windows Compatibility Runtime

Status: **PINNED SOURCE CANDIDATE — NOT BUILT — NOT ACTIVATABLE**

This document owns the first concrete runtime-engine candidate for the Windows application compatibility architecture. It does not authorize Windows application execution.

## Candidate identity

The current Owner/Development candidate is Wine 11.0 from the upstream WineHQ source archive pinned by `bootstrap/windows-compat-runtime/source.json`.

The source contract fixes:

- upstream source URL;
- exact archive size;
- exact SHA-256;
- expected archive root;
- expected `VERSION` content;
- Linux x86-64 / musl host intent;
- x86-64 + x86 Windows architecture intent through the new WoW64 architecture;
- `--enable-archs=x86_64,i386` as build intent only.

`build_intent` is not a build result. Until the recipe is reproduced successfully on the OrdaX Alpine/musl build environment and the resulting runtime artifact is content-addressed, the candidate cannot enter the runtime inventory as `available=true` / `executionEnabled=true`.

## Source proof

`bootstrap/windows-compat-runtime/build.py` currently exposes only two operations:

```text
check
fetch-source
```

`check` validates the source/security/distribution contract. `fetch-source` performs a bounded download of the exact upstream archive and rejects:

- size drift;
- SHA-256 drift;
- archive member path traversal and links (symlinks/hardlinks) resolving outside the single expected `wine-11.0` root;
- members outside the expected source root, unsupported special objects, oversized member count or unpacked payload;
- missing, duplicated, redirected or oversized Wine `VERSION` identity (must be a bounded regular file).

Source-archive validation is a preparatory input-integrity boundary, **not** permission to extract, compile, install, activate or run Wine. Synthetic negative fixtures cover absolute and traversal links, unsafe hardlinks, duplicated VERSION, and resource limits.

The proof output explicitly states:

```text
build_performed=false
activation_authorized=false
execution_authorized=false
```

The CI workflow `.github/workflows/windows-compat-runtime-source-proof.yml` repeats this proof from fresh upstream bytes. No cached or extension-only identity is accepted as authority.

## Why Wine 11.0

Wine 11.0 is the first stable Wine release in which the new WoW64 architecture is considered fully supported. That makes it a technically appropriate candidate for an x86-64 OrdaX host that must eventually support both 64-bit and 32-bit Windows applications without making an old 32-bit Unix userspace a permanent system dependency.

This choice is still a **candidate**, not a permanent Foundation dependency. Wine remains behind the OrdaX application-compatibility contract and may be replaced or complemented by another runtime class later.

## Build gate still required

The next stage must prove all of the following before this source candidate can become a runtime artifact:

1. build in a controlled Alpine 3.22.x x86-64 environment compatible with the OrdaX runtime substrate;
2. exact build dependency lock, including the PE cross-compiler path required for `i386` + `x86_64`;
3. no network access after the build-input acquisition stage;
4. reproducible or otherwise explicitly pinned output identity;
5. runtime dependency inventory separate from build-only dependencies;
6. licenses/notices carried with the runtime artifact;
7. immutable, content-addressed packaging outside the Stable Base;
8. a descriptor that remains unavailable until the artifact bytes and sandbox adapter are both proven;
9. no boot, Recovery, ESP, Trust Root or signing authority;
10. no implicit access to user files, network, devices, audio or clipboard.

A configure command succeeding is not sufficient proof. A Wine binary starting is not sufficient proof. Application execution remains blocked until sandboxing and capability mediation are implemented and tested.

## Product channel policy

The candidate is Owner/Development only. It must not be bundled into the Stable/MVP Base and must not become a required Surface dependency.

If the runtime is absent, corrupt, unsupported or unhealthy, OrdaX must continue to boot and operate normally. Compatibility is an optional failure domain.
