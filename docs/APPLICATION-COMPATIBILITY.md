# OrdaX Application Compatibility

Status: **CANONICAL DESIGN + SOURCE FOUNDATION**

This document owns the current OrdaX design for running foreign desktop application formats above the shared Runtime. It does not claim that Windows applications can execute today.

The machine-readable state of this foundation is `docs/contracts/application-compatibility.json`.

## 1. Current state

Implemented in source:

- `ordax.application-compatibility/2` inspection/runtime-selection contract;
- byte-based Windows PE inspection for x86, x86-64 and ARM64;
- DLL and malformed-PE rejection for launch planning;
- bounded MSI container-candidate recognition without claiming MSI database verification;
- explicit compatibility-runtime descriptors bound to a source identity and SHA-256 digest;
- fail-closed launch planning when no real runtime is supplied;
- manager-local inspection provenance required for launch/profile plans (external schema-shaped objects and cross-manager copies are rejected);
- profile planning requires a manager-verified SHA-256 of an immutable snapshot of inspected payload bytes; callers cannot provide an unrelated digest;
- `ordax.application-compatibility-profile-planner/1` for side-effect-free isolated profile planning;
- profile plans bind the inspected payload SHA-256, architecture and selected runtime to a safe relative durable-user storage key;
- tests proving there is no implicit/fake Wine or Proton provider and no profile path escape;
- no execution, installation, profile creation, shell, spawn or filesystem-write authority on the current ports.

Not implemented yet:

- a packaged Wine, Proton or alternative Windows runtime;
- physical compatibility-profile/prefix materialization;
- explicit filesystem/network/device/audio/clipboard grant policy;
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
WINDOWS_PROFILE_CREATION_AVAILABLE=NO
WINDOWS_PROFILE_PLANNING_AVAILABLE=YES_SOURCE
WINDOWS_COMPATIBILITY_FOUNDATION=PASS_SOURCE
PUBLIC_COMPATIBILITY_AVAILABILITY=NO
```


The compatibility manager port is version `ordax.application-compatibility/2`: version 2 requires verified-inspection hashing methods in addition to the original format/launch planning methods. The port schema changed instead of silently changing the required methods of version 1. The inspection and profile schemas retain their separate existing versions.

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
        +--> launch planning
        |
        v
Compatibility Profile Planner
        |
        +--> payload hash binding
        +--> runtime binding
        +--> isolated durable-user storage key
        |
        v
future explicit compatibility runtime adapter
        |
        v
OrdaX policy / HOME / capabilities / audit
```

For Windows specifically:

