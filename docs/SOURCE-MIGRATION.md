# Source Migration Ledger

Status: CANONICAL LEDGER

This file controls selective reuse from `washingtonmsdj/novo-ordax-os`.

## Rule

Nothing is imported by directory-copy or history-copy. Every reused component must be reviewed independently.

## Required record

Use one entry per migrated component:

```text
COMPONENT=
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=
LEGACY_PATH=
RESPONSIBILITY=
WHY_NEEDED=
DEPENDENCIES=
SECURITY_REVIEW=
TESTS=
ARTIFACT_SHA256=
DECISION=ADOPTED|REIMPLEMENTED|REJECTED|REFERENCE_ONLY
TARGET_PATH=
IMPLEMENTATION=COMPLETE|PENDING|NOT_APPLICABLE
NOTES=
```

## Initial migration candidates

1. known-good kernel artifact/source;
2. known-good minimal initramfs artifact/source;
3. only the network drivers/userspace required by the actual notebook;
4. stable device identity logic;
5. useful remote-access invariants such as additive operator authorization, persistent device identity and fail-closed trust;
6. Control Plane attestation/bootstrap logic;
7. minimal maintenance/recovery functionality;
8. trustworthy target-identification/provisioning ideas that can be simplified for the two-partition contract.

## Explicitly not imported by default

- `history/` trees;
- temporary diagnostic scripts;
- old physical-layout contracts requiring `ORDAX-HOME` as a partition;
- obsolete rsync-daemon ownership;
- duplicate remote-access owners;
- fail-open SSH helpers;
- full SSH/QEMU/F7 development subsystem;
- backup outputs, generated artifacts or physical evidence as source code;
- stale compatibility bridges;
- complete desktop/application trees before the bootstrap substrate is proven.

## Migration sequence

```text
inspect legacy implementation
 -> identify real invariant
 -> decide adopt vs reimplement
 -> add prototype test/contract
 -> implement in prototype
 -> verify independently
 -> record result in this ledger
```

## Ledger 001 - Kernel baseline

```text
COMPONENT=kernel
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=f8ea8424f8cf52b516800f16f2331090ccb56748
LEGACY_PATH=out/forge/gate-inputs/vmlinuz-f3h + F3H build recipe
RESPONSIBILITY=boot kernel and hardware/module substrate
WHY_NEEDED=known-good notebook/maintenance baseline
DEPENDENCIES=official Linux 6.6.52 source; GCC 13; reviewed kernel config
SECURITY_REVIEW=no legacy build cache or pre-extracted source accepted as authority
TESTS=legacy F3H isolated build/proof inspected; prototype tests pending
ARTIFACT_SHA256=351941db619b7e93a4dc87010dbf39d3b8bf07262c73342381021385398a277d
DECISION=REIMPLEMENTED
TARGET_PATH=bootstrap/kernel
IMPLEMENTATION=PENDING
NOTES=Keep version/source identity and known-good output digest as baseline; do not import Forge subsystem.
```

Official Linux archive identity selected from the legacy source contract:

```text
KERNEL_VERSION=6.6.52
KERNEL_SOURCE_SHA256=1591ab348399d4aa53121158525056a69c8cf0fe0e90935b0095e9a58e37b4b8
```

See `bootstrap/kernel/PROVENANCE.md`.

## Ledger 002 - Initramfs/bootstrap capsule

```text
COMPONENT=initramfs
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=f8ea8424f8cf52b516800f16f2331090ccb56748
LEGACY_PATH=ordax-bootstrap/scripts/build-initramfs.sh + docs/contracts/boot-capsule-minimal.manifest.json
RESPONSIBILITY=pre-release boot/bootstrap/recovery substrate
WHY_NEEDED=machine must boot, recover and reach a verified release before full OS exists
DEPENDENCIES=kernel modules/firmware; minimal userspace; reviewed network/identity/remote/release bootstrap
SECURITY_REVIEW=legacy manifest contains old storage/layout responsibilities and cannot be copied intact
TESTS=legacy deterministic builder/proof inspected; clean-room manifest/tests pending
ARTIFACT_SHA256=428c9cd1c54e35534b358fbf8a6384b28b72c005f26a7c568217895fc6733ee3
DECISION=REIMPLEMENTED
TARGET_PATH=bootstrap/initramfs
IMPLEMENTATION=PENDING
NOTES=Legacy archive is evidence only. New initramfs must understand ORDAX-ESP + ORDAX and must not require physical ORDAX-HOME.
```

