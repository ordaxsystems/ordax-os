# OrdaX Creator

`tools/creator/` is the single source root for OrdaX physical-media creation.

The permanent end-user experience belongs inside OrdaX Desktop, but the prototype may publish a small `ordax-creator.exe` shell before the complete Desktop UI exists. Both must use the same Creator Core; a second flasher policy implementation is forbidden.

Goal: prepare verified **USB media for the public MVP** without requiring Codex, WSL, QEMU or a kernel toolchain on the user's machine. Native SSD/NVMe/HDD work is retained as a post-MVP foundation and is not a public MVP capability.

```text
tools/creator/
  core/                 # host-neutral policy, payload verification and write planning
  proof/                # non-destructive disposable GPT/filesystem proof
  cmd/
    ordax-creator/      # thin prototype CLI/shell around the same Core
  platform/
    windows/            # future thin raw-disk/elevation adapter
    linux/              # optional later adapter
    macos/              # optional later adapter
```

The shared Core owns:

- artifact selection;
- canonical two-partition validation;
- signature/hash policy boundaries;
- Creator payload integrity verification;
- transactional disposable filesystem-tree staging;
- write-plan generation;
- fail-closed physical-write authorization;
- post-write verification contract;
- recovery/retry semantics.

Platform adapters own only unavoidable host API integration. They may not define another OrdaX layout or security policy.

## Creator payload boundary

`source_path` in `docs/contracts/minimal-bootstrap.json` means a slash-separated path **relative to the assembled Creator payload root**, never an arbitrary developer/runner path.

Before any future physical `apply`, the Core must independently verify every local source artifact against the SHA-256 pinned in the manifest.

The Core rejects:

- absolute source paths;
- `..` traversal;
- backslash/path ambiguity;
- symlink traversal in the payload;
- non-regular artifact files;
- malformed hashes or modes;
- duplicate target paths on the same partition;
- missing or byte-modified artifacts.

Payload verification remains independent from destructive authorization. Verified bytes do not imply permission to write a disk.

## Transactional `stage-tree`

`stage-tree` is a non-destructive Creator Core operation. It preflights the complete manifest/payload, builds a sibling temporary tree, fsyncs and re-hashes copied files, creates the logical runtime roots, and publishes the output only after all checks pass.

Published shape:

```text
ORDAX-ESP/
ORDAX/
```

Main-partition targets are required to live below `/ordax/...` and map below the `ORDAX/` mirror. `releases/`, `state/` and `home/` are created under that mirror.

On any copy-time or validation failure, no partial payload is published at the requested output path and temporary staging is removed.

## Disposable GPT/filesystem proof

The source tree now also contains `tools/creator/proof/disposable_media.py`, which consumes a fully staged Creator tree and creates a **regular disposable RAW file only**. It proves the geometry in `docs/contracts/physical-media.json`:

```text
GPT
├── ORDAX-ESP  FAT32  256 MiB
└── ORDAX      ext4   fill remaining usable space
```

The proof verifies:

- valid GPT;
- exactly two partitions;
- expected start LBAs/type GUIDs;
- FAT32/ext4 filesystem types and labels;
- staged file SHA-256 after extraction from each filesystem;
- required ext4 directories;
- partition-image bytes after embedding into the RAW file;
- `physical_write_authorized=false` throughout.

`.github/workflows/creator-disposable-media.yml` routes its input through the Creator Core `stage-tree` first, then runs the GPT/filesystem proof. CI publishes only `proof.json`; the RAW is ephemeral and deleted.

## MVP durable USB migration boundary

The existing three-partition prepared-media path (`ORDAX-ESP + ORDAX + ORDAX-DATA`) is retained only as an Owner/Development hardware-validation bridge. Its contract is `docs/contracts/physical-prepared-media.json`, and it must not be promoted as the Stable/MVP final layout.

The public MVP target is `docs/contracts/portable-usb-v2.json`:

```text
ORDAX-ESP   FAT32
ORDAX-DATA  exFAT
  .ordax/base/stable-base.erofs
  .ordax/releases/<commit>/system.erofs
  .ordax/state/persistent-state.img
```

The Creator Core already owns the v2 geometry through `PlanPortableTargetStorage` and the final 39-operation application plan. Physical v2 apply remains disabled until the disposable Portable media/runtime-v4 QEMU+UEFI proof, canonical trust, fresh Stable/MVP owner authorization for the 17-artifact v4 payload and physical USB gates close in order.

## Release bootstrap inputs

The release-channel pointer is now canonical and hash-bound in the minimal-bootstrap manifest:

```text
/ordax/bootstrap/config/release-envelope-url
 -> https://github.com/washingtonmsdj/prototipo-ordax-os/releases/latest/download/release-envelope.json
```

