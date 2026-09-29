# Promotion Gates

Status: CANONICAL FOR PROTOTYPE

This repository remains a prototype until every required canonical product gate below is closed with reproducible evidence. A green CI candidate never implicitly authorizes physical-media mutation. Owner/Development evidence is recorded explicitly where it exists, but it must not be reinterpreted as Stable/MVP release proof.

## Gate 0 - Repository foundation

Required:

```text
AGENTS_CONTRACT=PASS
ARCHITECTURE_CONTRACT=PASS
BUILD_AUTONOMY_CONTRACT=PASS
PRODUCT_MODES_CONTRACT=PASS
MINIMAL_USB_CONTRACT=PASS
HOST_INDEPENDENCE_CONTRACT=PASS
PHYSICAL_MEDIA_CONTRACT=PASS
DEVELOPMENT_WORKFLOW=PASS
MIGRATION_LEDGER=PASS
```

Remote control is not a promotion prerequisite unless a later ADR makes it a supported product requirement.

## Gate 1 - Autonomous reproducible build foundation

Required:

```text
CODEX_REQUIRED=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
REPOSITORY_BUILD_RECIPE=PASS
UPSTREAM_SOURCE_HASH_VERIFY=PASS
ARTIFACT_PROVENANCE=PASS
ARTIFACT_SHA256=PASS
PORTABLE_BUILD_ENTRYPOINT=PASS
PINNED_BUILD_ENVIRONMENT=PASS
KERNEL_REPEAT_DIGEST_PROOF=PASS
KERNEL_BUILD_ENVIRONMENT_PROMOTABLE=YES
PHYSICAL_KERNEL_AUTHORIZED=NO
```

The immutable kernel environment is now pinned by OCI manifest digest, APT snapshot, exact package versions and CA-bundle digest in `docs/contracts/kernel-build-environment.json`. Two independent builds produced identical config, modules and bzImage SHA-256 values, so the build-environment portion of this gate is closed. `PHYSICAL_KERNEL_AUTHORIZED=NO` remains a separate physical-media decision and is not changed by reproducibility proof.

## Gate 2 - Reproducible minimal bootstrap source

Current state:

```text
BOOTSTRAP_SOURCE=PASS
MINIMAL_BOOTSTRAP_MANIFEST=PASS_CANONICAL_BYTES_RESOLVED
KERNEL_PROVENANCE=PASS_PINNED_REPEAT_PROOF
INITRAMFS_PROVENANCE=PASS
RELEASE_CHANNEL=PASS
RELEASE_TRUST_POLICY=PASS
RELEASE_TRUST_KEY_MATERIAL=GENERATED_LOCAL_RECOVERY_VERIFIED
RELEASE_TRUST_RECOVERY=PASS_CRYPTOGRAPHIC_OPERATOR
RELEASE_TRUST_LOCAL_ENCRYPTED_BACKUP_COPY=PASS_BYTE_IDENTICAL
RELEASE_TRUST_EXTERNAL_OFFLINE_BACKUP=DEFERRED_BEFORE_BROAD_DISTRIBUTION
REAL_PUBLIC_TRUST_ANCHOR=PASS_PINNED
PRIVATE_SIGNING_KEY_IN_GIT=NO
PRIVATE_SIGNING_KEY_IN_USB=NO
FULL_SYSTEM_PRESEEDED=NO
SURFACE_PRESEEDED=NO
NORMAL_APPS_PRESEEDED=NO
REMOTE_CORE_PRESEEDED=NO
CONTROL_PLANE_PRESEEDED=NO
SSH_PRESEEDED=NO
COMPLETE_SOURCE_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
```

The trust custody/recovery/rotation policy is defined in `docs/contracts/release-trust-policy.json`; the actual canonical public trust artifact is now pinned and bound into the minimal bootstrap.