An older evidence record referenced SHA256 `038769af1a65954cf511c6b1a4f1b1b4f9845f289e934156fb6715de1d5f42ee`; it is historical and not the selected current legacy baseline.

See `bootstrap/initramfs/PROVENANCE.md`.

## Ledger 003 - Legacy SSH/operator authorization evidence

Codex completed one additional legacy hardening commit after the prototype SSH-source hardening baseline.

Repository continuity verified through GitHub:

```text
BASE=f8ea8424f8cf52b516800f16f2331090ccb56748
HEAD=49fe41fa67d9032f2e349e86592304e64d6c2d88
HEAD_PARENT=f8ea8424f8cf52b516800f16f2331090ccb56748
DIVERGENCE=NO
```

Reported public-key fingerprints:

```text
OLD_OPERATOR_KEY=SHA256:Q2ClLoKlAz4WTsFoc8+b3pBnjim8mayhhzafM9eJ8f0
NEW_OPERATOR_KEY=SHA256:wKKyxsf8vQ3uKYczpqKnv/P2LTbHILs8oYnrqNRGvuM
OLD_KEY_PRESERVED=YES
NEW_KEY_ADDED=NO_PHYSICAL_TARGET_PENDING
```

Migration decision:

```text
COMPONENT=legacy-ssh-operator-trust
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=49fe41fa67d9032f2e349e86592304e64d6c2d88
LEGACY_PATH=tools/ordax-dev + scripts/remote-access.sh + F7/QEMU trust path
RESPONSIBILITY=legacy development access and host/operator trust
WHY_NEEDED=extract proven invariants only
DEPENDENCIES=SSH/QEMU/legacy Control Plane flow
SECURITY_REVIEW=private keys not imported; fingerprints are public identifiers; fail-closed/additive authorization are useful invariants
TESTS=legacy report: SSH policy 7 PASS; security 3 PASS; F7/QEMU 18 PASS; Control Plane identity 8 PASS; planner 37 PASS; physical proof pending
ARTIFACT_SHA256=NOT_APPLICABLE
DECISION=REFERENCE_ONLY
TARGET_PATH=bootstrap/remote + docs/REMOTE-CONTROL.md
IMPLEMENTATION=NOT_APPLICABLE
NOTES=Do not copy the SSH/QEMU/F7 subsystem. Reimplement additive authorization, persistent identity and fail-closed trust in OrdaX Remote Core using standard secure transport.
```

Physical SSH/live-sync evidence remains pending because the USB is on Windows and the notebook is not booted from it.

## Ledger 004 - Ordax Intelligence architecture invariants

```text
COMPONENT=ordax-intelligence-architecture-invariants
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=49fe41fa67d9032f2e349e86592304e64d6c2d88
LEGACY_PATH=docs/intelligence/* + .foundation/ARCHITECTURE.md + .foundation/LAYERS.md
RESPONSIBILITY=system intelligence layer separated from model execution, with governed context/tools/providers
WHY_NEEDED=owner decision makes local system Intelligence part of Stable/MVP while preserving provider-neutral evolution
DEPENDENCIES=shared Runtime/service contracts; local inference backend; explicit future capability/tool grants
SECURITY_REVIEW=no legacy runtime or agent code copied; authority remains none in MVP; no implicit tools, file writes, shell, network egress, installation or disk mutation
TESTS=tests/test_intelligence_runtime.mjs + component/local-AI contract regression
ARTIFACT_SHA256=NOT_APPLICABLE_SOURCE_REIMPLEMENTATION
DECISION=REIMPLEMENTED
TARGET_PATH=system/contracts/intelligence.mjs + system/services/intelligence + docs/contracts/intelligence.json
IMPLEMENTATION=COMPLETE
NOTES=Preserve the legacy separation Ordax Intelligence -> AI Runtime/Inference Broker while reimplementing clean-room in the current architecture. Assistant UI is a client, not the intelligence owner.
```


