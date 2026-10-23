# OrdaX Creator and First Physical Installation

Status: CANONICAL FOR PROTOTYPE

The first physical OrdaX USB must not depend on Codex, WSL, QEMU, a Linux workstation, or a locally installed kernel toolchain.

## Product path

The permanent end-user path is:

```text
OrdaX Desktop
  -> Creator capability
     -> Creator Core
        -> thin Windows raw-device helper
           -> verified OrdaX USB
```

The first prototype may ship a small `ordax-creator.exe` before the complete OrdaX Desktop UI exists. That executable is not a second product: it is an early shell around the exact same Creator Core that the Desktop application will embed later.

## Why the Creator comes before the full Desktop

Waiting for the complete Desktop application would unnecessarily block physical boot validation. Building an unrelated temporary flasher would create duplication and security debt.

Therefore the sequence is:

```text
1. Creator Core
2. minimal Windows creator shell
3. resolve and verify all bootstrap artifacts
4. assemble one deterministic Creator payload
5. verify every payload byte against the canonical manifest
6. implement narrow Windows removable-device adapter
7. disposable-media proof
8. explicit destructive authorization
9. first physical USB
10. later embed the same Creator Core in OrdaX Desktop
```

No step requires Codex.

## Creator Core responsibilities

`tools/creator/core/` owns host-neutral policy:

- validate the canonical two-partition contract;
- reject `ORDAX-HOME` or any third required partition;
- verify that every physical artifact is resolved and SHA-256 pinned;
- interpret every `source_path` only relative to an assembled payload root;
- independently hash all local payload bytes before physical authorization;
- reject traversal, absolute paths, symlinks, target collisions and non-regular files;
- produce one deterministic write plan;
- enforce that physical writes remain blocked until the manifest authorizes them;
- define post-write verification and rollback/error semantics.

The Core does not own Windows disk APIs, UI, elevation, or arbitrary command execution.

## Creator payload

CI-produced artifacts are never referenced through temporary runner paths such as `/home/runner/...` or `out/...` outside the delivered bundle.

A Creator release assembles a deterministic payload directory. The exact final packaging format can later be a signed archive or resources embedded with the Desktop application, but after extraction/materialization the Core sees one root:

```text
creator-payload/
  boot/
    esp/
      systemd-bootx64.efi
      loader/...
  bootstrap/
    kernel/
      bzImage
    initramfs/
      initramfs.cpio.gz
    network/
      netbox
      bring-up
      udhcpc.script
    release/
      release-agent
    recovery/
      entrypoint
    entrypoint
```

The canonical media manifest maps those bundle-relative source paths to their target partition paths. The directory layout above is illustrative until every artifact group is resolved; no unresolved filename becomes canonical merely by appearing in this document.

The integrity order is mandatory:

```text
CI builds candidate
 -> CI verifies candidate provenance/hash
 -> payload assembler copies exact candidate bytes
 -> Creator Core hashes assembled payload again
 -> disposable layout proof
 -> explicit destructive authorization
 -> physical write
 -> independent post-write re-read/hash verification
```

A CI success alone is not permission to write a USB.

## Windows adapter responsibilities

The Windows adapter/helper will own only the unavoidable privileged operations:

- enumerate removable physical devices through Windows APIs;
- expose stable device identity, size and removable/system-disk classification;
- require explicit user selection;
- fail closed if target identity changes between plan and apply;
- create the GPT and exactly two partitions from the Core plan;
- format and write only the artifacts already authorized by the Core;
- re-read and verify the resulting layout and hashes;
- safely release/eject the target.

It must never decide a different layout or bypass the Core policy.

## Safety phases

The Creator has separate phases:

```text
CHECK
  read and validate contracts only

ASSEMBLE
  CI/release process materializes one deterministic payload root

VERIFY-PAYLOAD
  Core independently hashes every source artifact; no disk write

PLAN
  produce deterministic intended changes; requires explicit manifest authorization

APPLY
  privileged physical write; unavailable until every physical gate passes

VERIFY-MEDIA
  independently re-read partition table/filesystems/artifacts after write
```

The Creator Core implements verification and planning, and the narrow Windows physical-apply path exists behind explicit publisher, authorization, removable-target, UAC and readback gates. **A successful CI proof does not authorize a physical write**: the current physical-write contract still blocks it. The official public Creator must not expose an operational USB-writing promise until the signed release and real-hardware gates have passed. This section describes stage ownership, not permission to execute APPLY.

## Artifact delivery

The Creator never compiles the kernel on the user's Windows machine.