The signed trust-transition protocol is implemented and CI-proven as a separate forward-resilience boundary. The cryptographic recovery proof and canonical public-anchor promotion are complete for the first controlled prototype. Independent off-device backup custody is still deferred and remains required before broad public distribution. None of these facts authorizes a physical write; production rotation also remains blocked until stateful device activation and effective-trust selection exist.

## Gate 3 - Two-partition bootstrap-seed provisioning in disposable media

```text
DISPOSABLE_GPT=PASS
PARTITION_COUNT=2
SEPARATE_HOME_PARTITION=NO
FILESYSTEMS=FAT32,EXT4
FILESYSTEM_LABELS=PASS
POST_MATERIALIZATION_HASH_VERIFY=PASS
RAW_PARTITION_BYTES_VERIFY=PASS
PROVISION_VERIFY=PASS
PHYSICAL_WRITE_AUTHORIZED=NO
```

This gate is proven against the capacity-independent **bootstrap seed** through an ephemeral regular RAW representation plus Creator Core staging and `tools/creator/proof/disposable_media.py`. It does not describe the final prepared USB geometry and does not authorize a physical write. The final Creator-prepared target is governed separately by `docs/contracts/physical-prepared-media.json` and includes target-capacity-specific `ORDAX-DATA`.

## Gate 4 - Boot artifact and bootstrap proof

Current source/CI and Owner/Development state:

```text
UEFI_BOOT_CONTRACT=PASS
BOOTSTRAP_ENTRY=PASS
NETWORK_BOOTSTRAP_BUILD=PASS
RELEASE_ACQUISITION_ENTRY=PASS
RELEASE_CHANNEL_VALIDATION=PASS
RELEASE_AGENT_SAFE_MATERIALIZATION=PASS
SYSTEM_ENTRYPOINT=PASS
SURFACE_BOOTSTRAP_RUNTIME=PASS
REAL_SYSTEM_BUNDLE=PASS
RELEASE_TRUST_VALIDATION_WITH_EPHEMERAL_CI_KEY=PASS
RELEASE_TRUST_VALIDATION_WITH_CANONICAL_KEY=PENDING
PORTABLE_V4_QEMU_UEFI_BOOT_PROOF=PASS_CI_NON_PHYSICAL
DEVELOPMENT_PHYSICAL_KERNEL_BOOT=PASS_PHYSICAL_DEVELOPMENT_USB
CANONICAL_PHYSICAL_KERNEL_BOOT_PRE_HARDENING=PASS_PHYSICAL_STABLE_MVP_USB
CANONICAL_PHYSICAL_KERNEL_BOOT_CURRENT_MAIN=PENDING_PHYSICAL_RETEST
LEGACY_MEDIA_DEPENDENCY=NO
EMULATOR_SPECIFIC_DEPENDENCY=NO
REMOTE_CONTROL_DEPENDENCY=NO
```

The Owner/Development USB physically boots the pinned kernel path on the target notebook. The first governed Stable/MVP USB also reached real UEFI/kernel boot before the post-boot hardening merged in PR #588. That is valid historical Stable/MVP evidence, but it does not prove the current hardened `main` bytes. The canonical current-main kernel/boot gate therefore remains pending a non-destructive physical retest of a separately authorized future candidate; CI OVMF proof does not substitute for that retest.

## Gate 5 - OrdaX Creator host independence and target safety

