# Source Migration Ledger

Status: CANONICAL LEDGER

## Meridian Web and Store integration — 2026-10-14

FOLLOW_UP=Canonical preferences now drive dock favorites and embedded contrast/motion/text scale; material preview/copy matches Meridian; no new preference or service owner

COMPONENT=Canonical Web Central/Desktop and Store presentation; shared Native/USB visual policy
REFERENCE_REPOSITORY=ordaxsystems/ordax-os
REFERENCE_COMMIT=e7cf628a01878c484d47997721518fe6f2330c10
REFERENCE_PATH=Meridian visual freeze, meridian-field.svg, palette/glyph subset already adopted by standalone Store
RESPONSIBILITY=Editorial visual hierarchy, rail/dock/window presentation, Argila/Grafite colors and shared Store visuals
WHY_NEEDED=Explicit later user request to integrate Meridian into Web, retain planned mocks, integrate Store and reuse existing hero imagery
DEPENDENCIES=Existing Central account/preferences/window owners, Store catalog provider and session reducer, canonical symbol/font/alpine assets
SECURITY_REVIEW=No experimental controller, host service, provider, grants, credentials, OAuth, downloader or execution authority imported; examples labelled and session-only
TESTS=See docs/evidence/meridian-integration-2026-10-14/README.md; real/fixture catalog isolation and existing lifecycle regressions retained
DECISION=ADOPTED (presentation only); REFERENCE_ONLY (experiment runtime and fixtures outside the explicitly identified UI examples)

Chrome completion after user follow-up adopts the frozen context/grouped rail,
utilities/account footer, persistent Central search and centered icon dock. One
existing metadata catalog retains menu-only destinations; existing window/identity/
preference/Dialog owners remain. No experimental controller is imported.

The canonical mainline owners and physical/release gates remain unchanged.
The prior standalone-only placement restriction is superseded by explicit user
integration authorization; the standalone entry remains a consumer of the same
shared renderer. No second official catalog, preferences store or window manager.

## Isolated Store visual preview — 2026-10-14

COMPONENT=Standalone Store presentation preview in system/composition/web/store-preview
REFERENCE_REPOSITORY=ordaxsystems/ordax-os
REFERENCE_COMMIT=e7cf628a01878c484d47997721518fe6f2330c10
REFERENCE_PATH=docs/design/MERIDIAN-VISUAL-SYSTEM.md; system/surface/experiments/meridian/meridian.tokens.css; system/surface/experiments/meridian/icons.mjs
RESPONSIBILITY=Argila/Grafite palette, presentation glyphs and perceptual Store composition
WHY_NEEDED=Explicit request for an isolated Store page using Meridian colors and visual identity
DEPENDENCIES=Existing demo catalog and session reducer, first-run selection policy, OS symbol and Inter asset
SECURITY_REVIEW=Presentation-only assets; no experiment shell/controller, official port, host API, grants, credentials or execution imported
TESTS=Explicitly authorized after initial presentation; 69 targeted automated tests passed, Web type-check/build and dedicated preview build passed, 34 reference files verified, 28 browser checks passed; docs/evidence/store-preview-2026-10-14/README.md; no physical or release proof claimed
DECISION=ADOPTED (isolated palette/glyph subset); REFERENCE_ONLY (visual composition)

The production Store renderer/CSS is not changed. All added version/date/size
metadata and operation progress are explicitly illustrative and cannot become
host inventory. The page is a local presentation entry, not a new runtime owner
or promotion of the experimental Meridian visual system into preferences.
[Scope and limits](DESKTOP-IDENTITY.md#isolated-store-visual-preview--2026-10-14).

## Web Central presentation — 2026-10-11

COMPONENT=Surface Web Central and classic desktop presentation
LEGACY_REPOSITORY=ordaxsystems/lovable-core-ui
LEGACY_COMMIT=89438133b322e3ef87e862c80af3a3dbe18251f5
LEGACY_PATH=src/components/central, src/styles.css, src/assets/alpine-{day,night}.jpg
RESPONSIBILITY=Primary Web layout, responsive composition, local appearance and illustrative window state
WHY_NEEDED=Explicit user selection of this layout as the sole active Web page
DEPENDENCIES=Existing React, shared Button/Dialog, Lucide, Tailwind, local Inter and OS Web boot/error boundary
SECURITY_REVIEW=Presentation-only data; no Identity, grants, execution, sync or backend introduced; no upstream SSR/telemetry imported
TESTS=Local build/npm/tests excluded by the user; existing service/window checks preserved and new reference/browser checks prepared, not executed
ARTIFACT_SHA256=Per-file source digests in docs/evidence/web-central-reference-2026-10-11.json
DECISION=ADOPTED

This is source adoption, not public release approval. The reference has no root
LICENSE; final distribution review remains pending. Previous Web presentation
components remain reusable source after automatic review rejected broad
deletion, but the canonical root no longer mounts them. Backend connection is
explicitly deferred; Native and public Account are not replaced.

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

## Ledger 007 — Account Hub Web presentation

COMPONENT=canonical-web-presentation
UPSTREAM_REPOSITORY=washingtonmsdj/account-hub-pro
UPSTREAM_COMMIT=0f955ece6e570801976d8ed77d2cada101b7a3fa
RESPONSIBILITY=Web presentation, local view/window interactions, labeled design demonstrations
WHY_NEEDED=user approved canonical cutover before real service integration
DEPENDENCIES=one root npm manifest/lock; locally bundled UI; shared local Inter and symbol
SECURITY_REVIEW=no upstream credentials/providers; model requests fail closed; no filesystem/native endpoints/grants/installation authority
LICENSE_REVIEW=README states author ownership; user approved reproduction; no LICENSE found; distribution review pending
MAINTENANCE=OS Surface owns adopted source; fixed provenance and locked dependencies
TESTS=typecheck + reference digests + window reducer + candidate receipt + Chromium route/viewport proof + Native/domain regressions
DECISION=ADOPTED_PRESENTATION_ONLY
TARGET_PATH=system/surface/workspace + system/composition/web + tools/surface-web
IMPLEMENTATION=SOURCE_CANDIDATE
NOTES=portal handoff/services/contracts retain ownership; no production activation or kernel/USB changes

## Current ledger state

REVIEWED_COMPONENT_COUNT=7
IMPLEMENTED_MIGRATION_COUNT=3
ADOPTED_PRESENTATION_CANDIDATE_COUNT=1
BULK_LEGACY_IMPORT=NO
LEGACY_REPOSITORY_CHANGED_BY_MIGRATION=NO
