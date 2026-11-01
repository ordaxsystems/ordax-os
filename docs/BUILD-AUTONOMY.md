# Build Autonomy

Status: CANONICAL FOR PROTOTYPE

## Goal

The OrdaX prototype must be buildable, testable and publishable from repository source without requiring Codex, WSL, QEMU, a developer workstation toolchain, or manual one-off build knowledge.

Codex may assist as an optional engineering partner. It is never a build owner, source authority, release authority, or prerequisite for producing OrdaX artifacts.

## Core contract

```text
CODEX_REQUIRED=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
REPOSITORY_RECIPE_REQUIRED=YES
REPRODUCIBLE_CI_BUILD_REQUIRED=YES
ARTIFACT_PROVENANCE_REQUIRED=YES
ARTIFACT_SHA256_REQUIRED=YES
```

`main` owns the source and build recipes. CI is an execution environment, not a second source authority.

## Build chain

Target flow:

```text
source commit
 -> repository build recipe
 -> pinned build environment
 -> dependency/source hash verification
 -> build affected artifact
 -> tests/verification
 -> provenance manifest
 -> SHA-256
 -> immutable CI artifact/release candidate
```

A person or AI must not need to remember undocumented commands to reproduce an artifact.

## Kernel

The kernel is not a special manual exception.

The repository must contain or identify:

- exact kernel version;
- official source location/identity;
- expected source archive SHA-256;
- canonical OrdaX kernel config;
- canonical patch set, if any;
- pinned compiler/toolchain environment;
- deterministic build entrypoint;
- expected output names;
- module/firmware packaging rules;
- tests and boot evidence;
- generated provenance manifest.

The developer host does not compile the kernel as a prerequisite. A repository CI runner executes the canonical recipe in a pinned environment.

The active release identity and upstream archive hash are read exclusively from
`bootstrap/kernel/source.json`. The build-autonomy contract references that
source instead of copying its version or checksum. Historical build observations
remain immutable evidence, not another active version authority.

## Pinned build environment

Build tooling must be represented declaratively and pinned strongly enough to avoid "works only on that machine" behavior.

Preferred model:

```text
repository source
 + pinned OCI/container build environment by immutable digest
 + pinned upstream source checksums
 + versioned build scripts/config
```

GitHub Actions is the current automation executor because this repository is hosted on GitHub. The architecture must not depend on GitHub Actions-specific behavior: the same build entrypoint should be runnable by another standards-compatible CI/container executor later.

Linux-based CI may be used to compile the Linux kernel. This is an implementation environment, not a requirement that the OrdaX developer own or configure a Linux/WSL workstation.

## Artifact graph

The build graph is dependency-driven rather than one monolithic pipeline. Canonical classes are:

```text
kernel
initramfs
minimal-bootstrap
shared-system-bundle
public-site
web-client
mobile-client
desktop-client
native-system-release
creator
manifests
```

The shared product source may feed several delivery modes, but those delivery artifacts remain independently selectable. The public product portal is also a separate artifact: a change under `sites/public/` must not rebuild the kernel, bootstrap, shared system bundle or product clients. A shared Surface change may legitimately rebuild all applicable product modes; it must not rebuild the kernel. A mobile-adapter-only change must not rebuild unrelated Web/Desktop/native targets. A kernel change may rebuild the dependent bootstrap, but not client modes.

`docs/contracts/build-autonomy.json` version 2 records the dependency relationships and the following scaling rules:

- affected-build selection follows the artifact dependency graph;
- CI path filters are only an optimization and never become dependency authority;
- shared contract changes trigger cross-mode validation;
- unrelated rebuilds are architectural regressions, not an accepted cost of growth;
- missing a required dependent build is also an architectural regression;
- dependency cycles are forbidden;
- new artifact classes require a provenance owner;
- caches may accelerate a verified build but may not replace verification.

The Owner USB Creator CI uses the same exact Git diff impact decision on PRs
and on integrated `main` pushes. An exact visual-only source-pin advancement,
Windows-only Host change or specifically verified workflow routing change
uses a lightweight contract gate; it does not produce or publish a USB image.
Any unknown changed path, change to Creator's build/publish body, unverified
Surface source lock, changed kernel/initramfs/Supervisor or stale/missing Git
base **fails closed** to the full Owner USB producer. `workflow_dispatch`
always requires full Owner USB proof. Workflow changes are checked against
an exact reviewable governance template and the unchanged physical-producer
body. This prevents CI governance merges from invoking the known-broken
legacy Alpine/APK Surface builder merely because the Creator YAML changed,
without weakening physical release requirements.

