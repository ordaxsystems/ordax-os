# Development Workflow

Status: CANONICAL FOR PROTOTYPE

## Priority P0 — direct incremental DEV USB (2026-10-27)

Project-owner decision: **Owner/Development image production must be usable directly from the versioned repository recipes, independently of GitHub Actions, full QEMU homologation or Stable promotion**. Existing kernel, Buildroot/musl base, Surface EROFS and Creator owners remain canonical; CI invokes their recipes and runs appropriate tests, it does not own production. Use verified persistent component cache and exact source/config/toolchain fingerprints. A change in Surface/services must not rebuild an unaffected kernel/base. A development image is not a homologated release. Preserve source integrity and explicit removable-device selection for physical writes.

Implementation, missing entrypoints, evidence and pass/fail acceptance: [P0 direct incremental Dev USB plan](plans/P0-DEV-USB-INCREMENTAL-BUILD-2026-10-27.md), within PR #2243. **This describes required behavior, not functionality already implemented.**

## Kernel-substitutable architecture — OrdaX identity independent of host (2026-10-27)

**Owner decision:** OrdaX is an independent operating-system architecture, not a Linux distribution or a Windows wrapper. The current Linux kernel and Windows host are implementation targets, not OrdaX product identities. Future native OrdaX kernel development must be possible without migrating the UI, application model, identity, capability contracts or updater authority.

**Hard boundaries for new code:**

1. Surface and removable apps consume **OrdaX-owned typed capability APIs** only. Do not call Linux syscalls, Windows APIs, shell commands, systemd, registry, POSIX filesystem semantics or Buildroot APIs directly from portable UI/app logic.
2. The OS core owns identity, authorization, state, process/file/device capability semantics, application lifecycle, health, transactional update and rollback. Platform-specific implementation belongs to explicit adapters with feature discovery and fail-closed errors, not silent host emulation.
3. Linux kernel, native graphical stack and Windows runtime are **adapters/targets**, not upstream authorities for the public OrdaX API. Do not introduce a second OS core or duplicate owners to implement adapters.
4. Buildroot/musl, Cage/Wayland/Mesa/WebKit, kernel/initramfs and Windows installer remain replaceable build/runtime dependencies **today**; they are not removed merely by declaring portability. A native OrdaX kernel will need proven process, memory, scheduling, IPC, filesystem, driver, network, graphics, security and boot implementations or compatible providers before cutover.
5. **Local-first workflow:** edit → preview/watch → affected tests → component artifact if needed → verify/update on target. GitHub Actions must not be a precondition for editing, local execution, unsigned DEV packaging or disposable image generation. Release publication, signing, trusted distribution and destructive physical-media operations remain explicit, independently verifiable actions.
6. Unit-test platform-neutral core with mocked/adapted capabilities on ordinary developer hosts. Run target-specific integration tests only for affected adapters. Heavy kernel, Buildroot, physical boot and installer builds are triggered by actual component input changes or an explicitly requested release verification.
7. No blanket removal of security checks, integrity validation, boot rollback or physical-write consent in DEV. Remove redundant *execution gates* while retaining invariants and tests.
8. Any new host-specific coupling must name an owner, a typed interface, capability contract, test fixture and migration/removal strategy. Existing canonical repository ownership remains authoritative.

**Acceptance criteria:** changing only portable Surface assets does not rebuild WebKit/Mesa, Linux kernel, Windows installer or Buildroot base; changing only an app does not rebuild OS; CI unavailable still permits local UI/app development and verified DEV artifact production; tests demonstrate host adapters are replaceable without changes to public OrdaX contracts. These are goals until proven, not a claim of implementation.

**Priorities:** complete the PR #2243 direct DEV USB chain and boot proof first; then move remaining host-specific calls behind existing OrdaX capability owners, starting with the actual coupling revealed by tests. Do not start building a replacement kernel before the system can reliably build, run and update with its current substrate.

## Source model

`main` is the source authority for this prototype.

The intended daily loop is:

```text
edit source
  -> run affected tests
  -> preview in browser when Surface/app work is affected
  -> commit to main
  -> CI builds/verifies only affected owners
  -> publish/materialize a verified release or delta when applicable
  -> reconcile only the affected owner
  -> verify health/readiness
  -> record evidence
```

A full image rebuild, USB reflash or notebook reboot is not the default development action.

## Host independence

Development must not require WSL, QEMU, PowerShell, Bash or one desktop OS as a mandatory substrate.

