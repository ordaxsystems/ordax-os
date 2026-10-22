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

## Unsigned review bundle versus signed Portable v3 distribution

`Physical Write Promotion` can preflight and build a Windows writer review input, but currently packages only `prototype-ordax.creator-physical-manifest/2` without the signed v3 release envelope. That bundle must never be installed as a physical-media-ready Stable release. The public Creator's existing v3 verifier requires 17 canonical source files, each with a release-commit-bound URL, SHA-256 and size, plus valid purpose-bound Ed25519 provenance. The workflow explicitly reports `PORTABLE_V3_17_SOURCE_RELEASE_READY=NO`, `PORTABLE_V3_SIGNED_WRITER_PUBLISHED=NO` and `PHYSICAL_USB_WRITE_READY=NO` while it emits v2; these indicators describe publication readiness, not consent or completed hardware proof.

Source-scoped owner consent is governed **only** by `docs/contracts/physical-write-authorization.json` and `physical_promotion.py`. Historical permission cannot survive changes to the protected context; renew authorization through the official owner ceremony once the v3 publisher inputs are final. The publisher signs with its legitimately held offline key, verifies exact asset readback, and never ships the private key. Live removable-target re-enumeration, destructive confirmation, UAC, physical 17/17 readback and boot/recovery evidence remain separate mandatory gates.

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

The complete 17-artifact media plan also enforces per-partition aggregate capacity **before** the destructive writer is reached: ESP reserves 32 MiB, and ORDAX-DATA reserves the greater of 128 MiB and 2% of its physical extent for FAT32/exFAT metadata, cluster rounding and free-space headroom. The same Core rule is checked when accepting a parsed media plan and again at the application executor boundary. This deterministic conservative preflight rejects impossible payloads; it does **not** replace disposable actual-filesystem verification, live USB revalidation, UAC or the required 17/17 physical readback.

## Release bootstrap inputs

The release-channel pointer is now canonical and hash-bound in the minimal-bootstrap manifest:

```text
/ordax/bootstrap/config/release-envelope-url
 -> https://github.com/ordaxsystems/ordax-os/releases/latest/download/release-envelope.json
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
EXPLICIT_OWNER_AUTHORIZATION_STABLE_MVP=SEE_CANONICAL_CONTRACT
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

The official Creator has three independently signed/versioned concerns: the Creator app itself (`appchannel`), read-only inspection components (`componentchannel`), and the physical Portable release (`physicalchannel`). The **Owner/Development** ZIP deliberately includes an offline RAW bootstrap seed; it is not the Stable/MVP image-acquisition model. The official Portable channel acquires 17 signed, SHA-256/size-bound artifacts rather than a target-sized full-disk RAW image. For a new signed candidate, `physicalchannel` may reuse unchanged artifacts already present in an existing version slot **only after checking the expected signed size first and independently verifying SHA-256**; corrupt, oversized or unsafe donor files are ignored and must be acquired again from the canonical release. The final candidate is reverified before atomic publication. The signed physical writer slot also rejects unbound root entries and non-real root directories. Before SHA-256 streaming, each of its eight signed critical files must have the exact bound size; an oversized cached donor is not hashed. The signed physical candidate's source-directory verification now delegates to the existing Creator Core `VerifyPortableSources` gate for **exactly 17 flat regular files**; a cached candidate containing extra files, directories or links is not considered a valid offline source even if every signed artifact hash still matches. This optimization never changes the signed source, never activates an unverified release and never authorizes writes. `docs/contracts/creator-consumer-flow.json#media_acquisition` owns this consumer policy; neither a second cache index nor a second release manifest is permitted.

Each Portable artifact URL is required to point to a single canonical HTTPS release asset under the **exact** `ordax-stable-v4-<release_source_commit>` tag in the already signed v3 payload. The consumer and offline signer both reject other OrdaX versions, similar-looking tags, nested paths and encoded separators; the Windows signing preflight checks the same boundary before private-key use. Bytes remain SHA-256/size pinned, without introducing a release catalog or image selector.

The Portable v3 cached/online consumer also verifies the **signed, embedded** `physical-write-authorization.json` against `provenance.json`: exact SHA-256 of the authorization bytes, explicit approved state, sequence/context, public-trust and contract hashes, and canonical Stable v4 proof/source/envelope. This reuses the existing eight manifest-bound files and publisher contract; well-formed but mismatched SHA-256 fields cannot authorize a candidate. Legacy v2 compatibility is unchanged.