The Portable/QEMU causal impact policy treats changes to the standalone Creator
workflow routing and its contract tests as CI governance, not as changes to the
Portable boot artifact. Creator still runs its own full USB/boot tests when its
workflow or real image inputs change. A kernel, initramfs, graphical runtime,
Native boot launcher, Portable QEMU workflow, unverified Surface source pin,
or unknown owner must continue to trigger the Portable/QEMU heavy proof.
The source lock can bypass that heavy proof only after an exact commit-level
verification that its change is visual-only; Surface source and Windows
consumer gates remain mandatory. This separates build-time impact from
product installation and distribution authority.

This lets future targets and features be added without turning every commit into a kernel/full-product rebuild. The `public-site` artifact is owned by `tools/public-site/build.py` and its contract in `docs/contracts/public-site.json`; it is intentionally distinct from the `web-client` product mode.

## Native system release assembly

The `native-system-release` is not identical to a raw copy of the shared `system/` tree. Some privileged Native capabilities require prebuilt host executables that browsers and shared JavaScript must never implement directly.

Those binaries are assembled through the repository-owned recipe:

```text
tools/native-release-assembly/build.py
```

The recipe copies the canonical shared `system/` source into an isolated temporary tree, cross-compiles only explicitly contracted Native helper packages, records their hashes/provenance, and hands the staged tree to the existing deterministic release bundler. No generated helper is committed into `system/`, no compiler is required on the end-user device, and no helper escapes the signed `system.tar` release boundary.

## Release provenance

Every boot-critical generated artifact must have machine-readable provenance containing at least:

```text
source_commit
recipe_version_or_path
upstream_source_identity
upstream_source_sha256
toolchain_identity
build_environment_identity
artifact_sha256
build_timestamp_or_reproducible_epoch
```

Where reproducible byte-for-byte builds are practical, they are preferred and should be tested. Where they are not yet byte-reproducible, provenance and integrity must still be explicit.

## ChatGPT / AI operating model

Any capable repository agent should be able to:

```text
read canonical docs
 -> edit source/config/build recipes
 -> commit/push main
 -> observe CI
 -> inspect failures
 -> correct source
 -> validate produced artifacts and hashes
```

No step in this loop may require Codex specifically.

Codex can still be useful for optional parallel review, hardware-local investigation, or a second opinion. Results from Codex become evidence only after they are represented or verified through canonical repository contracts.

## Physical boundary

Repository/CI autonomy does not mean a cloud agent can physically press keys, change firmware settings, or write a USB attached to a user's computer without an authorized device-side/host-side tool.

Physical operations are performed through OrdaX Creator or another explicitly authorized local mechanism. The Creator consumes signed/hashed artifacts generated from repository source; it does not invent or compile them locally for the end user.

Therefore:

```text
SOURCE_AND_BUILD_AUTONOMY=YES
CODEX_DEPENDENCY=NO
USER_LOCAL_BUILD_DEPENDENCY=NO
PHYSICAL_DEVICE_ACTION_STILL_REQUIRES_AUTHORIZED_LOCAL_EXECUTION=YES
```

## Failure rule

If CI is unavailable, source must remain reproducible from the versioned build recipe in another compatible container executor. CI availability must not redefine source truth.

## Desktop/Web independent of Creator and USB (2026-10-31)

This is an artifact and release gate boundary, **not a fork of the product**:

- **Desktop Windows:** `tools/windows-desktop/`, `tools/windows-emulator/` and `system/adapters/desktop/` are owned by the installed Windows Desktop/NSIS gates. The Desktop consumes shared versioned OS contracts and the separately pinned Surface; it never consumes or builds a Creator USB image, Buildroot, kernel or initramfs to deliver Windows-only code.
- **OrdaX Web:** `system/composition/web/` is owned by Surface Web/Chromium client gates. It does not consume Creator, Native Linux releases, or USB installation. Shared Account/Platform semantics remain authoritative; no shadow backend is allowed.
- **Shared Native / USB:** `system/composition/native/`, `system/adapters/native/`, `system/adapters/web/` (also imported by Native), shared nontrivial contracts, system runtime/hosts and boot/USB producer sources remain fail-closed. A change to `system/composition/native/main.mjs` is **not Windows-only** merely because a runtime branch checks `windowsDesktopHost`; it still reaches the USB entrypoint and requires a valid Native/Creator proof or a real architectural refactor.
- **CI ownership:** `tools/ci/creator_owner_impact.py` recognizes only the exact client-exclusive roots and reviewed pure client contracts/tests. Web/Windows still run their respective builds and tests. Unknown or mixed deltas trigger the USB producer; the classifier cannot replace product tests, disable required checks or claim runtime availability.