```text
CREATOR_SHARED_CORE=PASS
WINDOWS_WITHOUT_WSL=PASS
HOST_POLICY_FORKS=NO
END_USER_KERNEL_TOOLCHAIN_REQUIRED=NO
CREATOR_VERIFY=PASS
CREATOR_STAGE_TREE_TRANSACTIONAL=PASS
CREATOR_MINIMAL_PAYLOAD_ONLY=PASS
WINDOWS_USB_TARGET_DISCOVERY=PASS
WINDOWS_FIXED_MEDIA_USB_DISCOVERY=PASS
USB_TRANSPORT_VERIFICATION=PASS
WINDOWS_SYSTEM_DISK_EXCLUSION=PASS
TARGET_CONFIRMATION_TOKEN=PASS
TARGET_IDENTITY_RECOMPUTED_AT_CONFIRMATION=PASS
TARGET_REENUMERATION=PASS
BLOCKED_RAW_DISK_PLAN=PASS_SCHEMA_V2
INTERNAL_RAW_WRITER_ORCHESTRATION=PASS_FAKE_BACKEND_ONLY
RAW_WRITE_READBACK_SHA256=PASS_FAKE_BACKEND_ONLY
INTERNAL_TARGET_VOLUME_LEASE=PASS
WINDOWS_READ_ONLY_PHYSICALDRIVE_HANDLE_PROBE=PASS
WINDOWS_VOLUME_EXTENT_INVENTORY=PASS
WINDOWS_TARGET_VOLUME_ISOLATION=PASS
WINDOWS_RAW_BACKEND_BUILD_TAG=ordax_raw_backend
WINDOWS_RAW_BACKEND_BUILD_TAG_ISOLATION=PASS
WINDOWS_RAW_BACKEND_IN_PUBLIC_BUILD=NO
WINDOWS_VOLUME_LOCK_DISMOUNT_PRIMITIVES=PASS_TAGGED_UNBOUND
WINDOWS_WRITABLE_PHYSICALDRIVE_HANDLE=PASS_TAGGED_UNBOUND
WINDOWS_PROCESS_ELEVATION_PROBE=PASS_TAGGED_UNBOUND
WINDOWS_NATIVE_RAW_DISK_BACKEND=PASS_TAGGED_UNBOUND
WINDOWS_NATIVE_HOST_TESTS=PASS
WINDOWS_PROTOTYPE_TOOLKIT=PASS
PORTABLE_PHYSICAL_WRITER=PASS_TAGGED_INTERNAL
PORTABLE_PHYSICAL_WRITER_LAYOUT=ORDAX-ESP_FAT32_PLUS_ORDAX-DATA_EXFAT
PORTABLE_PHYSICAL_WRITER_OPERATION_COUNT=39
PORTABLE_PHYSICAL_WRITER_ARTIFACT_COUNT=17
PORTABLE_PHYSICAL_WRITER_PER_ARTIFACT_READBACK=SHA256_PLUS_SIZE
PORTABLE_PHYSICAL_WRITER_WHOLE_DISK_RAW=NO
PORTABLE_PHYSICAL_WRITER_UAC_REQUIRED=YES
PORTABLE_PHYSICAL_WRITER_LIVE_TARGET_REVALIDATION=YES
CREATOR_PUBLIC_BINARY_LINKS_NATIVE_RAW_BACKEND=NO
CREATOR_PUBLIC_PHYSICAL_APPLY=NO
PHYSICAL_WRITE_AUTHORIZED=NO
```

The target helper may accept Win32 removable or fixed media only when the mapped PhysicalDrive reports USB transport. The physical disk hosting the running Windows installation is always excluded. Target confirmation recomputes the token from the current identity instead of trusting a stored token. The Windows adapter re-proves target identity on exact raw-device handles, maps every Windows volume through physical extents and rejects cross-disk/spanned ownership.

The final Portable writer now reuses the hardened Windows destructive boundary but no longer depends on a target-sized whole-disk RAW image. Creator Core owns the exact 39-operation plan: write a two-partition GPT, format `ORDAX-ESP` as FAT32 and `ORDAX-DATA` as exFAT, materialize 17 exact artifacts including the content-addressed Local AI runtime plus its release reference, flush, re-read all 17 artifacts by SHA-256+size, and verify final geometry/labels/capacity. The tagged Windows runtime revalidates the USB identity during destructive phases, requires UAC elevation, holds source artifact handles during apply, syncs each destination, and fails closed on the first mismatch.