The product uses **three independently versioned delivery channels**: the Creator application, its inspection components, and the signed Portable physical release. Their existing implementations are `tools/creator/appchannel`, `tools/creator/componentchannel` and `tools/creator/physicalchannel`. The official Portable release acquires the exact 17 signed artifacts; it does **not** require a new whole-disk RAW download whenever OrdaX changes. The Owner/Development ZIP containing `ordax-bootstrap-seed.raw` is a separate offline development profile, not a second public Creator.

The authoritative consumer-media behavior is `docs/contracts/creator-consumer-flow.json` (`media_acquisition` and `physical_candidate_integrity`). The signed release—not an image name, local cache or Git branch—defines the target version, source, hashes and sizes. Before downloading, the existing version store may supply a regular file with matching size and hash. Mismatched-size files are rejected before hashing; reused files are rehashed during copying, and the final candidate is independently checked. Missing or corrupted bytes are downloaded from the signed URL. If offline, only a previously signed, reverified candidate can be used; no fallback can bypass physical-write authorization. The final online/offline candidate check reuses `creatorcore.VerifyPortableSources` to require exactly the signed 17 flat regular artifact files (no extra entries or symbolic links); it does not duplicate Core's source verification or authorize a physical write. The Windows Creator now also runs that same Core verification immediately before its physical preparation/elevation request, so a mutated cached source or unexpected extra file fails without UAC. Its `prepare-portable` response must also preserve the original disk capacity, serial, disk number and confirmation token and return a lowercase 64-hex authorization value before UAC. This is only a GUI consistency check: the privileged backend still recomputes the authorization token from the live USB and exact application plan. The privileged backend still independently verifies and locks source bytes at APPLY; GUI preflight is not physical-write authorization.

No user image/ISO selector, duplicate artifact catalog, mutable global cache or extra installer is allowed.

Before the Windows Creator invokes the physical backend for preparation, and again immediately before UAC, it revalidates the exact previously verified and in-memory signed candidate using `physicalchannel.ReleaseSequence`: all eight signed writer file hashes, 17 Portable source hashes, manifest identities and signed provenance must still match. The privilege boundary cannot rely only on a backend path that was accepted during an earlier UI refresh. The same check does not independently grant physical authority, and the elevated backend must still reopen and reverify the live target and source files.

The v3 signed physical candidate is accepted only when its embedded physical authorization has the authorized state and matches provenance on the exact authorization file digest, release sequence, canonical trust/contract digests and canonical v4 release proof/source/envelope. Signed-but-inconsistent hash strings now fail during cache validation. This merely validates the publisher's already signed authorization; it never creates or grants local owner consent.

The signed physical candidate cache accepts only its eight manifest-bound writer files (plus the existing Portable v3 receipt and source directory). It rejects unexpected root entries or symlinked roots, and rejects size-mismatched writer files before hashing. This is verification only; it cannot authorize physical writes.

The signed Portable payload's release commit controls every artifact download URL: exactly one filename in the official GitHub release tag `ordax-stable-v4-<release_source_commit>` is accepted. Both Go validators and the existing Windows signing preflight reject cross-version and ambiguous asset paths; SHA-256 and size are independently verified, and no private signing key or secondary catalog is introduced.

The signed Portable v3 physical-candidate consumer also checks producer provenance against its 17-artifact release source, proof SHA-256 and canonical HTTPS envelope while keeping the writer commit independent. No second release index or activation authority is introduced.

All three Creator delivery channels now use the shared `tools/creator/internal/atomicfile` writer for their signed current/pending/previous envelope pointers. A failed pointer replacement preserves the previous signed offline pointer; version monotonicity, source re-verification and physical write authorization remain independent.


```text
Git main
  -> GitHub CI
     -> kernel candidate/release
     -> initramfs candidate/release
     -> ESP bootloader candidate/release
     -> network bootstrap candidate/release
     -> release acquisition candidate/release
     -> deterministic Creator payload
     -> signed/pinned media manifest
        -> OrdaX Creator verifies local bytes again
           -> physical USB
```

The user's machine needs only the signed Creator application, its verified payload and normal administrator authorization for the narrow raw-device step.

## Native installation foundation — integrated MVP target, release currently disabled

The currently authorized public-candidate Creator prepares **removable OrdaX USB media only**. The integrated MVP implementation scope includes finishing Native disk installation via the same Creator Core. The current public build does **not yet** install to SSD/NVMe/HDD, and dual boot, resize and partition editing are not part of the first Native mode.

The same Creator Core already contains non-destructive Native planning and supporting architecture:

```text
PlanNativeDiskTargetStorage
 -> PlanNativeInstallation
 -> target identity/revalidation
 -> Native storage / boot proofs
```

Those foundations must be completed and homologated **within the integrated MVP development cycle**, not reimplemented as a second installer. The current Stable release keeps Native disabled, and internal-disk APPLY remains forbidden until explicit target authorization and physical end-to-end proof.