The executable build graph SSOT is `docs/contracts/build-autonomy.json#client_build_independence`; the Python impact classifier and `tests/test_creator_owner_impact.py` verify routing. Expensive USB gates must not be coupled to a Desktop/Web-only PR. A one-time shared Native entrypoint migration remains a genuinely shared change; it may not be relabeled merely to save CI time.


## P0 execution roadmap: remove Desktop/Web dependency on USB Creator (2026-11-01)

The **single** root roadmap is [`REMOVER-DEPENDENCIA.md`](../REMOVER-DEPENDENCIA.md). It is subordinate to the machine contract `docs/contracts/build-autonomy.json#client_build_independence` and tracks concrete status/gates. Client artifacts must remain buildable while the USB producer is broken. Currently separate Windows/Web jobs already meet that direct build invariant, but the physical USB check may still block a mixed Native PR merge; branch ruleset access was denied during this audit (403). No gate may be waived without an independently verified replacement.

The first safe packaging reduction removes only the Linux USB boot executables from the Windows NSIS runtime template with exact exclusions and an inventory regression. Complete Linux/Native/Windows import-graph analysis and installed NSIS proof are still pending. The Linux Alpine/Python mismatch belongs exclusively to the USB producer and is not to be repaired by adding Alpine or Linux tooling to Windows/Web.

## P0 — exclusão de scripts Linux dos clientes (2026-11-01)

O pacote Windows **não** deve materializar scripts POSIX destinados ao boot
Linux, monitoramento físico USB, ACPI, WPA, recuperação, montagem EROFS nem
ao supervisor de base. A relação exata, não uma varredura por extensão, está
em `docs/contracts/build-autonomy.json#client_build_independence.windows_package_forbidden_linux_shell_paths`.
O NSIS utiliza exclusões explícitas em `tools/windows-desktop/package.json`;
`tools/windows-desktop/package-inventory.test.cjs` verifica seus bytes `#!/bin/sh`
e a inexistência de inclusões acidentais. Os filtros push/PR de Windows/Web
ignoram estes artefatos de Linux somente; os imports Native compartilhados
continuam testados. `tools/ci/creator_owner_impact.py` verifica identidade Git
e shebang das adições contratuais, sem manter outra lista de caminho canônica.

A independência é de **compilação, distribuição e entrega** do cliente.
Não autoriza remover arquivos de suporte Python/JS que sejam consumidos pelo
Native Windows nem alterar política de boot do Linux/USB sem QEMU/Creator.
Prova de pacote NSIS e status de required checks continuam exigidos antes
de promover ou declarar encerramento do roadmap.

### Windows packaging of Web-only composition

The canonical Web `system/composition/web/` is never a Native Desktop
runtime prerequisite: `tools/windows-desktop/vite-native-build.mjs` names
`system/composition/native/index.html` as the single input. The Windows
template can therefore exclude the Web composition subtree, without
altering Web source, Native composition or Surface ownership. The
inventory accepts exactly `!composition/web/**`, no arbitrary subtree
wildcards; the Windows workflow excludes `system/composition/web/**`
from its rebuild triggers, while the Web workflow retains that source.
An actual extracted NSIS must have no Web-only composition directory.
`tools/surface-web/` is also a **Web producer**, not a Windows Native
compiler. The installed NSIS runtime must not copy it, nor should the
Windows Git updater sparse-checkout stage it. Preserve Windows' existing
`tools/windows-desktop/vite-native-build.mjs`, canonical locked Vite
archive, verified Surface source and rollback validation; test the absence
of Web producer tools in an installed NSIS and a compiled Git candidate.
This is delivery separation, not a second Native or Web implementation.
The source graph and integration tests, not file extension guessing,
remain authoritative for removing any other Python/JS components.