Portable physical candidate provenance now consumes the exact four additional fields produced by the canonical physical-promotion workflow. A v3 candidate binds its writer commit separately from the canonical Stable v4 release commit, exact release proof hash and canonical HTTPS envelope; a missing/mismatched field blocks use of the signed cached candidate. No permission to write USB is implied.

All signed current/pending/previous Creator channel pointers share `tools/creator/internal/atomicfile`: stage beside the destination, sync, then replace without unlinking the previous signed pointer first. If the pointer commit fails, the last signed offline reference stays intact, subject to each channel's signature, sequence and byte-verification rules. This is not a second trust authority, cache or update channel.

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

## Existing USB inspection — read-only first slice

The Creator now has an explicitly **read-only** installed-media inspection
entrypoint in the existing Windows targets CLI:

```powershell
ordax-creator-targets.exe
ordax-creator-targets.exe --confirm <fresh USB confirmation token> --inspect
```

The second command re-enumerates the removable USB, checks the existing
confirmed PhysicalDrive identity and target-volume isolation, then reads the
GPT through a `GENERIC_READ` handle. The Creator Core verifies protective MBR,
both GPT header and entry-array CRCs, primary/backup agreement, physical
capacity and non-overlapping partition ranges. It recognizes only **candidate
layouts** (`owner-development-candidate`, `owner-seed-candidate`,
`portable-stable-candidate`) and reports unknown but valid GPTs as
`unrecognized`. Damaged GPTs fail closed.

The `verification=gpt-primary-backup-crc-and-geometry-only` field is deliberate:
GPT labels cannot prove OrdaX installation authenticity, filesystem health,
bootability, installed version, update eligibility or repair safety. This
command **never mounts, repairs, downloads, elevates or writes**, and
`physical_write=false` is a fixed contract. It does not alter or bypass the
separate signed physical release and target-specific destructive gates.

Next maintenance slices should use the same confirmed-target and Core policy
boundary: read-only ESP/bootstrap inspection, safe detection of offline
transaction receipts and update status, then a separately authorized backup
and recovery runtime with independent ext4 validation. Owner/Development Git
updates must keep using the canonical `ordax-pull` owner; Stable/MVP updates
must use signed release material. Neither may add a parallel updater or
infer "repairable" from GPT labels.

## Native installation foundation — post-MVP

The durable Native target geometry, target-identity binding, boot assets and non-destructive planners remain implemented and covered by engineering proofs.

`ordax-creator plan-native` and related Native commands belong to the **engineering CLI/proof surface**, not to the public Stable/MVP Creator experience. The official MVP Creator UI prepares removable OrdaX USB media only and must not advertise or authorize internal-disk installation.

Native code remains in the same Creator Core so a later product promotion can activate it deliberately without creating a second installer or divergent storage policy.



## Creator Windows — camada visual unificada (11/10/2026)

O layout Windows passou a desenhar somente conteúdo **não interativo** no
`WM_PAINT` da janela: título, descrição, status, progresso, versão e trilha.
Os textos pertencem a um único modelo de apresentação atualizado pela própria
thread UI. Não criar `STATIC` ou `msctls_progress32` sobre os cards: a mistura
de controle nativo (fundo do Windows) com GDI customizado causava campos brancos,
texto sem contraste e conteúdo sobreposto na máquina física.

O desenho ocorre em bitmap/DC compatível, transferido em uma operação
`BitBlt`; `InvalidateRect` não apaga o fundo na tela. Ações continuam usando
`BUTTON` owner-drawn, e os dois `COMBOBOX` recebem `CBS_OWNERDRAWFIXED`
com item mensurado, fonte e cores do tema exportado do SSOT da Surface.
A autoridade de confirmação do destino e do backend elevado permanece
independente do render visual; nenhum estado visual autoriza gravação USB.

CI: `python -m unittest tests.test_creator_single_paint -v` e
`Creator UX Baseline`, que também faz cross-build Go Windows. Aprovação do
CI prova as âncoras e compilação; legibilidade real em várias escalas DPI
exige captura física da nova build antes de classificar UX como homologada.