CI proves both sides of this boundary: the normal Windows build excludes the tagged destructive files and the public `ordax-creator.exe` does not depend on `tools/creator/host/windows`; separately, native Windows CI compiles/tests the tagged Portable writer and proves its unbound `prepare-portable`/`apply-portable` commands remain unauthorized. The implementation is therefore present without becoming a public capability: `public_physical_apply_implemented=false` and `physical_write_authorized=false` remain mandatory until canonical trust and the separate physical-promotion contract are resolved.

## Gate 6 - Physical USB reprovisioning

This gate is destructive and requires explicit user authorization at execution time.

Before evaluating destructive readiness, the Stable/MVP product must also pass the
functional closure audit in `PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md`. Physical
write readiness is therefore intentionally stricter than boot/media readiness.

```text
PRE_USB_NOVA_ORDAX_AUDIT=REQUIRED
INTELLIGENCE_REAL_SYSTEM_CONSUMER=REQUIRED
LOCAL_SESSION_LOCK_POLICY=REQUIRED
LOCAL_SESSION_LOCK_IMPLEMENTATION=REQUIRED
OOBE_PERSISTENCE=REQUIRED
OOBE_LOCALE_COVERAGE=REQUIRED_OR_EXPLICITLY_REDUCED
FILES_DAILY_OPERATIONS=REQUIRED
DIAGNOSTICS_RECOVERY_PRESENTATION=REQUIRED
SUPPORTED_HARDWARE_MATRIX=REQUIRED
SIGNED_RELEASE_V4_WITH_LOCAL_AI=REQUIRED
```

These are product/source gates. They never imply target selection, UAC, destructive
consent or physical-write authority.


The source-controlled preflight distinguishes three boundaries without weakening the destructive gate:

- while the canonical v4 aggregate proof is missing or unbound, `pre_authorization_ready=false` and owner consent is not reachable;
- after `canonical-v4-release-proof.json` is validated and bound to the exact trust/source commit/manifest/envelope/artifact identities, `pre_authorization_ready=true` may expose the separate owner-consent preflight, but **no destructive candidate may be materialized yet**;
- `ready=true` exists only after explicit owner authorization and exact trust/bootstrap/Portable/canonical-release-proof bindings all match current source.

`pre_authorization_ready` is diagnostic only. It never implies `physical_write_allowed`, never creates a writer artifact, and never substitutes for target-specific confirmation or UAC at execution time.

The Stable/MVP physical payload is a 17-artifact `release-manifest/4` shape. The exact v4 candidate at `b924ff8d74d1761232381ae3f9604bba17497cfd` was previously authorized for one controlled physical proof. That authorization was used to create the first governed Stable/MVP USB; the writer completed 17/17 artifact readback and the media reached real UEFI boot on the target notebook. After the physical boot exposed product-level gaps and the writer/source context changed during the resulting hardening, that prior proof/authorization became historical. The structured contract is now deliberately back at `blocked-canonical-v4-release-proof-pending`, with `canonical_v4_release_proof_bound=false`, `physical_write_allowed=false` and `explicit_owner_authorization=false`. Owner consent is not reachable until a replacement signed/materialized proof from a different post-hardening source commit is validated and bound. No fresh destructive operation is authorized for the post-#588 `main`.

The operator-controlled historical flow produced `canonical-v4-release-proof.json` from the verified signed handoff plus canonical HTTPS materialization receipt. The non-destructive `tools/creator/bind_canonical_v4_release_proof.py` command validated that public receipt against the pinned trust, required exact v4 artifact identities and safe false physical/activation flags, copied only the public receipt into `docs/evidence/`, and bound its SHA-256/source commit/manifest/envelope identity into authorization schema v3. That proof made explicit owner authorization reachable for the earlier physical pass. In the current PRE_PROOF state, the binder explicitly rejects rebinding either the same proof bytes or another proof for the same superseded source commit. A genuinely new post-hardening source/proof is required before the state machine may advance to `blocked-explicit-physical-authorization-pending`.