When Native is promoted through the MVP-cycle gates, it must continue through the same Creator Core, signed release trust, exact-target identity, destructive authorization and hardware-validation gates documented in `docs/NATIVE-INSTALLATION.md` and `docs/contracts/native-installation.json`.


## Transition into the full Desktop product

When OrdaX Desktop is ready, its button such as `Create OrdaX USB` invokes the same Core. The standalone prototype shell can then disappear without changing provisioning policy or media format.

```text
prototype ordax-creator.exe
           \
            -> same Creator Core -> same Windows helper -> same media contract
           /
OrdaX Desktop Creator UI
```

No parallel flasher implementation is allowed.


## Independent Creator repository extraction handoff

> **Transition record (2026-10-23); NOT a new contract, release authority, or permission for physical writes.**
> This is the Creator topic's existing canonical OS documentation, reused as a migration handoff while the separate repository is inaccessible. Once the cutover is verified, execution details must live in \`ordaxsystems/ordax-creator\` and this OS document must become a concise consumer/integration reference. Exact behavior is always governed by the present OS contracts and source, not this dated snapshot.

### Authority and snapshot

- Intended executable owner: \`ordaxsystems/ordax-creator\` (standalone Windows application and reusable Creator Core, not a separate image or release generator).
- OS owner remains \`ordaxsystems/ordax-os\`: Base, kernel, bootstrap, official release artifacts, public trust, boot/storage contracts, signing/release producer and physical promotion authority.
- Examined OS baseline: \`main@f65acc4fb9f8ded376fc9b44b4c7c2068c793265\`. This SHA is provenance, **not** an instruction to pin future development to old source.
- On 2026-10-23 the connected GitHub installation returned 404 for \`ordaxsystems/ordax-creator\` and installation-scoped discovery yielded no match. **Do not claim its main, permissions, CI, or remotes have been verified or modified.** Before extraction, confirm repository creation/installation visibility, write permission, exact \`main\` head, protection and remotes.
- Existing source root: \`tools/creator/\`, module \`github.com/ordaxsystems/ordax-os/tools/creator\`, Go 1.27; product \`tools/creator/version.json\` = \`0.6.2-dev\` at this baseline.
- Preserve open \`ordax-os#2000\` (\`fix/creator-bind-17-sources-through-core-ssot\`, inspected head \`a8c11fb636e2c652aa2c0c24f4fa8ad5ae349deb\`): it removes a second inventory/hasher from \`.github/workflows/first-physical-usb-payload.yml\` by consuming \`BindPortableSources\` / \`VerifyPortableSources\`. Do not delete or duplicate that work. Recheck branch head, current \`main\`, six changed paths and status before integration.
- On the examined #2000 head, 12 of 13 workflows succeeded; \`First Physical USB Payload\` failed at the existing **Stable Base** build because the Alpine \`ca-certificates=20260909-r0\` pin conflicted with the available \`20261020-r0\`. The new Creator Core source-binding test itself passed. This is an upstream Base/package-reproducibility issue: do **not** patch OS Base or bypass the pin from this Creator extraction; require upstream owner reconciliation and a fresh exact-head run.
- Concurrent Surface work may modify OS \`main\` and its contracts. Creator-scoped OS changes go into separate PRs; never merge against a stale OS head or alter Foundation, Surface, kernel or Buildroot from Creator scope.

### Extraction checklist and gates

1. **Repository access (BLOCKED until repository visible).** Verify target \`main\`, permissions and remotes; record baseline commit SHAs. Establish \`AGENTS.md\`, CODEOWNERS, branch protection/review policy, restricted workflow permissions, dependency/update policy, docs/ownership and security guidance *inside the new repository*. Do not initialize it with a second OS contract authority.
2. **Inventory and origin (AUDITED IN PART; not migrated).** Audit \`tools/creator/{core,cmd,host,appchannel,componentchannel,physicalchannel,internal,proof,windows,platform,update}\` and root helpers, all Creator Python/Go tests, and all producer/consumer workflows before moving files. Classify individual paths as \`MOVE_CREATOR\`, \`RETAIN_OS_PRODUCER\`, \`SHARED_BY_VERIFIED_CONTRACT\` or \`HISTORICAL_ONLY\`. Keep OS physical publisher/authorizer/builders and kernel/Base/boot/release producers in the OS; do not blindly move every Python helper merely because it resides under \`tools/creator/\`.
3. **Preserve Git lineage (PENDING).** Capture old source SHAs and directory lineage. Export only the chosen Creator-owned path history with an audited \`git subtree split --prefix=tools/creator <reconciled-os-commit>\`, or an equivalent history-preserving Git procedure; import as Git commits in the new repository **without force-rewriting its main**. Record old OS commit, split commit, imported commit and path-map in the Creator migration ledger. A file copy without traceable origin is not an accepted cutover. Never export private keys, secrets, test media or signed publisher custody.
4. **Contract consumption (PENDING).** Use exact-commit, digest-checked CI acquisition of *read-only* contracts/artifacts from \`ordax-os\`; verify JSON schema identity, SHA-256/size, source commit, public trust and signed release envelope. Build inputs may be staged as verified temporary files but must not be committed as competing canonical JSON. A lock/reference is a pointer to OS authority, not a second manifest or a floating \`main\` download. The contracts \`docs/contracts/{physical-media,physical-prepared-media,portable-usb-v2,creator-portable-media-plan,creator-consumer-flow,creator-app-channel,creator-component-channel,creator-code-signing,physical-write-authorization}.json\` and \`bootstrap/trust/release-ed25519.json\` remain OS-owned until an explicit reviewed ownership decision.
5. **Repoint Go without duplicate implementations (PENDING).** Set the new Go module to \`github.com/ordaxsystems/ordax-creator\`, rewrite imports and relative data access in one reviewed change. Retain **one** Core implementation for exactly 17 Portable sources, 39 operation plan, signed candidate verification, three current delivery concerns, and one atomic signed-pointer writer. Split producer scripts by their real owner. Remove temporary compatibility bridges once consumers are verified.
6. **Windows distribution (PENDING).** Build the existing Win32 GUI and the narrowly privileged helper independently using pinned Go/Actions versions, \`-trimpath\`, immutable dependencies, SHA-256/provenance and reproducibility comparisons. Check localization \`pt-BR\`/\`en-US\`, update/rollback and last-signed-known-good. Keep Authenticode certificate custody, RFC3161 timestamps and Ed25519 signed channel gates separate. Current \`docs/contracts/creator-code-signing.json\` has \`publish_allowed=false\`; no public signed release is claimed merely because a candidate ZIP/EXE builds.
7. **Security regressions (PENDING).** Run Go tests, non-Windows stubs, cross-compiled Windows packages, Python disposable-media tests, signed-envelope negative cases, symlink/TOCTOU checks, hash/size mismatches, corrupted offline cache, re-enumeration and identity/capacity changes, internal-disk exclusion, denied UAC, canceled write, partial-write/readback failure and rollback. Exercise only synthetic devices, regular disposable RAW files or QEMU; CI must not enumerate/write real USB/disk targets.
8. **OS consumer repoint (PENDING; OS-only PR).** Once the new Creator is independently green, replace OS's embedded build dependency with a verified immutable Creator revision/artifact reference; update existing contracts, \`docs/README.md\`, \`docs/CURRENT-STATE.md\`, ownership and release/workflow entrypoints in a **Creator-scoped** OS PR. Coordinate its merge with the Surface agent and source/head reconciliation. Keep OS as producer of signed OS releases and trust/physical promotion; Creator remains a verification consumer.
9. **Cutover/removal (PENDING).** Require independent Creator CI, repeat-build hashes, Windows package/provenance, negative security cases, OS-to-Creator consumer integration, reference grep/CI proof and a known-good standalone invocation before removing \`tools/creator/\` or legacy workflows. Preserve OS contract/producer paths and Git provenance. Removal is **not** permission for any physical operation or publication.

### Independently testable acceptance

- An isolated checkout of \`ordax-creator\` builds its Core, Windows GUI and non-destructive CLI without a full OS source checkout, WSL, QEMU or a developer-installed toolchain; CI fetches only pin-verified, immutable OS producer inputs.
- \`go test -count=1 ./...\` and platform-specific compile/test jobs pass in the target module; signed-channel and USB-selection gates fail closed on malformed/stale/replaced inputs.
- Windows bundles carry provenance, hashes, bounded dependencies and explicit signed/release status. Build repeatability is checked **before** non-reproducible signing/timestamp ceremony; unsigned candidate is never presented as an official physical release.
- The OS and Creator agree on exact release source commit, trust, 17 named artifacts and 39 operation plan without copying canonical inventories, media layouts, updater policies, signing logic or destructive authorization.
- \`ordax-os\` invokes only the verified Creator consumer. Its own Base/boot/release producer and promotion gates remain functional; no duplicate active Creator implementation or OS build job remains.

**Current overall status: PREPARATION ONLY.** No target-repository commit, Creator extraction, Windows standalone test, cross-repository integration, merge, public release or physical write is evidenced by this entry. Continue from the actual Git heads and immutable receipts; never promote this checklist to a proof result.