```text
EXE / PE / MSI candidate
  -> content inspection
  -> ordax.application-compatibility/2
  -> verified runtime descriptor
  -> isolated compatibility profile plan
  -> future profile materialization
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
- authorize profile creation;
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
- PE32/PE32+ optional-header magic consistent with the COFF machine (PE32 for x86; PE32+ for x86-64/ARM64);
- optional-header length covers the fixed fields (96 bytes for PE32; 112 for PE32+) and fits entirely within the inspected bytes;
- PE header offset does not overlap the 64-byte DOS header;
- COFF `IMAGE_FILE_EXECUTABLE_IMAGE` characteristic (an object file cannot be treated as a launchable image);
- section table has 1–96 entries and **all** 40-byte section headers fit inside the supplied bytes;
- DLL characteristic, which always blocks launch planning even when `IMAGE_FILE_EXECUTABLE_IMAGE` is set.

This is deliberately a **structural candidate check**, not full Windows loader certification or permission to execute. Unsupported or malformed PE payloads fail closed.

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
- supported architectures (only known x86, x86-64, ARM64 values; never `unknown`);
- an engine compatible with the declared family (Wine/Proton only for Windows, native-linux only for Linux; `other` remains explicitly family-scoped);
- immutable source identity;
- lowercase SHA-256 content identity;
- `available=true`;
- `executionEnabled=true`;
- `sandboxed=true`.

Unknown fields are rejected. A descriptor cannot smuggle a raw command, URL or shell path through the contract.

The current manager only uses this inventory to answer whether launch planning has a compatible runtime. It does not execute the runtime. A structurally valid descriptor is a declaration, **not** evidence that the runtime binary is present, content-verified or independently sandbox-tested; a future artifact/provenance owner must supply those proofs before any real install/launch permission.

Planning accepts only the frozen inspection object issued by the **same** Compatibility Manager instance. A caller-created object, serialized/deserialized copy or inspection from another manager is not proof of the inspected bytes, even if its schema and fields match. For content-bound profile planning, callers use asynchronous `inspectVerified({ name, bytes })` with a `Uint8Array`. It hashes a private snapshot with Web Crypto SHA-256, then `planCreate` verifies that `payloadDigest` exactly matches that hash. Plain `inspect()` still supports format and launch **planning**, but cannot authorize a profile plan: a digest supplied only by the caller is insufficient.

The private, ephemeral identity check is not a durable attestation and never authorizes installation or execution; future remote/durable consumers need an explicit content-bound verification boundary rather than treating JSON as authority.

## 6. Compatibility profiles

A compatibility profile is the OrdaX-owned identity and durable state boundary for one foreign application/runtime relationship. It is not a raw Wine-prefix API.

The current profile planner is deliberately side-effect-free. It accepts only a validated compatibility inspection and asks the Compatibility Manager itself to resolve the requested runtime. Callers cannot bypass runtime availability by constructing a synthetic ready plan.

A ready profile plan binds:

- a safe OrdaX profile id;
- foreign family;
- resolved compatibility runtime id;
- inspected architecture;
- original payload name;
- original payload SHA-256;
- a safe relative durable-user storage key under `application-compatibility/<family>/<profile-id>`;
- `hostAuthority=none`.

The shared contract never exposes an absolute host filesystem path. Native/Web adapters may later map the relative key to their own storage boundary. The planner has no create/delete/write/install/execute authority.

## 7. User experience target

The target experience remains the useful Nova OrdaX direction:

```text
Downloads/setup.exe
 -> OrdaX identifies the foreign format
 -> Compatibility Manager inspects requirements
 -> OrdaX presents real permissions/storage impact
 -> an isolated compatibility profile is authorized and materialized
 -> the verified runtime performs the install
 -> the app appears in normal OrdaX application surfaces
```

Users should not need to administer raw Wine prefixes during ordinary use.

This target is future behavior, not current availability.

## 8. Expected limitations

Compatibility must never be marketed as universal. Difficult or unsupported classes may include:

- Windows kernel drivers (`.sys`);
- kernel anti-cheat;
- kernel-integrated DRM;
- applications requiring unavailable Windows kernel semantics;
- proprietary privileged hardware stacks;
- strongly Microsoft Store/UWP-bound software;
- software depending on unsupported graphics/device APIs.

Support must be proven per application/profile/runtime class.

## 9. Implementation sequence

The next safe sequence is:

1. package one real Windows compatibility runtime as a verified, content-addressed OrdaX component;
2. keep the runtime adapter replaceable and development-only initially;
3. materialize planned compatibility-profile state under the durable user HOME boundary, never as boot/system authority;
4. define explicit filesystem/network/device/audio/clipboard grants;
5. add install planning without installation side effects;
6. implement a narrow install executor behind explicit authorization;
7. add launch/health/rollback/remove lifecycle;
8. integrate installed foreign applications with the shared launcher/catalog;
9. build a reproducible compatibility test matrix using known test payloads;
10. only then decide which compatibility profile, if any, is exposed in Stable/MVP or later channels.

No step may require compatibility runtime success for normal OrdaX boot, Recovery or Surface availability.

## 10. Relationship with external-app distribution

The repository already contains a signed, non-privileged external-app proof for the future Store/distribution architecture. That proof is currently a Web payload proof and is separate from Windows binary compatibility.

The two responsibilities converge later at application identity, provenance, requested permissions, transactional lifecycle and launcher integration, but they must not be collapsed today:

```text
signed external app proof != Windows compatibility runtime
recognized PE bytes        != trusted application package
runtime available          != installation authorized
profile plan ready          != profile created
launch plan ready           != process executed
```

## 11. Legacy provenance

The architectural reference is:

```text
repository=washingtonmsdj/novo-ordax-os
commit=49fe41fa67d9032f2e349e86592304e64d6c2d88
path=docs/FOUNDATION/COMPATIBILITY/COMPATIBILITY-001.md
```

The migration decision is **REIMPLEMENTED**: useful invariants were reviewed and rebuilt against the current clean-room contracts. No legacy compatibility tree or runtime was copied.

See `docs/SOURCE-MIGRATION.md` for the migration ledger entry.