The source-controlled `tools/creator/authorize_physical_write.py` command removes manual JSON editing from the later consent step. Its `check` mode is read-only and now refuses to proceed unless the canonical v4 proof is valid and exactly bound. Its `authorize` mode is permitted only after pre-authorization readiness and exact bindings are proven, requires the exact Stable/MVP scope + release sequence + explicit authorization phrase, and changes only the authorization contract. Neither proof binding nor owner authorization opens a physical device or invokes the writer.

Before any new write:

```text
TARGET_IDENTITY=PASS
TARGET_REENUMERATION_IMMEDIATELY_BEFORE_WRITE=REQUIRED
TARGET_HANDLE_IDENTITY_PROOF=PASS
TARGET_VOLUME_EXTENT_INVENTORY=PASS
TARGET_VOLUME_ISOLATION=PASS
TARGET_VOLUME_LEASE_POLICY=PASS
RAW_BACKEND_BUILD_TAG_ISOLATION=PASS
TARGET_VOLUME_LOCK_DISMOUNT_PRIMITIVES=PASS_TAGGED_UNBOUND
WRITABLE_PHYSICALDRIVE_HANDLE=PASS_TAGGED_UNBOUND
PROCESS_ELEVATION_PROBE=PASS_TAGGED_UNBOUND
NATIVE_WINDOWS_RAW_DISK_BACKEND=PASS_TAGGED_UNBOUND
RAW_BACKEND_IN_PUBLIC_BUILD=NO
PUBLIC_PHYSICAL_APPLY=NO
SOURCE_LAYOUT_CONTRACT=PASS
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=YES
CANONICAL_RELEASE_TRUST=PASS_CANONICAL_PUBLIC_ANCHOR_PINNED
CANONICAL_TRUST_TOOLKIT=PASS_MAIN_PUSH_PROVENANCE_ELIGIBLE
CANONICAL_TRUST_TOOLKIT_LOCAL_PREFLIGHT=PASS_OPERATOR_2026_09_21
CANONICAL_KEY_MATERIAL_GENERATED=YES_LOCAL_RECOVERY_VERIFIED
RELEASE_AGENT_HASH_ADDRESSED_ASSET=PASS_MAIN_PUBLISHED
RELEASE_AGENT_CANONICAL_SHA256=550df685679f1bf15a636729960fe6fc3ffc1afda1a346214ce96716f7170a66
RELEASE_AGENT_LEGACY_SEED_SHA256=721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740
PINNED_BOOT_BUILD_ENVIRONMENT=PASS
DISPOSABLE_LAYOUT_TEST=PASS
FULL_BOOTSTRAP_BYTE_COMPLETE_PROOF=PASS_MAIN_CANONICAL_TRUST
DESTRUCTIVE_OPERATION_EXPLICITLY_AUTHORIZED=NO
```

`PASS_TAGGED_UNBOUND` is not an authorization state. It means the implementation exists only behind the explicit internal `ordax_raw_backend` build tag, is excluded from public builds and has no public apply route. A previous explicitly authorized physical proof does not create standing authority for another write. No new physical-media mutation is permitted until a replacement post-hardening v4 proof is produced and bound, the resulting exact context is deliberately authorized, and the target-specific confirmation/UAC gates pass.

Historical physical evidence and current-main retest state:

```text
PRIOR_STABLE_MVP_USB_WRITE=PASS_AUTHORIZED_CONTROLLED_PROOF
PRIOR_STABLE_MVP_ARTIFACT_READBACK=PASS_17_OF_17
PRIOR_STABLE_MVP_UEFI_BOOT=PASS_PHYSICAL_PRE_HARDENING
CURRENT_MAIN_PHYSICAL_GPT_VERIFY=PENDING_NEW_AUTHORIZED_CANDIDATE
CURRENT_MAIN_PHYSICAL_FILESYSTEM_VERIFY=PENDING_NEW_AUTHORIZED_CANDIDATE
CURRENT_MAIN_BOOT_ARTIFACT_HASH_VERIFY=PENDING_NEW_AUTHORIZED_CANDIDATE
CURRENT_MAIN_PHYSICAL_PAYLOAD_MATCHES_MANIFEST=PENDING_NEW_AUTHORIZED_CANDIDATE
UNAPPROVED_FULL_SYSTEM_PRESEED=NO
```