This URL is only a delivery selector. Authenticity depends on the canonical Ed25519 public trust anchor now pinned and hash-bound in the minimal bootstrap:

```text
/ordax/bootstrap/trust/release-ed25519.json
```

No private signing key belongs in Git, Creator payloads or downloadable installers.

## Current implementation state

The Windows Creator now has a native graphical shell. Normal users select an eligible USB in the window and never need Prompt, PowerShell or a `.cmd` file. The destructive path remains fail-closed until a publisher-bound physical candidate is available.

### Creator localization owner

Creator owns its localization boundary independently from the OrdaX Surface. It does not import the Surface i18n runtime and user-facing copy must not be embedded directly in Win32 presentation/state files. The current public baseline bundles `pt-BR` and `en-US`; `pt-BR` is the source/final fallback locale.

On Windows, Creator starts from the user's Windows locale when supported and persists an explicit locale choice under the current user's Creator preferences. Unsupported locale identifiers fall back deterministically to `pt-BR`. Message-key and interpolation-placeholder parity between bundled locales is enforced by Creator tests, and user-facing UI call sites are audited so new literal copy cannot bypass the localization owner. Internal technical diagnostics may remain canonical, but raw backend errors are not used as translated UI copy.

This owner is compatible with the component-scoped language-pack architecture in `docs/contracts/localization-pack.json`: future Creator locales can be added deliberately without making every Surface app support the same locale at the same time. The MVP Creator itself exposes only `pt-BR` and `en-US` today.

Creator distribution and update UX follow the actual Owner/Development artifact: `OrdaX-Creator-Owner-Prototype.zip` contains the GUI plus the separate privileged RAW helper and required payload. The published `prototype-ordax.creator-owner-bundle-update/1` manifest currently declares `automatic_in_app_update=false`; Creator may detect a newer bundle but must not apply the legacy single-EXE updater to that multi-file bundle.

```text
CREATOR_NATIVE_WINDOWS_GUI=IMPLEMENTED
USB_TARGET_DISCOVERY=IMPLEMENTED
SYSTEM_DISK_EXCLUSION=IMPLEMENTED
TARGET_REENUMERATION=IMPLEMENTED
DESTRUCTIVE_CONFIRMATION_UI=IMPLEMENTED
WINDOWS_UAC_HANDOFF=IMPLEMENTED
RAW_DISK_BACKEND=IMPLEMENTED_BUILD_TAGGED
PORTABLE_APPLICATION_PLAN=IMPLEMENTED_39_OPERATIONS
PHYSICAL_APPLY_FLOW=IMPLEMENTED_GATED
POST_WRITE_READBACK=IMPLEMENTED_GATED
PHYSICAL_SIGNED_CHANNEL=IMPLEMENTED
OFFLINE_LAST_KNOWN_GOOD_PHYSICAL_BACKEND=IMPLEMENTED
CREATOR_DEV_CHANNEL=READ_ONLY
EXPLICIT_OWNER_AUTHORIZATION_STABLE_MVP=YES_SOURCE_CONTRACT
CANONICAL_RELEASE_TRUST=PASS_CANONICAL_PUBLIC_ANCHOR_PINNED
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=YES
PHYSICAL_AUTHORIZATION_ELIGIBLE=YES
AUTHORIZED_PHYSICAL_CANDIDATE=PENDING_CANONICAL_MEDIA_PROOF
PHYSICAL_USB_WRITE=BLOCKED_UNTIL_REMAINING_GATES_AND_TARGET_CONFIRMATION
NATIVE_INSTALL_GEOMETRY_PLAN=IMPLEMENTED
NATIVE_INSTALL_PLAN=IMPLEMENTED_NON_DESTRUCTIVE
NATIVE_INSTALL_TARGET_IDENTITY_BINDING=IMPLEMENTED_CORE
NATIVE_INSTALL_TARGET_ADAPTER_DISCOVERY=IMPLEMENTED_READ_ONLY
NATIVE_INSTALL_SOURCE_BOOT_MOUNT_DISCOVERY=IMPLEMENTED
NATIVE_INSTALL_PRODUCT_MODE_IDENTITY=IMPLEMENTED
NATIVE_INSTALL_READ_ONLY_BROKER=IMPLEMENTED
NATIVE_INSTALL_SURFACE_DISCOVERY_PORT=IMPLEMENTED
NATIVE_INSTALL_PHYSICAL_APPLY=PENDING
NATIVE_INSTALL_FIRST_BOOT_HEALTH=PENDING
MVP_NATIVE_INSTALL_CAPABILITY=DISABLED
MVP_INTERNAL_DISK_WRITE=FORBIDDEN
NATIVE_INSTALL_FOUNDATION_PHASE=POST_MVP
```

