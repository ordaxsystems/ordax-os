# OrdaX Application Compatibility

Status: **CANONICAL DESIGN + SOURCE FOUNDATION**

This document owns the current OrdaX design for running foreign desktop application formats above the shared Runtime. It does not claim that Windows applications can execute today.

The machine-readable state of this foundation is `docs/contracts/application-compatibility.json`.

## 1. Current state

Implemented in source:

- `ordax.application-compatibility/1` inspection/runtime-selection contract;
- byte-based Windows PE inspection for x86, x86-64 and ARM64;
- DLL and malformed-PE rejection for launch planning;
- bounded MSI container-candidate recognition without claiming MSI database verification;
- explicit compatibility-runtime descriptors bound to a source identity and SHA-256 digest;
- fail-closed launch planning when no real runtime is supplied;
- tests proving there is no implicit/fake Wine or Proton provider;
- no execution, installation, shell, spawn or filesystem-write authority on the current port.

Not implemented yet:

- a packaged Wine, Proton or alternative Windows runtime;
- compatibility-profile/prefix lifecycle;
- Windows application installation;
- Windows application launch;
- graphics/audio/clipboard/device adapters for Windows applications;
- compatibility health, rollback and removal;
- launcher/Surface integration for installed foreign applications;
- a Windows application certification matrix.

Therefore:

```text
WINDOWS_APP_EXECUTION_AVAILABLE=NO
WINDOWS_APP_INSTALLATION_AVAILABLE=NO
WINDOWS_COMPATIBILITY_FOUNDATION=PASS_SOURCE
PUBLIC_COMPATIBILITY_AVAILABILITY=NO
```

## 2. Architecture

The useful invariant from the legacy Nova OrdaX design is retained without copying its implementation:

```text
foreign application / installer
        |
        v
Application Compatibility Manager
        |
        +--> format inspection
        +--> runtime inventory
        +--> launch/install planning
        |
        v
explicit compatibility runtime adapter
        |
        v
OrdaX policy / HOME / capabilities / audit
```

For Windows specifically:

```text
EXE / PE / MSI candidate
  -> content inspection
  -> ordax.application-compatibility/1
  -> verified runtime descriptor
  -> future isolated compatibility profile
  -> future Win32/Win64 translation runtime
  -> future graphics/audio/network/filesystem/clipboard adapters
  -> OrdaX policy + HOME boundary
```

Wine, Proton or another implementation remains replaceable behind the OrdaX contract. None of those technologies is Foundation authority.

## 3. Trust boundary

Foreign executable bytes are untrusted application payloads by default.

Recognizing a PE or MSI-looking payload does not:

- make it an OrdaX-native application;
- grant a capability;
- grant filesystem or network access;
- authorize installation;
- authorize execution;
- authorize access to `/workspace`, Boot Capsule, ESP, Recovery, Trust Root or signing material;
- turn an `.exe`/`.msi` into a trusted `.ordx` package.

A future `.ordx` integration wrapper may carry identity, original payload hash, runtime requirement, permission declaration and launcher metadata. Wrapping must preserve the foreign origin and does not convert the original bytes into native trust.

## 4. Detection rules

### 4.1 PE

The current detector uses content, not filename extension, as authority.

It validates:

- DOS `MZ` header;
- PE signature at the bounded offset declared by the DOS header;
- COFF machine identity;
- PE32/PE32+ optional-header magic;
- DLL characteristic.

Supported architecture identities for launch planning are currently:

- x86;
- x86-64;
- ARM64.

An unknown machine, malformed optional header or DLL is not launchable.

### 4.2 MSI

The current source recognizes only a bounded candidate:

- filename ends in `.msi`;
- bytes begin with the Compound File Binary signature.

That is not enough to prove a valid MSI database. Until a real MSI parser/verifier exists, the result remains `role=installer`, `launchable=false` and installation is unavailable.

## 5. Runtime descriptors

The manager does not invent a runtime when none exists.

A runtime may enter the inventory only through an explicit descriptor that declares:

- stable runtime id;
- ecosystem family;
- engine class;
- semantic version;
- supported architectures;
- immutable source identity;
- lowercase SHA-256 content identity;
- `available=true`;
- `executionEnabled=true`;
- `sandboxed=true`.

Unknown fields are rejected. A descriptor cannot smuggle a raw command, URL or shell path through the contract.

The current manager only uses this inventory to answer whether launch planning has a compatible runtime. It does not execute the runtime.

## 6. User experience target

The target experience remains the useful Nova OrdaX direction:

```text
Downloads/setup.exe
 -> OrdaX identifies the foreign format
 -> Compatibility Manager inspects requirements
 -> OrdaX presents real permissions/storage impact
 -> an isolated compatibility profile is created
 -> the verified runtime performs the install
 -> the app appears in normal OrdaX application surfaces
```

Users should not need to administer raw Wine prefixes during ordinary use.

This target is future behavior, not current availability.

## 7. Expected limitations

Compatibility must never be marketed as universal. Difficult or unsupported classes may include:

- Windows kernel drivers (`.sys`);
- kernel anti-cheat;
- kernel-integrated DRM;
- applications requiring unavailable Windows kernel semantics;
- proprietary privileged hardware stacks;
- strongly Microsoft Store/UWP-bound software;
- software depending on unsupported graphics/device APIs.

Support must be proven per application/profile/runtime class.

## 8. Implementation sequence

The next safe sequence is:

1. package one real Windows compatibility runtime as a verified, content-addressed OrdaX component;
2. keep the runtime adapter replaceable and development-only initially;
3. implement compatibility-profile state under HOME, never as boot/system authority;
4. define explicit filesystem/network/device/audio/clipboard grants;
5. add install planning without installation side effects;
6. implement a narrow install executor behind explicit authorization;
7. add launch/health/rollback/remove lifecycle;
8. integrate installed foreign applications with the shared launcher/catalog;
9. build a reproducible compatibility test matrix using known test payloads;
10. only then decide which compatibility profile, if any, is exposed in Stable/MVP or later channels.

No step may require compatibility runtime success for normal OrdaX boot, Recovery or Surface availability.

## 9. Relationship with external-app distribution

The repository already contains a signed, non-privileged external-app proof for the future Store/distribution architecture. That proof is currently a Web payload proof and is separate from Windows binary compatibility.

The two responsibilities converge later at application identity, provenance, requested permissions, transactional lifecycle and launcher integration, but they must not be collapsed today:

```text
signed external app proof != Windows compatibility runtime
recognized PE bytes        != trusted application package
runtime available          != installation authorized
launch plan ready          != process executed
```

## 10. Legacy provenance

The architectural reference is:

```text
repository=washingtonmsdj/novo-ordax-os
commit=49fe41fa67d9032f2e349e86592304e64d6c2d88
path=docs/FOUNDATION/COMPATIBILITY/COMPATIBILITY-001.md
```

The migration decision is **REIMPLEMENTED**: useful invariants were reviewed and rebuilt against the current clean-room contracts. No legacy compatibility tree or runtime was copied.

See `docs/SOURCE-MIGRATION.md` for the migration ledger entry.