Current authorization status:

```text
PHYSICAL_USB_WRITE_HISTORY=YES_PRIOR_CONTROLLED_PROOF
PHYSICAL_LAYOUT_CHANGED_HISTORY=YES_PRIOR_CONTROLLED_PROOF
CURRENT_CANONICAL_V4_RELEASE_PROOF=PENDING_POST_HARDENING_REPLACEMENT
DESTRUCTIVE_AUTHORIZATION=NOT_REACHABLE_REPLACEMENT_PROOF_REQUIRED
POST_588_PHYSICAL_REWRITE_AUTHORIZED=NO
```

## Gate 7 - Physical notebook bootstrap

Owner/Development, the pre-hardening Stable/MVP proof and the current hardened Stable/MVP source are separate evidence scopes:

```text
DEVELOPMENT_NOTEBOOK_UEFI_BOOT=PASS_PHYSICAL_DEVELOPMENT_USB
CANONICAL_NOTEBOOK_UEFI_BOOT_PRE_HARDENING=PASS_PHYSICAL_STABLE_MVP_USB
CANONICAL_NOTEBOOK_UEFI_BOOT_CURRENT_MAIN=PENDING_PHYSICAL_RETEST
DEVELOPMENT_NETWORK_READY=PASS_PHYSICAL_DEVELOPMENT_USB
CANONICAL_NETWORK_READY=PENDING_PHYSICAL
DEVELOPMENT_GIT_MAIN_REACHABLE=PASS_PHYSICAL_DEVELOPMENT_USB
CANONICAL_RELEASE_CHANNEL_REACHABLE=PENDING_PHYSICAL
CANONICAL_RELEASE_SIGNATURE_VERIFY=PENDING_CANONICAL_TRUST_AND_PHYSICAL
DEVELOPMENT_RESCUE_PATH=PASS_PHYSICAL_DEVELOPMENT_USB
CANONICAL_RECOVERY_PATH=PENDING_PHYSICAL
SSH_REQUIRED=NO
REMOTE_CORE_REQUIRED=NO
CONTROL_PLANE_REQUIRED=NO
```

The target notebook has already booted both the Owner/Development USB and the first governed Stable/MVP USB through real UEFI. The Stable/MVP pass exposed the gaps addressed by PR #588, including physical Wi-Fi readiness, launch/window behavior, first-run layout and production boot presentation. Those observations are retained as pre-hardening product evidence only. Because #588 changes the candidate bytes and boot/runtime behavior, the current `main` still requires a separately authorized physical retest before `CANONICAL_NOTEBOOK_UEFI_BOOT_CURRENT_MAIN`, graphical mode, network readiness, cold-health, recovery or rollback can be promoted.

## Gate 8 - First canonical network release acquisition and activation

Required:

```text
FIRST_RELEASE_ACQUIRED_AFTER_BOOT=PENDING
RELEASE_MATERIALIZE=PASS_IN_AGENT_TESTS
RELEASE_INTEGRITY=PASS_IN_AGENT_TESTS
ATOMIC_ACTIVATION=PASS_IN_AGENT_TESTS
PORTABLE_V3_ONE_SHOT_ACTIVATION=PASS_CI_DISPOSABLE_FAILURE_FALLBACK
PORTABLE_V3_REJECTED_SHA_PERSISTENCE=PASS_CI_DISPOSABLE_ONE_SHOT
KNOWN_GOOD_PERSISTED=PENDING_PHYSICAL
KNOWN_GOOD_OFFLINE_BOOT=PENDING_PHYSICAL
ROLLBACK=PENDING_PHYSICAL
COLD_HEALTH_COMMIT_PROOF=REQUIRES_PHYSICAL_STABLE_MVP_NO_SYNTHETIC_CI
```