Canonical tools must have portable cores. Host-specific adapters are allowed only for operations where the host OS genuinely controls access, such as raw disks, elevation or device enumeration.

QEMU is optional test infrastructure. It can improve disposable boot coverage, but source development and product correctness must not depend on its presence.

## Product targets

The same shared product source serves:

```text
Web preview / hosted Web
Mobile application
Desktop application
USB OrdaX
Native SSD/HD OrdaX
```

A normal Surface change should be visible through browser HMR before commit and then reach the applicable product modes from the same source commit. No manual Web-to-device port or copied UI fork is allowed.

## Phases

### Phase A - source-only

Work that can be completed without the notebook:

- architecture/contracts;
- shared Surface/apps/services;
- browser preview/HMR;
- Web/Mobile/Desktop capability adapters;
- provisioning core logic;
- release layout;
- security policy;
- unit/fixture tests;
- deterministic artifact tests;
- static image/filesystem verification;
- optional emulator-based tests when available.

### Phase B - physical bootstrap

Once provisioning, canonical release trust and pinned boot artifacts are proven against safe disposable/fixture targets:

- identify the physical USB independently from drive letters;
- require explicit destructive authorization;
- clean-provision the two-partition layout;
- install only the minimal pre-release bootstrap;
- verify physical bytes/layout/hashes;
- boot the notebook;
- prove UEFI boot + minimum network + signed release acquisition + verification + activation;
- prove recovery when first acquisition cannot complete.

SSH, Remote Core and Control Plane are not prerequisites for this phase.

### Phase C - live evolution

Once the notebook can safely consume verified releases:

```text
Git main
 -> build/test affected component
 -> publish release or delta
 -> OrdaX updater acquires it
 -> verify
 -> activate
 -> owner-local reconcile
 -> readiness/health evidence
```

Ordinary system changes must not require USB reflash, a remote shell or Codex. Boot/kernel/initramfs changes remain separately gated and may require a base update plus reboot.

Base-update evolution is now governed by `docs/contracts/base-update.json`: candidate kernel/initramfs bytes must stage only into an inactive A/B slot, use a one-shot systemd-boot candidate entry, leave the default/current entry untouched before health, and promote only after base heartbeat plus Surface health. The current contract/planner does **not** authorize ESP writes yet; disposable FAT32 and physical rollback proofs remain required.

## Branching

Prefer one permanent branch: `main`.

A temporary work branch is acceptable for isolated validation, but should be short-lived and integrated only after tests pass. Do not create a forest of long-lived feature branches as alternate source authorities.

## Release model

Every deployed system version must be addressable by source commit.

Target shape:

```text
/ordax/releases/<commit>/
/ordax/current -> releases/<commit>
```

Rules:

- release directories are immutable after verification;
- activation is an atomic pointer/state transition;
- rollback selects a previously verified release;
- persistent mutable state never lives inside a release directory.

## Remote capability

Remote management is optional and is not part of the normal development/update path.

The normal path is repository/release driven:

```text
Git/GitHub
 -> build/test
 -> signed release or delta
 -> OrdaX updater
 -> verify
 -> activate
```

If a future product requirement justifies Remote Core or another remote-management capability, it must be delivered as a normal versioned release component behind explicit authorization. It must not become a hidden prerequisite for daily development, bootstrap, recovery or source authority. SSH remains optional and is not the default fallback.

See `docs/REMOTE-CONTROL.md` and ADR-007.

## OrdaX Creator development

`tools/creator/` exposes one shared product core.

Platform-specific code is limited to adapters needed for host APIs:

```text
tools/creator/platform/windows/
tools/creator/platform/linux/
tools/creator/platform/macos/
```

These adapters do not own layout policy, artifact choice, verification rules or user-visible product behavior.

End users must not need WSL, QEMU or a kernel toolchain to create/install OrdaX. The Creator consumes prebuilt verified artifacts and keeps destructive disk access behind a narrow, explicit host boundary.

## Evidence

For changes that affect boot, storage, identity, optional remote access or release activation, record at least:

```text
SOURCE_SHA=
TESTS=
TARGET=
OPERATION=
RESULT=
PHYSICAL_WRITE=YES|NO
REBOOT_REQUIRED=YES|NO
```

Evidence is not a substitute for tests, but makes the state of the prototype auditable by another conversation or agent.

## When the native target is offline

Do not block source work that is independently testable. Continue contracts, browser preview, fixtures, static artifact validation and other host-neutral work. Mark real-hardware validation explicitly as pending.