## Ledger 005 - Development Device Agent control-plane protocol

```text
COMPONENT=ordax-device-agent-development-control-plane
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=49fe41fa67d9032f2e349e86592304e64d6c2d88
LEGACY_PATH=tools/ordax-control-plane/supabase/migrations/20260905180845_add_boot_capsule_preflight_capability.sql + tools/ordax-control-plane/supabase/migrations/20260829005500_ordax_internal_develop_fastpath_v2.sql
RESPONSIBILITY=typed engineering job queue, authorization, leasing/fencing and Device Agent delivery semantics
WHY_NEEDED=the OrdaX Device Agent historically incubated in mcp-blender needs one shared development control plane without creating a second backend or merging product credentials with engineering authority
DEPENDENCIES=ordax-control-plane engineering tables/functions; device-scoped development credential; OrdaX Device Agent typed ActionRegistry
SECURITY_REVIEW=product and development credentials remain separate; adapter envelope is DEVELOP-only, Blender-only in v1, project-scoped, bounded and cannot grant generic shell/raw disk/release signing/SYSTEM authority
TESTS=tests/test_device_agent_contracts.mjs in this repository + tests/test_development_control_plane.py in washingtonmsdj/mcp-blender
ARTIFACT_SHA256=NOT_APPLICABLE_SOURCE_REIMPLEMENTATION
DECISION=REIMPLEMENTED
TARGET_PATH=infra/supabase/development
IMPLEMENTATION=COMPLETE_BACKEND_APPLIED
NOTES=Legacy source is protocol reference/provenance only. The prototype owns the new ordax.dev.adapter.invoke extension and GitHub OIDC development-device enrollment, both applied to ordax-control-plane, while infra/supabase/product authority remains separate.
```

## Ledger 006 - Application compatibility architecture invariants

```text
COMPONENT=application-compatibility-foundation
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_COMMIT=49fe41fa67d9032f2e349e86592304e64d6c2d88
LEGACY_PATH=docs/FOUNDATION/COMPATIBILITY/COMPATIBILITY-001.md
RESPONSIBILITY=detect foreign application formats and select an explicitly available compatibility runtime without granting execution authority
WHY_NEEDED=preserve the Windows/Linux compatibility direction while the prototype already has signed external-app distribution foundations but no Windows runtime path
DEPENDENCIES=shared system contracts; future content-addressed compatibility runtime component; future sandbox/permissions/profile lifecycle
SECURITY_REVIEW=no legacy runtime/code copied; foreign payloads remain untrusted; extension alone grants no trust; there is no default/fake Wine or Proton provider; the current port exposes no install/execute/shell/spawn/write authority; runtime descriptors must represent a real available sandboxed execution-enabled runtime and bind an immutable source identity to SHA-256
TESTS=tests/test_application_compatibility.mjs + tests/test_application_compatibility.py
ARTIFACT_SHA256=NOT_APPLICABLE_SOURCE_REIMPLEMENTATION
DECISION=REIMPLEMENTED
TARGET_PATH=system/contracts/application-compatibility.mjs + system/services/compatibility + docs/contracts/application-compatibility.json
IMPLEMENTATION=COMPLETE_FOUNDATION
NOTES=Reimplements the legacy Compatibility Manager inspection/runtime-selection invariants clean-room. Windows execution remains unavailable until a real verified runtime adapter and sandbox/profile lifecycle are implemented.
```

## Current ledger state

```text
REVIEWED_COMPONENT_COUNT=6
IMPLEMENTED_MIGRATION_COUNT=3
BULK_LEGACY_IMPORT=NO
LEGACY_REPOSITORY_CHANGED_BY_MIGRATION=NO
```