A Stable/MVP release must be tied to an exact source commit and authenticated before activation. The current Portable Stable/MVP path is `release-manifest/4`: the supervisor inspects the signed manifest schema, selects exact v4 materialization/verification, arms the ext4 one-shot candidate, reboots, and commits `current/known-good` only after cold Surface health. A pre-v4 device may still consume v3 during the compatibility window, but once a verified v4 boot is current, a remote v3 manifest is rejected as a schema downgrade. The v4 direct-kernel + OVMF/UEFI handoff with Local AI is PASS_CI. The older v3 disposable proofs remain compatibility/baseline evidence: source `c8c8fe526d03ced7630420cd116dd954b08ef03a` / run `35598937763` proved exact-main current-slot boot, and source `837a99733654943f08a400d6cc3fb28bf84605f8` / run `35607396175` proved the armed one-shot **failure path**: one candidate boot, exact fallback to the previous release on the second boot, persisted `rejected=candidate`, and removal of `candidate` plus `activation-transaction.json`. These CI proofs deliberately do **not** prove cold-health commit, physical `KNOWN_GOOD`, physical `ROLLBACK`, physical USB boot or Secure Boot; those remain separate gates. Cold-health must not be closed by a synthetic CI acknowledgement: the product health path requires the real Cage/Wayland/WebKit/seatd Surface runtime plus the native host heartbeat/health SHA handshake, so the healthy-promotion gate remains a Stable/MVP physical proof. The Owner/Development Git checkout/update path is deliberately not counted as completion of this canonical release gate.

## Gate 9 - Single-source Surface across Web and native

```text
ONE_SURFACE_SOURCE=ARCHITECTURE_PASS
SYSTEM_TO_SURFACE_HANDOFF=PASS
BOOTSTRAP_SURFACE_RUNTIME=PASS
UI_FORKS=NO_BY_CONTRACT
WEB_MODE=PASS_SOURCE_BROWSER_CANDIDATE
NATIVE_GRAPHICAL_MODE=PASS_PHYSICAL_DEVELOPMENT_USB
SAME_COMMIT_VISUAL_CHANGE=PASS_PHYSICAL_DEVELOPMENT_USB
MVP_SURFACE_SMOKE_HARNESS=PASS_SOURCE
MVP_SURFACE_SMOKE_PHYSICAL=PENDING
CANONICAL_STABLE_GRAPHICAL_MODE=PENDING
CAPABILITY_ADAPTER_BOUNDARY=PASS_BY_CONTRACT
```

The Web candidate is exercised against the shared Surface graph, and the Owner/Development USB has physically rendered that shared graphical source with keyboard/mouse interaction on the target notebook. A live-safe UI change and its cleanup were both pulled and visibly applied without reboot on the same notebook, closing the development same-source/same-session visual-change proof. The read-only MVP Surface smoke harness is source-controlled and CI-tested with bounded baseline/after collection, a machine-readable `tour-template`, comparison recomputation and a `finalize` step that fails closed unless all 12 required tour items are PASS and the supplied comparison matches a fresh recomputation. The running Surface now publishes a private ephemeral runtime-proof context; the harness resolver fails closed unless that context identifies exactly `owner-development + dynamic-native-runtime + development` or the verified Stable/MVP runtime as `stable-mvp + verified-erofs-overlay + canonical-stable-mvp`, with the verified runtime SHA-256 required in the Stable case. Stable/MVP no longer requires or mounts a Git repository into the graphical runtime. The automatic smoke also includes configured/applied physical keyboard layout with a same-session stability check. The actual canonical notebook session remains pending, so `MVP_SURFACE_SMOKE_PHYSICAL=PENDING` is still correct. None of these facts substitutes for first canonical Stable/MVP graphical boot proof.

## Gate 10 - Git-driven live incremental development

Current Owner/Development state, with Stable/MVP kept separate:

```text
EDIT_SOURCE=PASS_PHYSICAL_DEVELOPMENT_USB
AFFECTED_TEST=PASS_REPOSITORY
WEB_PREVIEW=PASS_SOURCE_BROWSER_CANDIDATE
GIT_PUSH=PASS
CI_AFFECTED_ARTIFACT_BUILD=PASS_PARTIAL
DEVELOPMENT_DEVICE_GIT_HOT_UPDATE=PASS_PHYSICAL_DEVELOPMENT_USB
DEVELOPMENT_HEALTH_READINESS=PASS_PHYSICAL_DEVELOPMENT_USB
STABLE_DEVICE_RELEASE_OR_DELTA_UPDATE=PASS_SOURCE_PORTABLE_V4_LIFECYCLE_WITH_V3_FALLBACK_BASELINE_PENDING_COLD_HEALTH_AND_PHYSICAL
STABLE_HEALTH_READINESS=PASS_SOURCE_PORTABLE_COLD_HEALTH_MAIN_PENDING_PHYSICAL
FULL_IMAGE_REBUILD_REQUIRED_FOR_NORMAL_SYSTEM_CHANGES=NO
USB_REFLASH_REQUIRED_FOR_NORMAL_SYSTEM_CHANGES=NO
ROUTINE_REBOOT_REQUIRED_FOR_LIVE_SAFE_CHANGES=NO
SSH_REQUIRED=NO
REMOTE_CONTROL_REQUIRED=NO
CODEX_REQUIRED=NO
```

The target Owner/Development notebook has already completed the end-to-end `main -> Git update -> Surface reload -> visible change` round trip and later returned to the original UI through a second live-safe update. Guardian/supervisor health and valid-candidate preflight were also physically exercised. This closes the Git-first **development** loop; it does not make Git an acceptable Stable/MVP user update channel. Stable/MVP release/delta acquisition and its production health/rollback path remain separate pending gates.

## Gate 11 - User continuity Web -> USB -> native disk

```text
ACCOUNT_CONTINUITY=CONTRACT_DEFINED
SYNC_POLICY=CONTRACT_DEFINED
WEB_TO_USB_CONTINUITY=PENDING
DEVICE_SECRETS_STAY_LOCAL=PASS_BY_CONTRACT
NATIVE_DISK_INSTALL=PENDING
```

## Gate 12 - Recovery after failure

Agent/unit/disposable tests already prove multiple fail-closed release cases. The bounded Owner/Development rescue/guardian path is also physically proven, but canonical release recovery remains pending. Final canonical evidence includes:

```text
DEVELOPMENT_RESCUE_RECOVERY=PASS_PHYSICAL_DEVELOPMENT_USB
BOOTSTRAP_RECOVERY_WITHOUT_FIRST_RELEASE=PENDING_PHYSICAL
KNOWN_GOOD_PRESERVED=PASS_IN_AGENT_TESTS
OFFLINE_BOOT=PENDING_PHYSICAL
INTERRUPTED_UPDATE_SAFE=PASS_IN_AGENT_TESTS
RELEASE_INTEGRITY_FAIL_CLOSED=PASS
RELEASE_SIGNATURE_FAIL_CLOSED=PASS
```

The physically proven development rescue path is target-bound and deliberately bounded; it is not a generic remote shell and does not close Stable/MVP offline boot, first-release recovery or canonical rollback proof.

## Optional future remote-management gate

Only if Remote Core or another remote-management feature is later adopted as a supported product capability should it receive its own security, authorization and recovery gates. It is intentionally not part of the bootstrap or daily-development critical path.

## Promotion decision

Only after the applicable canonical Gates 0-12 pass may the repository be declared a successor candidate. Owner/Development `PASS_PHYSICAL_DEVELOPMENT_USB` evidence reduces bring-up uncertainty but never substitutes for canonical trust, Stable/MVP media, canonical update/recovery or public-write authorization. In particular, the existence of a tagged unbound native raw-disk backend does not authorize physical mutation. No physical write is permitted while canonical release trust, canonical-trust media proof, public apply reachability, physical artifact authorization or explicit destructive authorization remain open.