The development `OrdaX-Creator.exe` is intentionally useful for the graphical workflow, signed bundle update discovery and safe USB discovery. The current split-bundle channel does not perform automatic in-app installation; bundle replacement remains explicit until a complete multi-file staging/rollback updater exists. The ordinary GUI also cannot acquire a raw writer by itself: canonical public trust is resolved, while explicit Stable/MVP owner authorization and the public physical-apply boundary remain closed. This separation prevents an ordinary development build from becoming destructive by accident.

The final Portable physical flow is implemented behind the isolated tagged/publisher boundary, but it is not yet a public Creator capability:

```text
canonical public trust
 -> exact Portable policy bindings
 -> canonical v4 signed/materialized aggregate proof
 -> bind exact public proof SHA/source/HTTPS release identity
 -> fresh Stable/MVP owner authorization contract
 -> signed physical channel
 -> select and revalidate exact USB target
 -> target-specific destructive confirmation
 -> Windows UAC elevation
 -> write exact two-partition GPT
 -> format ORDAX-ESP FAT32 + ORDAX-DATA exFAT
 -> materialize 17 exact artifacts, including Local AI runtime + release reference
 -> flush + per-artifact SHA-256/size readback
 -> verify final geometry, labels and capacity
 -> success / fail-closed result
```

The v4 physical plan adds `local-ai-runtime-image` and `local-ai-runtime-ref` to the previous 15-artifact shape; the previous authorization context is intentionally not reusable. There is no target-sized whole-disk RAW image in this final path. Canonical publisher trust is now pinned, but owner consent is deliberately **not reachable** until the operator-controlled canonical v4 signing/materialization flow has produced its aggregate public receipt.

The target-specific Portable media/application plan must use the **canonical release source commit** bound by `physical-write-authorization.json -> release_binding.source_commit`. The physical writer binary records its own build/Git commit separately as writer provenance and must never substitute that writer SHA for the release SHA. `prepare-portable` and `apply-portable` fail closed unless the plan source commit matches the embedded canonical release source commit, and the v4 path requires exactly 17 artifact sources.

Bind that receipt non-destructively first:

```text
python tools/creator/bind_canonical_v4_release_proof.py <canonical-v4-release-proof.json>
```

This validates the pinned trust, exact source/release identities and safe physical flags, stores only
the public receipt under `docs/evidence/`, and advances the contract only to owner-consent pending.
It never selects/touches media, invokes the writer or authorizes a write. The old first-USB
development consent is not reusable.

Read-only aggregate Stable/MVP USB readiness:

```text
python tools/creator/stable_mvp_usb_readiness.py
```

This composes the Nova OrdaX source audit with the physical-promotion preflight and reports one explicit stage such as `canonical-v4-release-proof-pending`, `explicit-owner-authorization-pending` or `authorized-candidate-ready-for-separate-physical-flow`. It never reads private signing-key contents, selects media, records consent, invokes the writer or claims physical proof.

Read-only authorization preflight:

```text
python tools/creator/authorize_physical_write.py check
```

The future authorization mode changes only the source-controlled authorization contract; it does not touch a physical device or invoke the writer. It requires the exact scope, release sequence and confirmation phrase:

```text
python tools/creator/authorize_physical_write.py authorize \
  --confirm-scope first-real-stable-mvp-usb-proof \
  --confirm-release-sequence <current-sequence> \
  --authorize AUTHORIZE_FIRST_REAL_STABLE_MVP_USB_PROOF
```

Do not run `authorize` until the repository owner has explicitly chosen to authorize that exact Stable/MVP physical proof. Candidate materialization and the later target-specific destructive confirmation remain separate gates.

Examples for non-destructive engineering verification:

```text
ordax-creator verify-payload \
  --manifest docs/contracts/minimal-bootstrap.json \
  --payload-root <assembled-payload-directory>

ordax-creator stage-tree \
  --manifest docs/contracts/minimal-bootstrap.json \
  --payload-root <assembled-payload-directory> \
  --output-root <disposable-directory>
```

See `docs/CREATOR-INSTALLATION.md`, `docs/PHYSICAL-MEDIA.md`, `docs/RELEASE-TRUST-CEREMONY.md` and `docs/PROMOTION-GATES.md`.

## Native installation foundation — post-MVP

The durable Native target geometry, target-identity binding, boot assets and non-destructive planners remain implemented and covered by engineering proofs.

`ordax-creator plan-native` and related Native commands belong to the **engineering CLI/proof surface**, not to the public Stable/MVP Creator experience. The official MVP Creator UI prepares removable OrdaX USB media only and must not advertise or authorize internal-disk installation.

Native code remains in the same Creator Core so a later product promotion can activate it deliberately without creating a second installer or divergent storage policy.

