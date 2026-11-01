Desktop/Web P0 implementation (2026-11-01; tracked by REMOVER-DEPENDENCIA.md):
The artifact graph already treats Windows and Web as independent of USB Creator;
current Windows/Web workflows do not call the USB producer. The active OS
PR #1980 nevertheless changes the shared Native entrypoint and therefore
legitimately triggers USB impact proof. Its Creator job fails before boot at
Alpine Python 3.12.15-r0 versus 3.12.16-r0; this is NOT a Windows/Web
compilation failure. The target is separate client delivery/promotion gates,
not falsely marking the shared Native USB artifact safe. Root roadmap contains
staged changes and acceptance gates. First Windows packaging reduction:
exclude Linux-only boot executable entrypoints from the existing NSIS template;
validate through exact inventory + installed NSIS tests before marking done.
Surface cross-account workspace visual rehydration remains with Surface #33.

Priority / delivery autonomy (2026-10-31):
The active Windows Desktop release track has priority over Linux USB/Creator
and Buildroot. Complete real installed Desktop and its essential Account,
Spaces + professional composition, Store/apps, Aura, files, Platform,
update and recovery slices with causal tests and physical Windows proof.
Web is a separate client delivery, not dependent on Creator/USB. Linux
Native/USB and physical media remain launch-baseline work but are not
the prerequisite for finishing Desktop/Web. Do not start costly unrelated
USB/QEMU/Creator builds, spawn parallel PRs or falsify trust/readiness.
Contract authority: MVP.md (not a minimum-product strategy),
docs/BUILD-AUTONOMY.md, docs/contracts/build-autonomy.json, and
docs/DEVELOPMENT-WORKFLOW.md.

Spaces / Professional Profiles UX SSOT (2026-10-31):
User-visible Spaces must be the sole creation, selection and management
surface; Profile Packs are versioned composition attached to the selected
Space, with advanced settings only. `docs/SPACES-AND-PROFILES.md` is the
canonical UX owner and ADR-028 clarifies the existing design. The old
root Profile plan was deleted after migrating its references to canonical
owners; its provenance remains in Git history. Surface #34/#35 and OS #2369 are now **integrated in source**: one `spaces`
entry in the Meridian rail, legacy `profiles` destinations resolving to
Spaces and the existing authenticated create port bound only to verified
Windows Desktop transport. The OS pins Surface source `56e63bc14e7df964beb293bc1d05843b80ebc0c6`.
This is **not** proof of the updated installed Electron, actual authenticated
login→create→provision→activate→select→restart E2E or Profile Pack health.
Keep the visual/product gates in ordax-surface#33 and OS #2007 open until
real receipts; `profilePack:null` is pending, not provisioned.
The OS contract/data owners remain separate; no second Profile database,
session, runtime or app installer.

OrdaX Desktop Windows MCP — **DEV FIRST** (31/10/2026):
O Desktop NSIS foi atualizado no Windows físico e seu Runtime
Product Device separado está **online**, sem reutilizar a instância do
agente auxiliar. O OAuth Owner autorizou o cliente ChatGPT exato com
`computer-observe` temporário e a sessão efetivamente despachou
`computer.access_status` ao Runtime Desktop anterior; ele respondeu
`action not allowed`. A correção causal no
[ordax-runtime#282](https://github.com/ordaxsystems/ordax-runtime/pull/282)
já está integrada (commit `726f41f77897aed7bdadbf4a7865a9aeca032f9c`):
limite Desktop de somente `agent.status` e
`computer.access_status`, sem ações Windows de escrita/terminal/GUI.
O novo candidato `ordax-runtime@50a8626d9212e3741b38b87fbe658e24c8bee024`
tem SHA-256 `33e6c14b2f6e03e275697806f686195ca3de1a13296adc107bd003f5d71ceae2`
e passou self-test físico isolado no `DESKTOP-PNUHUA0` (sem Python,
rede ou credenciais). O **único** manifesto atualizado é
`docs/evidence/desktop-runtime-windows-candidate-2026-10-31.json`.
**Pendente**: aplicar exatamente o novo candidato ao slot **DEV** do
Supervisor e comprovar `computer.access_status` remoto com recibo
`status=succeeded`/`ok=true`; `queued` não conta. O agente Windows
auxiliar permanece sem matrícula própria: sua configuração atual
reutiliza o ID do Desktop e não deve ser iniciada. A política de
produção Ed25519/source lock permanece fail-closed.
Prioridade/processo em `docs/DEVELOPMENT-WORKFLOW.md` e issue #1985.
Não iniciar USB/Creator/Buildroot/QEMU, novos CLIs/workflows ou builds.

Windows Store verified catalog (2026-10-31): the Native catalog revocation
and single metadata-read implementation from #1981 are integrated. OS #2356
and #2357 integrated the **same** signed-catalog read middleware for installed
Windows and for preview; preview without installed verifier trust returns a
canonical `unavailable` snapshot instead of a generic HTTP 503. The installed
host verifies a locally supplied envelope through the existing Go helper and
persistent anti-replay watermark; the canonical public trust anchor and
publication gates remain disabled. **No actual signed catalog, official
acquisition origin, usable installation lifecycle or physical Windows E2E is
proven**. Keep #2351 open for these distinct release gates; never assert
`ready` or invent entries from the successful HTTP response.

Public legal release proof (2026-10-31): Actions run #41233251204 completed
its source/local tests but its live immutable-document audit failed with
`published-legal-document-hash-mismatch:privacy`. Public HTML/digest drift is
**not** fixed by changing the approved hash or suppressing the gate. The site
and legal owners must restore approved bytes or approve and publish a new
versioned legal snapshot using their canonical process. Keep the public
registration/consent promotion fail-closed until that independent proof passes.

Desktop/Web build separation (2026-10-31): canonical architecture and executable
impact classification now distinguish Windows Desktop and Web client-only owners
from Creator/USB release producers. The source-of-truth is
`docs/contracts/build-autonomy.json#client_build_independence`,
`docs/BUILD-AUTONOMY.md` and `tools/ci/creator_owner_impact.py`.
Windows-only `system/adapters/desktop/` and Web-only
`system/composition/web/` no longer trigger Creator USB on their own.
Shared `system/composition/native/main.mjs`, Native adapters, and
`system/adapters/web/` used by Native remain USB-sensitive.
The Windows host's authenticated Space create gateway was merged in OS #2360
(`6c29f4da`), and the Desktop-only create port/contract merged as OS #2361
(`81553f2c`) without changing the shared Native entrypoint. The Surface UI
remains unimplemented (ordax-surface#33); this is **not** a completed
authenticated Windows E2E or actual Profile Pack provisioning.
The prior #2361 Creator workflow #41176996362 failed and is not release proof.

OrdaX Desktop Native Product MCP — Windows adapter (2026-10-30):
The canonical Native Host source now owns a bounded OrdaX Supervisor
adapter in `system/adapters/desktop/product-runtime-supervisor.mjs`.
It uses the **existing** Go Runtime Component Channel
`inspect-native-product-handoff` signed receipt, the OS source lock
and the separate Product device credential stored in
`<Desktop userData>/native-state/product-runtime`. The protected
`/__ordax/native/product-runtime-status` projection does **not**
expose credentials, and `processRunning` never implies a
`capabilityDigest`, an authorized central session or MCP readiness.
The source tests prove no launch without enrollment, approved trust
and a Windows signed executable; revoked trust stops the owned child
and one instance must terminate before replacement.

**This is NOT a functional OrdaX Desktop MCP release yet.** The current
policy `runtime-component-trust-policy.json` remains
`operator-ceremony-pending` and publication/activation are disabled;
the source lock describes an unsigned Linux ABI candidate, not a
signed Windows `.exe` in the canonical slot. The Go verifier and
signed Windows ABI/package must be reconciled by the component owner,
without weakening the global trust policy or importing a Python
checkout as production Runtime. The auxiliary Windows agent's Product
identity is not the Desktop identity. The installed Electron version
may also require one Windows installer update for the newly protected
observation route because the per-launch header allowlist is loaded
from the bundled template. No USB/Buildroot build is justified by
these Windows-only additions. The full gate remains: separate Owner
enrollment, verified Runtime lifecycle, nonempty `capability_digest`,
exact authorized client and one real MCP action. Native/USB continues
using the existing Linux Supervisor and its own credential.

Native Product MCP lifecycle integration (2026-10-23): Owner/Development USB
`system/supervisor` reconciles the OS-owned
`system/services/device-agent/native-product-lifecycle.sh` after the first
Surface-health check and stops its child before OS update/rollback/power
cutover. It prefers the verified signed Runtime plan, then permits a
development-only fallback to the pre-staged Buildroot Python tree at
`/state/ordax/native-state/owner-dev-runtime`; the canonical
`ordax_dev_agent.native_main` entrypoint still requires the existing local
access consent and Owner/Development USB profile. A lifecycle source update
uses `supervisor-restart`, never a live reload. `ordax-pull` delivers this
source change but does not acquire or stage the Runtime payload. Complete
payload ABI/dependency closure, remote grants/session, native adapters and
physical notebook execution remain unverified. Stable/MVP and native-disk
activation are unchanged.

Commercial reference catalog (2026-10-22): `docs/contracts/entitlements.json` now records reference BRL prices, storage/history/MCP capacities and additional offers. Landing and Account use one read-only build projection (`tools/public-site/plan_catalog.py`), with PT/EN copy and no checkout. Paid assignment, billing and commercial quota allocation remain disabled; catalog display proves neither subscription nor cloud service availability. Execution plan: COMMERCE-001. Source/CI and production deployment require separate verification.

Native MCP Runtime launch ownership — canonical Linux executable
(2026-10-21): The source-lock distinguishes the upstream compatibility
contract's `native_composition_entrypoint=ordax_dev_agent.main.run`
(dispatch loop) from the Linux binary
`ordax-product-agent` whose embedded entrypoint is
`ordax_dev_agent.native_main.main`. The native entrypoint validates
Owner/Development USB, reads the enrolled OS credential, takes the
canonical singleton lock and delegates to the dispatch loop. The former
source-only Python handoff helper is not a runtime entrypoint.
The unsigned candidate evidence is refreshed from the **successful
native CI on ordax-runtime main** at
`d3cecce1abfe542a50795b72d98d6a15fa25803a` (Actions run
`39732421629`), with independently matched artifact ZIP and ELF SHA-256.
The ELF is 25,034,544 bytes and has an external musl interpreter
`/lib/ld-musl-x86_64.so.1`, DT_NEEDED `libc.musl-x86_64.so.1`
and `libz.so.1`. Source provenance also uses Alpine; the embedded Python
dependency closure is not verified against the Independent Base.
The upstream canonical PyInstaller CArchive auditor now identifies **90**
embedded ELF members (40,611,847 uncompressed bytes) and binds a
deterministic inventory fingerprint to the same immutable CI candidate.
Declared native dependencies not supplied by identically named embedded
members include `libc.musl-x86_64.so.1` and `libc.so`. This is **not** a
complete loader resolution proof; the OS checks the pinned manifest's
structure, fingerprint and non-activation semantics, but does **not** fork
the canonical Runtime's PyInstaller parser. The current unsigned CI ZIP
does not authorize installation or a change to the system trust anchor.
The OS CI verifier reads PT_INTERP and DT_NEEDED from executable bytes,
matches the source lock and reports `independent_base_abi_ready=false`
without pretending a signed/installable component. The Independent Base minimal Buildroot defconfig currently uses
`BR2_TOOLCHAIN_BUILDROOT_MUSL=y` and `BR2_STATIC_LIBS=y`; it does not
establish the external dynamic loader/library ABI this candidate needs.
A successful Alpine-based CI executable test is therefore not a boot
proof on that Base. A reviewed build/ABI closure against the canonical
Buildroot owner must precede installation; do not copy Alpine libraries
into a second userspace or claim kernel-only Python execution.
The existing Runtime Component Channel currently limits a file to
2 MiB and an unpacked package to 16 MiB; this 25 MB executable cannot be activated through it
without a reviewed, component-specific binary packaging contract.
No signature, installation, launch or physical USB execution is claimed.
The pinned upstream compatibility contract bytes did not change, so its
SHA-256 is preserved.
(2026-10-21): The Owner/Development USB Native Host now uses the same
`product-runtime/instance.lock` as the upstream
`ordax_dev_agent.native_main` executable. The OS presence worker holds
the kernel lock during each HTTPS online/offline report; if the verified
native Runtime process holds it for its entire lifetime, discovery reports
are suppressed. The worker's bounded stop also requires a confirmed join.
Unsafe state roots or singleton files fail closed. This prevents
competing identity heartbeats between processes without a second scheduler,
credential authority or command bus.

The earlier **source-only, never invoked** in-process helper
`native_product_runtime_handoff.py` and its isolated test were removed:
the actual Linux distribution entrypoint is the existing executable
`ordax-product-agent --run --distribution-profile owner-development
--product-mode usb`, not an imported Python callback inside the Native
HTTP host's main thread. The upstream Runtime owns the Product command
queue, central-session confirmation, action dispatch and singleton lock;
the OS owns the original `ProductDeviceIdentityStore`, Native policy,
verified artifact distribution and lifecycle. The signed Runtime component,
trust anchor, OS service activation, runtime-health receipt and physical
execution are **not yet present**. No discovery/grant flags are redefined
as evidence of native action execution. Stable/MVP remains unchanged.

Owner/Development USB Local AI lifecycle (2026-10-21): `ordax-run` now
uses the existing Native Local AI endpoint with a bounded, fail-closed
`system/services/local-ai/owner-dev-runtime.sh` lifecycle. When an exact
pre-staged content-addressed signed v4 EROFS exists, the helper verifies
size/SHA-256, root ownership, source-lock identity and x86_64 architecture;
it mounts read-only, generates an ephemeral inference credential in the
existing Native Host location and supervises the model process until stop.
Absent, corrupt or incompatible payload never blocks Surface/boot.
This is a **source-only activation path for a pre-staged artifact**, not a
delivery implementation: current Git-first `ordax-pull` does not acquire or
install that 568 MiB EROFS. Publication/acquisition, verified staging,
rollback, actual USB Dev inference and physical verification remain open in
#2071. No change to Stable signing/activation or Web remote availability.

Owner/Development USB discovery without account login (2026-10-21): Native
runtime composition now starts the single existing presence worker whenever the
private, previously enrolled Product device credential is valid and no local
opt-out exists. No account login or discovery click is required on subsequent
starts of this DEV profile. Logout, anonymous session refresh and account-session
expiry leave this device-authenticated presence running. Native Host shutdown
still stops it. Local discovery disable/enable works without a cloud session and
persists in the existing visibility policy file, bound to the enrolled device ID.
Malformed policy/credential remains unavailable. Missing device enrollment still
requires authenticated initial enrollment; no account ownership, device token or
remote grant is fabricated. Stable and Native disk activation are unchanged.
Connector exposes canEnableWithoutLogin separately from accountAuthenticated;
the Settings control uses the former without claiming an authenticated user.
The canonical Account-session recovery added earlier on this date remains for
enrollment, with a 60-second retry deadline on existing session refreshes.
This DEV exception replaces the earlier account-bound default-off discovery
policy below; it does not install remote action execution or change MCP OAuth,
grants, local action policy or attestation. Physical notebook visibility still
requires an accepted server presence receipt. Contract:
docs/contracts/product-device-presence.json.

First-use journey redesign (2026-10-20): one
shared Native/USB/emulator wizard follows welcome (language + time zone), network,
account, local security, device name and review. No regional or privacy page.
The former regional cursor maps to welcome; security and later cursors re-enter
account because identity selection remains transient. Completed receipts remain
unchanged. New completions add an optional systemTerms acknowledgement containing
document ID, version, draft status and accepted=true. The final review has a
separate, initially unchecked OS terms box for local-only and signed-in users;
entry is disabled until checked. Text is readable inline and explicitly provisional.
This is development-flow acknowledgement, not the published OS legal document or
an account-registration consent. The Native host and emulator validate the same
bounded optional receipt extension, preserving existing completed receipts. A
published legal document, its approval and later reacceptance remain pending.
No account, Memory, sync or billing grants are created by the checkbox.
Keyboard status is a read-only disclosure on welcome. Presentation
retains the Meridian desktop rail and desktop geometry at all widths; smaller
computer viewports can scroll rather than switch to a mobile shell. Shorter
headings use the available width instead of an artificial 18ch line limit.
Account presents verified name/email/initial avatar and one primary action,
with password visibility, login/registration separation, explicit switching and
confirmed sign-out before leaving an authenticated account for local-only use.
A two-column account workbench includes read-only expandable profile/photo,
plan/resources and Web-preference restore sections marked as pending integration,
following the existing My Account areas. No plan, photo, full profile, billing,
entitlement or synchronization result is fabricated. Those data are not supplied
by the current Native session contract. The optional email projection remains
presentation data, never an identity key. Registration keeps gateway-owned legal
consent before submission; existing login creates no new legal receipt. Local
privacy/Memory choices stay in Settings; setup does not change memory.auto-capture.
Welcome now presents contextual Intelligence, Spaces and USB/Web continuity in
three Meridian feature cards. The existing account legal documents do not yet
describe Memory; any extension must follow their versioned backend policy owner.
Login offers links to those documents without inventing a legal acceptance receipt.
Regional preferences have one owner and are persisted from welcome. Validation
on 2026-10-20: 58 targeted Node tests passed. Chromium completed all 27 first-use
assertions and exited successfully. The emulator smoke requires a fresh first-use
state; the shared 4202 host resumed at Conta, so the smoke stopped before changing
that state. Python Native HTTP and state-contract tests could not run because this
Windows environment has no `python`, `python3` or `py` executable. No build was
run. Source edits do not update packaged USB images.

Physical USB lifecycle interpretation (2026-10-18): the historical `PHYSICAL_OWNER_AUTHORIZATION_RECORDED=NO` and `FIRST_STABLE_MVP_USB_WRITE=HOLD...` snapshot markers below are retained as evidence of the earlier pre-consent gate. For current authorization use `docs/contracts/physical-write-authorization.json` at the exact source commit and `tools/creator/physical_promotion.py`. An approved contract does not prove the v3 signed writer was published or that a physical USB was written, read back, booted or recovered.

Native Runtime composition source alignment (2026-10-21): the OS source lock now
pins merged Runtime `9734893697dae7dbb3cef5ca060a531e5fb0cd66` and the
updated compatibility-contract SHA-256. The existing dispatch loop is available
as `ordax_dev_agent.main.run` with explicit host configuration and the existing
private identity-store reader; no duplicate credential file, command transport
or action authority is introduced. Upstream Linux source integration exercises
a real temporary-file action with isolated transport and local-policy denial.
This does not install the Runtime on the notebook. The native executable
package/slot, lifecycle ownership, health, device grants and session attestation
remain required before activation. Graphical control must bind to the OS's
native graphics/input services; no external Linux desktop is required.

Runtime Product MCP source alignment (2026-10-18): `system/services/device-agent/studio-runtime-source-lock.json`
pins reviewed `ordaxsystems/ordax-runtime` 0.4.7 at an immutable commit and
SHA-256 of its `ordax-os-runtime-compatibility.json` contract. The upstream
runtime owns the canonical Product PostgreSQL `/v3/device/transport` workflow
and central-session attestation. The same Product transport now records
`ordax-os` for a Runtime using the trusted Native credential provider and
preserves `desktop-agent` for existing Windows heartbeats. The upstream
compatibility contract is the only owner of that runtime-kind semantic.
The Native Host can pass its private
`ProductDeviceIdentityStore.read_enrolled_credential` as a provider to that
same Runtime, with exact device-ID matching and no second token file. The OS
reuses that provenance; it must not copy the claim/lease/report
implementation or treat `ordax.intelligence/1` as a source of action grants. Source pinning **does not install** the headless
runtime into the USB or enable device actions. Native action execution remains
closed until a signed runtime component slot is installed, health-checked,
session-attested and authorized under client OAuth, device grants, local policy
and the existing Action Gateway. No runtime network download at boot.
See `docs/contracts/studio-runtime-integration.json` and the existing
runtime-component-channel trust policy.

MCP device presence verification (Owner/Development USB, 2026-10-18): the
single ProductDevicePresenceWorker now retains the last accepted HTTPS
presence receipt in memory with a monotonic bounded freshness window. The
native Settings projection keeps private owner opt-in separate from actual
server-acknowledged presence: `disabled`, `connecting`, `confirmed`,
`unavailable`. "Confirmed" means only that Product PostgreSQL accepted a
device presence report, **not** that an external ChatGPT OAuth client has
grants, or that OS remote-action execution is installed. There is no
second heartbeat or MCP endpoint. A local refresh reads the existing
worker via the neutral Product Connector port. Source-of-truth contract:
docs/contracts/product-device-presence.json. Physical USB proof and OS
action Runtime/attestation remain independently blocked.

Historical Native Connector Settings opt-in (2026-10-18; DEV discovery policy superseded by the 2026-10-21 entry above): Owner/Development USB now
uses the private ProductDeviceIdentityStore as SSOT for a separate
`product-connector-visibility.json` preference, default-off. Native Settings
calls the loopback-only `/__ordax/native/product-connector` route. The existing
Account gateway validates a live authenticated session before enabling
discovery; disabling requires no cloud availability and stops the single Native
presence worker. An authenticated login still enrolls the device, but does
not publish discoverability without opt-in. This does not grant ChatGPT OAuth,
filesystem, input, or remote execution. OS action attestation/Runtime remains
unavailable, and physical USB proof remains pending. The account session is
memory-only until the encrypted local vault gate; login may need repeating
after Native Host restart. Stable is unaffected.

Historical Native Product Connector candidate (2026-10-17; DEV login lifecycle superseded above): Owner/Development USB
reuses the existing Native Account login and private Product device
identity to start one fail-soft HTTPS presence worker after authenticated
enrollment. Logout and Native Host shutdown stop its lifecycle; no command
shell, alternate model router, Studio ownership, or second OAuth backend.
The matching Product MCP PostgreSQL device-only presence route is proposed
in ordax-platform#205 and the OS origin points to its trusted device ingress.
Until that route is deployed and physical USB proof passes, this is a
**source/CI candidate**, not a claim of live OrdaX OS visibility in ChatGPT.
The canonical Runtime OS action dispatcher, session attestation and explicit
MCP grants remain separate disabled gates. Stable and anonymous/offline boot
remain independent. See docs/contracts/product-device-presence.json and
docs/INTELLIGENCE.md.

# Current State

## First-party app source ownership — 2026-10-22

`ordax-apps` is the canonical source owner for Internet, Assistente, Projetos,
Atividade, Rede and Notas; these six app sources are absent from
`ordax-os/system/apps/`. That source transfer is complete, but it does not prove
package signing, installation, Store inventory, offline bootstrap or independent
updates. The Files product source and its bundled Surface UI were removed on 2026-10-23 for clean-OS testing. The OS retains File Space, project continuity, native user-root isolation, typed host ports and the signed-slot framework. Files is not preinstalled; no unsigned or unverified app will be activated. Distribution/health/rollback/physical boot gates remain pending. The
portable Studio product is canonical in Apps; the old OS-local Studio UI and
fixed launchers were removed on 2026-10-23 for clean-OS development. No
external Studio package is installed or activated by this source cleanup.
Loja, Ajustes, Conta and Sistema are structural OS surfaces in `ordax-os`. Keep those boundaries distinct:
do not activate external packages by changing documentation flags alone.

Upstream `ordax-os/main` at `a2eee8ea` (PR #2150) also hardens the Native
Product Runtime handoff: ABI readiness now requires an explicit empty
`independent_base_abi_blockers` list, and trust requires the canonical
`canonical-public-trust-pinned` ceremony status. The two Go source/test blobs
are mirrored exactly in this worktree; all nine PR checks passed. This closes
only that trust-evidence gap and does not enable Files or Studio cutover.

Studio packaging and installation remain separate blocked gates. The 2026-10-22
Apps snapshot lacked the expected portable runtime and compatibility descriptor.
On 2026-10-23 the former OS-local git-app Studio UI was removed without enabling
an external package. A signed package, Native/Web parity, isolation, health,
rollback, offline reinstall and clean USB boot remain prerequisites.

Full first-party package inventory audit against the same Apps `main` snapshot
on 2026-10-22: the workspace lists 20 targets. Nineteen have an Apps
`app.json`; 18 also have `apps/<id>/src/runtime.mjs`; 16 have a compatibility
descriptor in one of the two locations accepted by the Apps readiness auditor.
`files` is intentionally absent pending remove-first handoff. `studio` is
missing both runtime and descriptor. `internet` and `assistant` each have a
manifest and runtime but no compatibility descriptor in either canonical
location; both externalization plans allow source cutover but keep distribution
activation false. The other 16 targets have manifest, runtime and descriptor.
This inventory proves source/package structure only, not signed release,
installation, promotion, rollback, offline reinstall or USB availability.

Native isolation candidate on branch `codex/apps-externalization-20261022`
(not yet in OS `main`, 2026-10-22): verified `current` slot code executes
inside a sandboxed iframe with an opaque origin. Its CSP confines scripts,
styles, images and fonts to the exact signed component path, blocks network
connections, nested frames and workers, and the Native HTTP boundary refuses
same-origin module reads. The parent transfers a private `MessagePort`; its
allowlist binds App Data to that app identity and exposes only the minimal
Surface lifecycle. **Every privileged bridge operation** revalidates the exact
Native `current` slot, including its revision, version, source commit and
entrypoint. A changed slot or unavailable Native verifier rejects the request,
revokes further calls, drains in-flight work, asks the child runtime to destroy,
then removes the frame. The sandbox never receives File Space.
If exact-slot verification times out, Native aborts the metadata request and
fails the app operation closed so teardown does not hang on a dead host.

This candidate closes the privileged ESM execution path, but it does not
complete Files cutover: Native Files still uses the session-wide `user_root`.
OS `main` remains fail-closed after #2100 when a current component context
contains `fileSpace`; it does not yet mount a component in the isolated runtime
with a File Space broker. Space selection
is persisted in the client, while the Native file routes do not validate the
authenticated subject or selected Space and do not resolve a per-Space root.
The account gateway forwards `/account/spaces`, but no host-owned mapping from
those Space IDs to storage exists; deriving one from Space kind would mix
distinct workspaces. Existing `user_root` content is device-local and remains
offline-capable, so it must not be assigned to an account Space or moved by an
implicit migration. Pending Notes probation is now a separate isolated
`import-contract` probe: an opaque-origin iframe imports the exact signed
pending entrypoint without host capabilities, then revalidates the exact
revision. It never mounts the app; `healthy` proves only the import/export
contract. A host-owned mount-health probe, signed publication, canonical trust,
activation and rollback proof are still absent. See
`docs/APP-PORTFOLIO-AND-PREINSTALL.md`, “Bloqueio comprovado do File Space por
Space”, for the migration boundary and safe cutover requirements. Keep
`native_files_slot_bound_file_space_enforced` and Files cutover disabled until
the host validates slot + session + active Space on every operation, the data
owner defines per-Space storage and explicit reversible migration from the
device root, and signed offline bootstrap, pending health, USB boot/recovery
and real-host verification are proven. Do not treat the App Data broker as a
substitute for File Space authorization.

Meridian shell (2026-10-19): the persistent workspace header has been removed
from Web, Native, Central, Área de Trabalho, and app destinations. Workspace
content begins at the top of the shell; search and appearance remain available
through the existing navigation and taskbar controls. Native area switching
now lives in the sidebar, and update status remains available there as well.
The Store's redundant context banner is removed; its mode switch sits with the
window controls so both the mock presentation and real-catalog view remain
reachable. Window title bars remain the window-management surface. Display-scale
tokens continue to be shared across desktop presentations.

Surface shortcut placement (2026-10-19): Central quick access, desktop icons,
taskbar pins, and the device-app section in the navigation menu derive from one
ordered catalog under `system/services/surface/`. Rendered sidebar app labels
are localized from their actual app IDs, avoiding stale app-name lists. The app
runtime catalog and host capabilities remain the authority for whether an app
can open; shortcut placement does not grant access. System Updates remains a
separate destination within the System app. Native rail and overflow-menu icons
consume the shared Meridian destination glyph metadata. Web and Native desktop
shortcut grids now share Meridian spacing, cell, icon, and inset tokens.
Their grid and shortcut interaction styles now also have one Meridian owner;
the number of rows adapts to the available vertical workspace height, with
narrow-workspace sizing shared across both hosts.

Desktop canvas (2026-10-19): Web and Native resolve the desktop wallpaper
through one Meridian CSS token and the same local SVG asset. Both presentations
apply the existing material opacity and high-contrast removal preference to
the wallpaper; shortcut labels remain legible on the plain canvas. The
Web-only watermark was removed so the desktop has the same content hierarchy
across hosts. The wallpaper remains decorative, behind shortcuts and windows.

Desktop taskbar frame (2026-10-19): Native and Web now share Meridian tokens
for the bottom bar's three-column balance, content-sized side controls, group spacing,
horizontal inset, dock item targets, glyph size and open/active/minimized
indicators. Arrow navigation and Home/End share one implementation; each host
retains its own scroll reveal. Taskbar focus and toggle states now follow shared
Meridian styling and the actual pressed state. Host styles retain only
responsive breakpoints and platform-specific controls, so dock status and visual
scale stay consistent while available system actions remain truthful to each
host.

Meridian navigation refinement (2026-10-19, source changes awaiting validation):
Central and desktop use the same sidebar spacing. The shared taskbar reserves
the intrinsic width of its side controls before giving the remaining space to
the scrollable dock; its default height is 3.25rem with 2.75rem app targets.
Native sidebar spacing responds to the scaled canvas height, preserving desktop
navigation and its overflow menu. Sidebar measurements use layout pixels rather
than zoomed screen rectangles, and Native dock focus remains visible after
container resizing. Focused Node regressions were subsequently run on 2026-10-20: Meridian shell,
desktop resolution, First Run and Home behavior passed (45/45 tests). Diff
whitespace validation also passed. Visual acceptance and npm/build checks remain
unrun; these source edits do not update the packaged USB image or published Web bundle.

Central Home refresh (2026-10-19, source changes awaiting validation): Native
Home follows the supplied dashboard concept: the existing day/night landscape
contains a local-only Aura command preview, followed by illustrated continuation
cards, an app strip, recent-file/project examples and side widgets for system
status and a current Space. Example states, projects and app shortcuts are
explicitly marked; they are not asserted as host readings, installed apps or real
files. Command suggestions populate the input; send/example actions only show a
dismissible preview notice, with keyboard support and focus restoration. This
preview composition lives in `system/surface/ui/home-concept.mjs`, separately
from service-owned Home data and without a new backend adapter. Real continuation
replaces the illustrative resume row when present; pending notices and local file
shortcuts remain. Current catalog-owned app routes and capability checks still
apply to real shortcuts. Spaces, profiles, devices and Store remain accessible
through the existing Meridian destinations below the dashboard.
Desktop container sizing rearranges content without changing the shell into a
mobile navigation. Native and Web share the hero day/night resolver: 06:00–17:59
uses the existing sunny landscape, otherwise the existing moonlit landscape,
according to the configured time zone, independently of interface color scheme.
The clock retains the current greeting across shell localization renders.
Focused Node regressions were subsequently run on 2026-10-20: Meridian shell,
desktop resolution, First Run and Home behavior passed (45/45 tests). Visual
acceptance and npm/build checks remain unrun; packaged USB images and published
Web bundles are not updated by these source edits alone.

Desktop window chrome (2026-10-19): Web and Native application windows share
the Meridian frame, active-state treatment, titlebar height and insets, app-mark
tile, title typography and control targets. Window placement and available
window actions remain owned by each host.

Native Central home layout correction (2026-10-18, historical geometry superseded
by the 2026-10-19 Central Home refresh above): the previous layout kept local-space
shortcuts in the secondary column and continuation/pending cards in the main
column. Preserve those services, but use the current dashboard composition.
At narrow widths these direct `.ordax-space` children flow in document order.
This preserves the existing lifecycle owners and avoids overlapping grid areas;
it changes presentation only and does not claim new backend or USB capability.

Native emulator / Meridian First Run (2026-10-18): the Windows emulator now loads
`system/composition/native/index.html` for both onboarding and desktop, with no
emulator-owned First Run or Web preview handoff. Development-only persistence
implements existing Native contracts; unavailable hardware/privileged bridges
remain unavailable. First Run CSS consumes Meridian tokens directly and keeps the same desktop
rail-and-workspace structure at every width; its content area scrolls and short
screens compact vertically instead of switching to a phone layout.
This supersedes the previous Web-backed emulator preference wiring below.
Meridian is the sole accepted product identity; remaining legacy screens are
migrated in stages while preserving functional ports and planned mocks.

Shared sidebar account profile (2026-10-18): Web and Native/USB consume the same
`projectSidebarAccount` identity/status/connection model and Meridian profile
styles in `system/surface/ui/sidebar-layout.css`. The Web-only profile rules were
moved to that existing shared owner; Native retains account launch, storage and
notification controls. Offline/logout/capability loss update the connection mark
without inventing a session. Other shell/page composition differences remain;
this increment does not claim full Web/Native equivalence.

Historical emulator preference continuity (superseded by Native emulation above): Windows onboarding and its same-origin
Surface now consume `createWebPreferenceStore` and `createPreferenceRuntime`,
removing the emulator-only preference implementation/storage authority. Completed
older onboarding receipts seed only missing regional values through Native's
`seedMissingRegionalPreferencesFromFirstRun` policy; newer Settings choices win.
The OOBE receipt stays emulator-specific. Hardware capabilities and the distinction
between Native and Web composition remain unchanged; this is not a full parity claim.

First Run single owner (2026-10-17): Native/USB and Windows emulator use
`system/surface/ui/first-run.mjs`, canonical journey metadata and the same
Meridian visual owners. The dormant Meridian `setup` storyboard and its
independent progress renderer were removed from the runtime catalog. Prior
planned screens/fields remain reference-only in
`docs/evidence/first-run-ssot-2026-10-17/`; other Settings/resource mocks remain
available. Contract tests reject a second executable setup and check both entry
points and visual imports. This does not establish the running commit of a
physical USB; its OOBE update guard and physical verification remain unchanged.

Shared Store presentation (2026-10-17): Web and Native mount
`system/surface/ui/store-experience.mjs` and its Meridian chrome stylesheet.
Both use the existing planned presentation and the same verified-catalog DOM
controls; Native retains lifecycle requests, model hardware/metrics and activation
ports. Web remains unavailable without transport, with no lifecycle authority.
Planned catalog/reducer runtime is browser-ready MJS, with typed TS facades;
fixtures remain separate from the official catalog. Native window teardown
releases requests/subscriptions and planned timers. No USB medium was modified.
The older React Store body is retained as reference, not mounted by the current
Web entry. Browser regression covers both ports and the built Web composition.

Public device demonstration (2026-10-17): the notebook and compact phone
viewport consume static markup rendered from current Meridian Home, header,
sidebar, dock and app presentation components. The existing local controller
keeps the fictional Aurora scenario. Source hashes detect stale derived markup;
styles are compiled from the same source and scoped to the virtual viewports.
Only read-only/unavailable account, preference and Intelligence adapters exist
during generation; no React/Surface runtime or service transport ships in the
portal. Source wallpapers are copied and byte-verified. Compact preview means
responsive Web, not a published Mobile package. The local navigation menu
fits within each device, exposes its expanded state and controlled region,
supports arrow/Home/End keys, restores trigger focus on Escape, and closes
on outside pointer interaction or focus leaving the menu. Both notebook and phone
can be expanded independently in the existing dialog, preserving their view
and restoring focus and original placement when closed. Phone expansion fits
the host viewport; the notebook retains desktop geometry. Unexecuted demo actions
show dismissible local feedback within each device, including the active modal,
and return focus to the initiating control. They never claim that a service
action succeeded or that the real product necessarily lacks that feature. Escape dismisses
the innermost navigation or notice before the enclosing device dialog; without
an inner overlay it retains the native dialog dismissal and trigger focus.

Public Account Web shortcuts (2026-10-17): sidebar, footer and mobile More
menu now link directly to the canonical Web origin, matching the landing.
The mode CTA uses the same access label. The mobile reachability proof checks
the direct destination, and public-source guidance distinguishes the live Web
from the preserved legacy presentation. Account session gates remain unchanged.

Public Web entry correction (2026-10-16): landing hero, mode and footer links
now open https://web.ordax.com.br/ directly. The legacy /web/ path on the public
portal permanently redirects to that root through host-scoped Vercel routing.
The product owns session checks and login; no portal session is used to bypass
Web authentication. The historical presentation source remains preserved for
reference/local previews, rather than acting as a second production entrance.

Public landing header (2026-10-16): compact brand and 44px controls keep the
primary navigation on one row until 960px. Smaller widths retain all section
links in an independently scrollable row. At phone widths the header flows with
the document so its stacked account/language controls do not cover the content.
Authentication actions and the shared profile runtime remain unchanged.

Public Meridian layout refinement (2026-10-16): landing sections use tighter
vertical rhythm, a shorter introduction and an explicit link to the existing
Web access page. Login, registration and recovery now share identity-family
density in account.css instead of login-only overrides. Registration and password
reset explain the existing 12-character requirement before submission. Legal
consent, readiness, native POST and Turnstile remain unchanged; pending product
capabilities and conceptual examples remain labelled. The public demonstration
also restores the missing Projects navigation name for visible and accessible
labels. Web login continues to derive from the same public identity source.

Web navigation and internal page consistency (2026-10-16): Projects, Files,
Devices, Activity and Continuity share one planned-service presentation with
existing unavailable-service messages, preserved integration notes, capability
cards and links to actual Spaces/Account windows. No device, file or activity
record is fabricated. Apps and Profile catalog use the same content width and
readable spacing. The topbar/dock search identifies its destination scope,
includes Account/Continuity, and matches labels/targets without accents. The
Continuity rail control now opens its own existing window instead of Activity.
Scoped rendering/search regressions, reference verification and Web compilation
pass. The strict-CSP browser proof passes seven viewports and exercises these
service destinations at desktop and 320px; service connections remain pending.

Web account navigation usability (2026-10-16): manual rail collapse now stacks
utilities vertically and retains 44px hit areas instead of compressing them to
roughly 18px. The profile avatar has readable initials, clearer decorative status
and an active-account border. Dock buttons now expose the restore identity already
consumed by WindowLayer, so minimizing the last visible account window returns
keyboard focus to its actual dock control. Navigation/reference checks and the
TypeScript/production build pass. Browser regression covers minimize/restore focus
and collapsed utility geometry without changing identity or backend authority.

OrdaX Web account redesign (2026-10-16): the internal account page now groups
confirmed identity, browser session, local Settings/Spaces shortcuts and preserved
pending resources. Profile/security/privacy/usage/subscription links point to the
existing public Account owner in explicitly labelled new tabs with noopener and
noreferrer; no iframe or second account implementation is introduced. The global
rail profile has a readable name, connection indicator, full-name tooltip and
unchanged accessible account entry, including collapsed mode. Identity actions,
readiness and service ownership remain unchanged. Session/portal-link regressions,
canonical reference verification and TypeScript/production compilation pass. The
strict-CSP browser proof passes all seven viewports, including preserved Account
state through the Spaces shortcut, new-tab isolation and full-name rail feedback.

Authenticated Meridian Web review (2026-10-16): confirmed account identity is now
presented separately from Spaces catalog errors. Account and Spaces panels retain
their intended insets instead of losing them to generic window panel styles.
Account uses readable profile/actions and preserved pending storage/billing cards;
its management link derives the public portal origin from product-family rather
than pointing at the dedicated Web host's nonexistent account route. Full Spaces
examples and existing identity/selection gates remain unchanged. Session/catalog
regressions, canonical reference verification and TypeScript/production compilation
pass. Browser proof now checks Account/Spaces geometry and the account destination
at every breakpoint. This does not claim a successful live Spaces consultation.

Web login asset closure correction (2026-10-16): production inspection of the
shared login revealed its generated token/symbol CSS referenced a missing
`assets/ordax-symbol.png` in the dedicated Web artifact. The Web composition now
copies the canonical Surface symbol and includes it in the deployment receipt.
A regression composes the real login, resolves its CSS dependency and verifies
byte identity and manifest coverage. No alternate logo or stylesheet was added.

Meridian Web and login layout refinement (2026-10-16): Central now uses a bounded
content width, a denser hero and larger navigation/file/agenda text and command
controls. All planned features and mocks remain visible. The canonical login
presentation places recovery beside its explicitly associated password label,
reduces repeated copy/spacing and uses 16px inputs. Both the public portal and
Web bootstrap still consume the same Account HTML/CSS; no authentication,
Turnstile, session or origin gate changed. The product host remains
`https://web.ordax.com.br`, with same-origin `/login/` and `/auth/login`.
TypeScript/production Web compilation, public source/build, localization,
auth/navigation and public deployment/contract checks pass locally. The canonical
strict-CSP Web browser proof passes all seven viewports (320–1440px), including
theme persistence, navigation, app lifecycle and absence of horizontal overflow.
Local Windows sandbox GPU startup failed; the unchanged proof passed outside
that restriction. This change alone does not claim authenticated E2E or a new
production deployment.

Public Web entry Meridian correction (2026-10-16): `/web/` now opts into the
canonical Meridian material and reuses `account.css`'s identity layout/components
for header, access card, buttons, state panel and responsive composition. Its own
stylesheet contains only page spacing and semantic error treatment; the separate
legacy palette/layout was removed. Session readiness and authenticated launch
remain unchanged. Public source/build, nine session/navigation regressions,
16 identity/contract regressions and bilingual localization checks pass.

Public Web deployment verified (2026-10-16, 14:25 UTC): PR #1859 is merged into
main at `16d3fc2ed40abb417027a5b8731a7e2e59491f4d`. The canonical Vercel project's
GitHub status reports deployment completion; https://ordax.com.br/ serves the
portal and https://ordax.com.br/ordax/ serves the Meridian Web runtime. All 56
component files match the public deployment manifest byte-for-byte, and the
deployed CSP matches the original public policy. This supersedes the pending
hosting/publication observations below. Mocks and unavailable-backend indicators
remain intact. The authenticated `/web/` launch configuration and account/provider
gates are unchanged; authenticated E2E is not claimed. Evidence:
`docs/evidence/meridian-web-2026-10-16/production-proof.json`.

Web Meridian integration follow-up (2026-10-16): the real account-backed Spaces
view now opens first, with Meridian cards and authorized session-only selection.
Complete mocks remain explicitly accessible. Central's Profile shortcut opens the
canonical bundled catalog; pending integrations use red text badges and preserve
planned controls. The follow-up also composes server-confirmed signup readiness,
with bounded policy reads and cancellation. 96 targeted tests, TypeScript and
reference verification pass.
The branch has been reconciled with main `0d9832ed38bba21ac0c99a509c7a5464776aeaeb`.
Web production compilation passes. Public-portal regression also passes (42 Node
tests and 52 Python tests); the compact More menu no longer repeats primary routes.
The local Vite origin still lacks a configured authenticated gateway. No live account
E2E or USB readiness is claimed. Public `/web/` remains a gated portal entry, not
the 4201 application: product runtime hosting and its strict-CSP browser proof
remain required before enabling that launch. Main promotion and deployment must
be verified separately from these local results.
[Scope](DESKTOP-IDENTITY.md#web-meridian-account-backed-spaces-and-pending-integrations--2026-10-16).
PR #1859 contains the preserved integration. The shared Meridian journeys and
Space examples now consume the existing Surface language catalog in pt-BR/en-US
(1,139 stable message IDs). Their scenario/step/option identities and confirmation
gates are preserved. Web uses the regional preference; Native uses its localization
port. 101 Web/Meridian regressions and 28 locale regressions pass locally, including
the formerly failing English rendering audit. TypeScript, production Web compilation
and the 34-reference verifier pass. Public runtime packaging and complete Web
browser proof still require validation before promotion.
See [CI evidence](evidence/meridian-web-2026-10-16/README.md#ci-review-of-pr-1859).

Local follow-up after remote commit `f2e529a5a9000c0cf63a549029633629a8cf2532`:
the catalog now uses explicit literal tables compatible with the public builder's
static reader. Central's manual sidebar sizing and Settings appearance markers are
restored, and dock restore labels use the managed window title. 101 Web/Meridian
tests, 40 Python public/catalog/builder tests and the 34-reference verifier pass.
The adapted Web browser regression now passes all seven viewports (320–1440px,
including landscape), preserving theme persistence, navigation, window lifecycle,
drafts, compact geometry and unavailable-backend checks. Central's collapse control
uses normal rail layout instead of inheriting the old edge positioning. The earlier
automatic-review usage blocker was cleared on continuation. These follow-up changes
are saved with this evidence on the existing branch. Main/public promotion remains
pending production runtime packaging and its strict-CSP proof.

Public-policy follow-up: CI for `8ea37ae4abddf7143e659ba1234a34e39f1b34fc`
passes Surface Web Candidate, Foundation Contract, Public Site Candidate and
English localization. Store/Spaces shadow presentations now adopt their existing
bundled CSS through constructed sheets, and Store markup uses stylesheet classes
for static spacing. All examples/actions are retained. The official Web browser
proof can optionally serve the actual global headers from `vercel.json` using
`--public-policy vercel.json`. That strict run confirms the scoped presentations
render but fails on four `style-src-elem` violations from UI dependency styles;
the retained document style identifies Sonner. No CSP allowlist or security header
was relaxed, and public runtime activation remains blocked by this actual proof.

Public-policy correction: a build-only adapter now replaces stylesheet element
delivery for the exact locked Sonner and react-style-singleton inputs with native
constructed sheets. Upstream CSS and component APIs/reference counting remain
unchanged; unexpected source hashes or missing adapter coverage fail the build.
The adapter is included in the canonical Web source receipt. Four adapter lifecycle/
integrity tests, eight builder tests, typecheck/build and reference verification
pass. The official Web regression now passes all seven viewports under the original
`vercel.json` global headers with zero CSP violations. CI now requires that strict
proof. This supersedes the local CSS blocker above; independent public runtime
packaging/deployment and authenticated E2E remain pending.

Public deployment composition (source-ready): `tools/public-site/deployment.py`
now builds/verifies the existing public portal at `/` and the existing Web builder
at `/ordax/`, requiring the same source commit and preserving both manifests/files.
The deployment receipt rejects corruption, extra files and component path escape.
Vercel configuration targets `out/public-deployment`; its same-origin account
rewrites and security headers remain intact. Public Site Candidate also validates
composition repeatability and the mounted Web under the real policy. Local mounted
browser proof passes all seven viewports, and 44 targeted packaging/portal/builder
tests pass. This is source/local-candidate proof, not a production deployment:
`runtime_deployment_verified` remains false, and `/web/` activation is unchanged.

Shared Settings journeys (2026-10-15): Web and Native/USB Settings now consume
shared complete presentation scenarios/navigation/styles under `surface/ui/journeys`.
The Meridian reference re-exports those owners. Real controls remain intact; example
completion does not execute backend operations. No build or physical USB validation
was performed. [Scope](DESKTOP-IDENTITY.md#shared-settings-journeys--2026-10-15).

Web Settings layout (2026-10-15): Settings adopts the Meridian category grid and
panels while preserving all real Web preference controls and account navigation.
Unconnected device features remain visible as labelled examples. No branch merge,
npm, automated tests or build for this change.
[Scope](DESKTOP-IDENTITY.md#web-settings-meridian-layout--2026-10-15).

Spaces presentation follow-up (2026-10-15): the Web Spaces window now shares the
Meridian dashboard renderer/styles/examples with the isolated preview. Authorized
account consultation and selection remain separate and unchanged. Covers, metrics
and creation examples do not imply backend support. The branch incorporates current
main through `7e71ead5`; no automated checks or build were run for this follow-up.
[Scope](DESKTOP-IDENTITY.md#shared-spaces-presentation--2026-10-15).

Profile categories and parity notes (2026-10-14): Web consultation now reuses the
canonical taxonomy for parent/category/niche filters and retains valid profiles
when taxonomy is unavailable. Existing unsupported screens expose collapsed
compatibility notes; planned features and Store sessions remain intact.
[Scope](DESKTOP-IDENTITY.md#profile-categories-and-visible-parity-notes--2026-10-14).

Meridian backend compatibility review (2026-10-14): the user requires retaining
all planned frontend functionality and deferring integrations whose backend is
narrower. Web professional profiles now additionally consult the canonical bundled
active-profile catalog, without activation or replacing planned content. Other
backend/transport gaps remain explicit; no remote service is newly enabled.
[Compatibility matrix](DESKTOP-IDENTITY.md#meridian-backend-compatibility-review--2026-10-14).

Meridian preferences follow-up (2026-10-14): appearance previews/copy now match
Argila/Grafite, the dock follows persisted favorites while retaining running apps,
and embedded Store contrast, motion and text scale follow canonical preferences.
51 targeted tests, both builds, reference verification and browser checks passed.
[Evidence](evidence/meridian-integration-2026-10-14/README.md#preferences-consistency-follow-up).

Meridian chrome completion (2026-10-14, user follow-up): the Web now uses the
Meridian context/grouped rail, utility/account footer, persistent Central header
with destination search, and centered icon dock. Desktop keeps the compact rail;
mobile exposes all destinations through its menu and preserves the full work area.
Dock ordering and keyboard navigation retain the existing managed windows, and
Aura/Intelligence labels resolve to one window. The earlier color-only chrome
adaptation is superseded. Mocks and unavailable service states remain explicit.
[Chrome validation](evidence/meridian-integration-2026-10-14/README.md#chrome-completion).

Meridian integration (2026-10-14, explicit subsequent user authorization): the
canonical Web Central now uses the Meridian editorial layout, the existing
alpine hero images, the canonical symbol and the existing account/preferences/
window owners. Planned project, agenda, file and routine examples stay visible
and labelled as mocks, as requested. The Store presentation is shared between
`/store-preview/` and the actual Web Store window, with scoped CSS/session
lifecycle and no iframe or global hash navigation. A ready official catalog
opens in the real view; when the Web transport is absent, the planned view
remains available with a distinct switch to the fail-closed real catalog.
Shared Meridian tokens/style also load in the Native/USB composition and style
its existing Store; Native operations and hardware gates are unchanged.
The older standalone-only scope below records the preceding delivery and is
superseded only as to placement by this explicit integration request.
[Scope and validation](DESKTOP-IDENTITY.md#meridian-web-and-store-integration--2026-10-14).

Store visual preview (2026-10-14, isolated source): `/store-preview/` is an
explicitly requested standalone presentation page under `system/composition/web/`,
using Meridian Argila/Grafite colors and the existing demo catalog/session reducer.
It includes discovery, resource details, library and type-specific simulated
operations. It is not mounted in the production workspace and does not add an
installation port, official inventory or material preference. After explicit user
authorization, 69 targeted automated tests, Web type-check/build, the dedicated
preview build, reference verification and 28 browser checks passed. The preview
build is emitted separately to `out/store-preview`; no production entry is added.
[Validation evidence](evidence/store-preview-2026-10-14/README.md) covers session
mocks and source/build compatibility, not real installation or physical proof.
[Scope and limits](DESKTOP-IDENTITY.md#isolated-store-visual-preview--2026-10-14).

Notification UX (2026-10-13): Web/USB now share the notification center renderer
and CSS. Explicit read/filter/dismiss/Do Not Disturb actions consume the existing
port. Native updater events retain their original runtime/store/bridge owners;
Web has no authorized remote notification adapter and displays that absence
without seeded data or a second service. [Scope and acceptance](DESKTOP-IDENTITY.md#shared-notification-center--2026-10-13).

## Web Intelligence canonical client boundary — 2026-10-13

PR #1756 closes the Phase 1 Web presentation boundary without claiming a remote
inference service. The canonical `Central` composition injects a provider-neutral
client for `ordax.intelligence/1`; `WindowContent` routes Aura/Intelligence to
`AuraContent`, and Surface code owns no endpoint discovery, provider selection,
credentials, Memory policy or execution authority.

The default Web adapter intentionally fails closed with `state=degraded`,
`inferenceAvailable=false`, `authority=none` and `toolExecution=false`. A supported
remote transport, authenticated account/Space context, remote Memory/context
projection and external provider adapters remain separate later gates. The client
keeps semantically unchanged snapshots stable and validates/sanitizes responses
before presentation.

The canonical route passed deterministic Web build and the real Chromium Surface
smoke on the stabilized Phase 1 source head. After that proof, the branch was
synchronized with current `main` and the now-unreachable duplicate Aura branch in
`DesktopContent` was removed with a regression preventing its return. The old
WebShell/session/demo graph remains unmounted and preserved until its deliberate
Phase 5 dependency migration; it is not a second active Web Intelligence path.
## Native Intelligence device-local host bridge - 2026-10-14

The Native side now has a source-complete device-local bridge over the final
`selectedSpaceIntelligence` consumer port. The canonical Native Identity and Space-selection
owners feed `createNativeIntelligenceService`; the existing privileged `ordaxBrowser` WebKit
bridge transports the request to/from JavaScript, while a new private Unix socket at
`/run/ordax-surface/intelligence.sock` is transport-only and mode `0600`. There is no second
Intelligence runtime, model router, Memory owner, provider selector, credential store or action
authority in Python/Surface.

The socket opens only after `intelligence.host.ready`. Surface navigation/reload start closes
the listener and resolves pending requests conservatively as `outcome=unknown`; a fresh ready
signal is required before reopening. The IPC is bounded to 1 MiB per UTF-8 JSON message and
uses independent host nonce + service `requestId` correlation. Unknown outcome is intentionally
not a retry-safe receipt.

This does **not** mean remote Intelligence is live. Runtime/Product routing to the local socket,
Platform capability advertisement, credentialed remote E2E, external provider enablement and
physical Stable/USB proof remain pending. Project context is still rejected on this path.


## Reconciliação dos gates Surface — 2026-10-12

As cinco reprovações de contratos em main 9a84bbd eram expectativas de templates
anteriores aos owners atuais. A primeira correção também revelou a expectativa
obsoleta do texto Ctrl + K no header removido. A marca/sidebar, cada launcher
com nome acessível e o perfil único agora são verificados no markup realmente
gerado em pt-BR/en-US, sem restaurar UI antiga para satisfazer testes.
Paleta e movimento reduzido continuam nos owners canônicos.

A prova de browser da PR #1713 foi reconciliada com a main atual; nenhuma versão
antiga dos arquivos gerados do site ou da UI foi reintegrada. Não foi necessário
aplicar a alteração de produto da PR #1712: a composição atual passou fisicamente
os sete viewports, incluindo compacto mobile selecionado e tiles desktop.
39 testes Node, 44 Python, 34 arquivos/assets de referência, fronteiras de módulos
e a prova de browser Native passaram. Web/USB visual continuam HTTP 200.
Durante a validação outro chat integrou d406116, com o SDK atualizado e as
mesmas correções de provas. Foundation e Surface Web passaram nesse SHA no Linux.
A reconciliação preserva essas mudanças e acrescenta os testes de renderização;
os gates do novo commit continuam distintos das provas da base e das provas locais. Ver [escopo, risco e aceite](DESKTOP-IDENTITY.md#surface-gate-reconciliation--2026-10-12).


A reconciliação também preserva a base 0562491: Gate A remove-first do Assistant
(#1717) e retries de ativação assinada (#1718). Os testes de renderização seguem
os cinco destinos atuais e exigem ausência do atalho Assistant durante o gap;
nenhum source removido ou instalação fictícia é restaurado.

## Alternância Central/Área de trabalho — 2026-10-12

Owner OS Surface; incremento solicitado sobre a sidebar/dock compartilhada.
A largura em tablets/intermediários agora usa o token canônico, retirando a
exceção Web de 185 px. O alternador conserva posição à direita e anuncia o
destino com monitor/grade, usando a mesma política de apresentação no Native
e React. Rótulos Native continuam no catálogo i18n; o controle não é remontado
em cada render. Não altera janelas, sessão, grants ou persistência.
As regressões cobrem destinos inválidos, tradução e troca de ícone somente
quando o destino muda. A prévia USB local continua visual, sem execução Native
ou prova de boot físico. 71 testes Node, 41 Python, TypeScript/build Vite e
verificação de 34 arquivos/assets passaram neste incremento. Os dois hosts
responderam HTTP 200; não houve nova prova interativa de browser ou boot físico.

## Sidebar e navegação Web/USB — SSOT — 2026-10-12

Owner: OS Surface; incremento explicitamente solicitado. sidebar-layout.mjs/css
define slots, encaixe e cartão comuns para React e Native. tokens.css fornece
192/64 px, marca de 36 px e navegação de 40 px (controles de 32 px).
USB não monta header de pesquisa; marca/launcher ficam na sidebar até o rodapé.
Navegação ocupa faixa reservada só na coluna dos apps, sem borda/blur/sombra,
com fundo opaco do app. A troca Central/Área de trabalho fica à direita.

sidebar-account.mjs projeta a sessão pelo contrato Identity existente nos dois
renderers. Logout/perda de capability retiram nome e iniciais antigos. O perfil
abre Conta canônica; notificações Native continuam no controle original, agora
no slot comum. Uso/quota indisponíveis são explícitos: não há plano ou GB fictícios.
Space switcher e energia preservam seus owners Native. Nenhum grant ou sessão nova.

sidebar-hints.mjs/css dá nomes imediatos por pointerover e foco/teclado, com
Escape, limite de viewport e teardown. Sidebar não tem scroll; overflow conserva
launcher/Mais e recupera atalhos ao crescer. Desktop mantém rail sempre recolhido.

69 testes Node e 40 Python passaram, incluindo gaps/overflow, escape de nomes,
logout, Identity, workspace, temas, localização e notificações. TypeScript/build
e fonte de referência verificados. Browser local confirmou ausência de header,
rail até rodapé, nav de 40 px, controles móveis de 44 px, launcher/perfil,
layout sem overflow horizontal e desktop recolhido. Prévia Native é visual;
não comprova boot físico, serviços autenticados de host ou release assinada.

## Ajustes Web e navegação USB — 2026-10-12

Ajustes Web consome settings.css e o catálogo de textos Native diretamente,
com Aparência, Tela e Acessibilidade ligadas ao runtime/store de preferências existente.
Entrada Ajustes na sidebar abre a mesma janela Configurações; o atalho de
engrenagem duplicado foi removido. O painel carrega sob demanda pelo tratamento
de recursos já existente. As outras seções Native dependentes de host não foram
expostas como funções Web disponíveis.

## Ajuste de escala da tela — 2026-10-18

Web e Native/USB compartilham a preferência local **Ajustes → Tela → Escala da interface**.
O modo Automático adapta a escala visual da Surface à largura útil da janela; os tokens
Meridian de geometria e os componentes principais da sidebar, header, dock e janelas usam
essa escala nos dois hosts. A área principal e o hero também respondem a telas ultrawide.
Há opções manuais Compacto,
Padrão, Confortável e Grande. A escolha é persistida no dispositivo e fica fora
da allowlist de sync da Conta. Resolução e frequência física continuam pertencendo ao host:
Web apenas explica esse limite; Native/USB consulta modos reais por um contrato estável e um
adaptador opcional do compositor Wayland. Sem o provedor ou suporte de gerenciamento de saída,
o controle fica indisponível e nenhuma lista fictícia é exibida. O contrato e a UI não dependem
de Alpine; ao trocar a base, o adaptador do host pode ser substituído sem refazer Surface,
preferências ou jornada de Ajustes. A jornada de referência para recursos sem capacidade real
permanece disponível.

workspace/presentation.mjs define uma única política: entrar na Área de trabalho
mantém a sidebar recolhida nos dois renderers, sem expansão; retornar à Central
recupera a apresentação automática e permite expansão manual. Estado é de sessão, sem novo
registro persistido e sem recriar janelas. USB ganhou ícone de perfil no rodapé da sidebar para account/overview pelo
catálogo e caminho de ativação existentes. O acesso na header e o item Conta
duplicado foram removidos. Nomes dos ícones usam tooltips nativos/localizados.

49 testes Node e 36 Python passaram, além de TypeScript/build e verificação de
34 arquivos/assets. Browser: temas, contraste persistido em reload, largura de
64px fixos no desktop, expansão apenas na Central, perfil USB e 390x844 sem overflow
horizontal, inclusive Ajustes compacto. Conta autenticada/hardware e boot físico
não são demonstrados pela prévia local. [Owner e aceite](DESKTOP-IDENTITY.md#shared-settings-style-and-sidebar-policy--2026-10-12).


## Surface Web/USB — cores compartilhadas e desktop nativo — 2026-10-12

Claro/Escuro do Web e OrdaX USB usam um único catálogo de perfis. As cores
standard foram movidas do CSS Web para system/surface/ui/color-palettes.css;
os tokens USB seguem em tokens.css. Os dois renderers consomem a mesma fonte
por aliases sem duplicar paletas. color-palette.mjs e surface.color-palette
substituem o owner Web-only anterior, sem wrapper ou ID alternativo ativo.
appearance.theme permanece light/dark; a nova paleta continua device-local,
fora da allowlist de sync. Web preserva layout e janela; Native Ajustes ganhou
as três opções e miniaturas dos mesmos tokens.

USB agora alterna Início/Central e Área de trabalho pelo botão de quatro quadrados
no dock. Atalhos usam o mesmo catálogo e caminho de ativação; nenhum grant novo.
A apresentação é da sessão; janelas, alvos, geometria e workspace-store/2 não
são recriados nem copiados. Rede, energia, arquivos e composição Native mantêm
seus ports. A prévia local usa stores de navegador e não opera hardware.

56 testes Node e 44 Python passaram (100 distintos). Oito testes de estado
Native foram executados em Ubuntu/WSL com fcntl real, após a incompatibilidade
do Python Windows; sem shim. TypeScript/build e 34 arquivos/assets verificados.
Browser: cinco pares de cores Web/Native, três opções, reload, desktop/retorno,
janela preservada, viewport 390x844 sem overflow horizontal e toggle de 44px.
JS inicial 485,41 kB (151,98 gzip). Boot físico e release assinada não são provas
deste incremento. [Owner e aceite](DESKTOP-IDENTITY.md#shared-color-profiles-and-native-desktop--2026-10-12).

## Web — perfil de cores OrdaX USB — 2026-10-12

Aparência oferece Claro, Escuro e OrdaX USB no mesmo seletor. O terceiro perfil
mapeia variáveis Web diretamente aos tokens Native de tokens.css, sem copiar
cores ou alterar a geometria do layout. O catálogo/runtime/store existentes persistem
surface.web-palette; appearance.theme mantém light/dark e o default light.
A escolha de paleta Web é local, excluída da allowlist de sync; Native ignora
essa preferência e preserva sua composição/contrato de aparência.

44 testes Node e 24 Python passaram, além de TypeScript/build e verificação de
34 arquivos/assets. Browser: três escolhas e reload, igualdade de seis tokens
Web/Native, seletor de 44 px e viewport 390 x 844 sem overflow horizontal,
contraste reforçado com tokens canônicos. JS inicial 485,34 kB (151,98 gzip).
[Owner, escopo, risco e aceite](DESKTOP-IDENTITY.md#usb-color-profile-in-web--2026-10-12).

## Web Central — favoritos compartilhados e persistentes — 2026-10-12

Central e Aplicativos agora usam um único renderer/editor e a mesma preferência
surface.favorite-shortcuts no catálogo/runtime/store existentes. Seleção validada,
lista vazia, foco de retorno e fallback session-only são reais; adicionar atalho
não instala app nem concede acesso. Metadados de targets têm um owner; estado local
de favoritos duplicado na Central foi removido. Sync de conta mantém sua allowlist,
sem enviar essa preferência. Native reconhece o dado, mas não ganhou outro launcher.

35 testes Node e sete de builder passaram; a regressão de sync foi repetida após
incluir a prova explícita de favoritos locais. TypeScript/build e 34 arquivos/assets
verificados. Browser comprovou edição compartilhada, recarga/lista vazia, teclado,
retorno de foco e editor em 390 x 600/844. Erro de HMR observado (raiz React duplicada)
foi corrigido: a composição desmonta sua raiz antes dos ports. Uma atualização limpa
manteve uma raiz, sete favoritos e zero novos erros. Escolhas originais, tema e
viewport restaurados. JS inicial 484,97 kB (151,88 gzip), CSS 81,59 kB.
Gateway autenticado, arquivos/dispositivos e IA continuam pendentes de transporte.
[Owner, risco e aceite](DESKTOP-IDENTITY.md#canonical-favorite-shortcuts--2026-10-12).

## Web Central — seletor do rodapé removido — 2026-10-12

Remoção explicitamente solicitada: seletor inferior de modos da Aura, CSS próprio
e tracks reservados ao footer retirados. Demais controles e serviços preservados.
TypeScript e verificador dos 34 arquivos/assets passaram. Browser em 390 x 600 e
1366 x 768 confirmou ausência do seletor/footer e documento sem overflow; logs
sem erros/avisos. Viewport restaurado. Sem build completo repetido nesta remoção.

## Web Central — compacto com seleção mobile — 2026-10-12

Até 760 px de viewport, o painel compacto apresenta um app por vez, usando toda
a largura disponível. Se há mais de um, o cabeçalho oferece seletor nativo; dock
continua mostrando os apps abertos. Em telas maiores, os mesmos apps continuam
lado a lado, com larguras iguais. A seleção pertence ao desktopReducer existente,
permanece ao abrir um app superior e recupera um app disponível após fechar ou
minimizar o selecionado. Apps ocultos continuam montados, preservando drafts.

Conteúdo compacto usa menos padding e grids pela largura do painel; controles
mobile têm 44 x 44 px. Trocar um painel recolhido preserva esse estado. Browser
comprovou 320 x 568/390 x 844 sem overflow, texto ampliado, três apps desktop com
378 px cada em 1366 x 768, e retenção de draft ao trocar/minimizar/restaurar.
23 testes Node e sete de builder passaram; TypeScript/build e 34 arquivos/assets
verificados. JS inicial 483,08 kB (151,32 gzip); menu avançado permanece sob demanda.
Nenhuma mudança de backend, grants, conta ou execução. [Owner, risco e aceite](DESKTOP-IDENTITY.md#single-mobile-compact-pane--2026-10-12).

## Web Central — menu compacto sob demanda — 2026-10-12

O menu avançado das janelas compactas carrega no primeiro uso de modo compacto,
consumindo os mesmos controles e dispatch do WindowLayer. Falha de recurso fica
isolada ao menu: expandir/fechar continuam disponíveis e não remontam o app.
Carregamento/falha não repetem comandos ou prometem recuperar um import rejeitado.

Build/TypeScript e verificação dos 34 arquivos/assets passaram; 19 regressões de
workspace e sete de builder passaram. JS inicial caiu de 539,52 para 482,31 kB
(10,60%); gzip de 170,34 para 151,17 kB. CSS é idêntico. Sem ajuste de limite, o
aviso de chunk >500 kB deixou de ocorrer; não é prova de tempo de carregamento.
Menu separado: 58,48 kB (19,27 gzip). Browser com bundle de produção confirmou
zero downloads do menu no início e um HTTP 200 ao compactar. HTTP 503 controlado
manteve apps/draft utilizáveis e expansão/minimização/restauração sem novo download.
Fixture/abas temporárias encerradas; host original preservado. Gateway autenticado
continua pendente. [Owner, risco e aceite](DESKTOP-IDENTITY.md#lazy-compact-actions--2026-10-12).

## Web Central — acessibilidade canônica — 2026-10-12

Configurações do Web agora expõe Contraste, Movimento e Tamanho do texto do
catálogo existente. O mesmo runtime/store valida e salva as escolhas; a UI
não cria IDs ou armazenamento novos. A aplicação usa atributos/tokens comuns,
com restauração no teardown. Tipografia relativa mantém os tamanhos padrão e
responde à escala canônica de 100%/112,5%/125%. Política de movimento reduzido
fica em tokens.css, compartilhada com a Surface Native, respeitando também a
preferência do ambiente. Contraste reforçado é opt-in; temas padrão preservados.

15 testes Node e sete de builder Python passaram. TypeScript/build e verificador
de 34 arquivos/assets passaram. Browser comprovou persistência após recarga,
os dois temas, texto ampliado e controles em 390 x 844/480. Duas janelas compactas
mantiveram Configurações sem overflow horizontal (144 px de conteúdo). As escolhas
originais e viewport foram restaurados. JS inicial 539,52 kB (170,34 kB gzip),
com aviso >500 kB preservado. Isso é preferência local, não sync de conta ou
prova de gateway autenticado. [Owner, risco e aceite](DESKTOP-IDENTITY.md#canonical-web-accessibility--2026-10-12).

## Web Central — menu e foco compartilhados — 2026-10-12

Menu de destinos reutiliza o Dialog existente para semântica modal e foco;
overlay e listener global próprios foram removidos. Busca informa resultado
vazio. Central volta ao início, mantendo os apps minimizados e montados. O
gerenciador de janelas existente trata também reabertura do mesmo app; fechar
o menu retorna ao botão de origem ou ao Início se o botão saiu do viewport.
Sem novo serviço, catálogo, store de identidade ou autoridade de execução.

36 regressões de workspace/sessão e sete de localização passaram; build com
TypeScript e verificação de 34 arquivos/assets passaram. A validação local no
navegador foi concluída em mobile curto, mobile alto e desktop: Tab/Shift-Tab,
Escape, clique fora, reabertura e retenção de rascunho passaram. Busca usa label
nativo e o botão de fechar tem área de toque de 44 x 44 px. Menu e controles
couberam nos viewports observados; ao desaparecer o botão de origem, o foco
voltou ao Início. Catálogo/gateway autenticado e dispositivos continuam fora
dessa prova. Bundle inicial: 538,76 kB (170,06 kB gzip), ainda com aviso >500 kB.
[Owner, risco e aceite](DESKTOP-IDENTITY.md#destination-menu-focus--2026-10-12).


## Web Central — Loja canônica e recuperação por janela — 2026-10-12

A janela Loja monta o StoreExperience existente, pelo mesmo catálogo público
ordax.app-store-catalog-port/2. A importação é sob demanda; a composição mantém
o port indisponível quando o host não oferece catálogo. Demonstração continua
explícita e isolada; não representa instalação, grants ou sessão real.
O CSS da Loja foi movido para um único arquivo no componente, com tokens da
Surface e responsividade pela largura da janela. O shell anterior não guarda
uma segunda cópia dos estilos.

Boundary de conteúdo mantém erros dentro da janela. Falhas de recursos têm
diagnóstico tipado e recarga de página somente por ação explícita, com aviso
de perda de rascunhos. Outros erros oferecem reinício apenas do conteúdo local.
A prova de falha constatou que o browser guarda imports rejeitados; não se
promete nova descarga por simplesmente recriar o componente React.
Validação após merge da main: 24 testes Node e oito testes Python passaram;
a última regressão da Loja repetiu seis testes com sucesso. Build/TypeScript e
verificação de 34 arquivos/assets passaram. Em 390 x 844, dois painéis compactos
iguais mantêm os controles da Loja dentro da sua largura útil de 112 px. A
navegação estreita usa as mesmas seções em um seletor nativo. Prova controlada
de recurso HTTP 503 isolou a falha e recuperou a Loja por recarga explícita,
enquanto Ajustes continuou disponível. O bundle inicial final é 537,86 kB
(169,81 kB gzip); a Loja carrega em um chunk separado de 49,59 kB.
Catálogo autenticado, instalação e ativação de produção continuam pendentes.
[Owner, risco e aceite](DESKTOP-IDENTITY.md#canonical-store-window--2026-10-12).

## Web Central — catálogo de boot compartilhado e carregamento inicial — 2026-10-12

Owner: catálogo canônico de localização do OS e composição Web. As quatro
mensagens de boot foram extraídas para system/services/i18n/catalog/boot.mjs;
o catálogo completo importa esses mesmos textos, sem duplicação de português
ou inglês. A composição atual pt-BR importa apenas esse catálogo de dados.
Portas, serviços, idioma atual, rotas, temas e geometria permanecem preservados.

Build local com TypeScript passou: JavaScript inicial de 776,99 para 533,40 kB
(redução de 31,35%); gzip de 220,94 para 167,96 kB. O CSS emitido é idêntico.
Ainda existe aviso acima de 500 kB; não foi elevado o limite nem alegada uma
medição de tempo de carregamento. Mais 18 testes de tradução e sete de builder
passaram. Verificador de 34 arquivos/assets passou após corrigir o checksum
registrado com quebra de linha Windows para o formato LF canônico.
Browser recarregado: Central preservada, sem entradas de erro/aviso nos logs.
A validação autenticada com gateway real continua pendente.

Testes/builds foram locais, sem deploy Vercel. A configuração existente para
ignorar builds públicos não afetados foi apenas consultada. Uma revisão automática falhou por limite de uso; a janela de retomada
passou e o envio agrupado será revalidado com a main. Nenhum gate foi contornado.
[Evidência e comparação](evidence/web-central-reference-2026-10-11.json).

## Web Central — consultas de conta canceláveis e limitadas — 2026-10-12

Identidade e catálogo de Spaces reutilizam um único transporte JSON GET nos
adapters Web, com credenciais same-origin, no-store, redirects recusados e
prazo de 10 segundos incluindo a leitura do corpo. Reset, supersessão e
descarte encerram a espera mesmo se o transporte não respeitar AbortSignal.
Desconexão cancela a consulta de identidade sem alterar a última sessão
conhecida; reconexão pode iniciar nova leitura sem aguardar a resposta antiga.
Ordinais e validações dos adapters continuam sendo a autoridade de publicação.
Timeout real mantém os estados indisponível/erro, sem simular logout.
Snapshots de identidade/comandos permanecem estáveis quando não mudam; portas
descartadas não retêm novos assinantes nem iniciam comandos/consultas.
Layout e serviços pendentes permanecem preservados. Validação local autorizada
em 2026-10-12: 64 testes passaram; build com TypeScript e verificação de 34
arquivos/assets passaram. Browser conferido em 390 x 844, 768 x 600 e
1366 x 768, incluindo temas, viewport, compacto, minimizar e restaurar pelo dock.
Não houve mudança de source funcional nesta rodada de validação.
Gateway autenticado não está configurado neste Vite local: o fluxo com conta,
Spaces e dispositivos reais permanece pendente. Bundle inicial de 776,99 kB
(220,94 kB gzip) gerou aviso de desempenho; testes não provam prontidão de release.
[Evidência datada](evidence/web-central-reference-2026-10-11.json).
[Owner, risco e aceite](DESKTOP-IDENTITY.md#web-account-bounded-read-lifecycle--2026-10-12).


## Web Central — conectividade pelo host canônico — 2026-10-12

A UI assina ordax.surface-host/1, com snapshots estáveis e sem store paralelo.
O sinal offline do navegador bloqueia ações de conta e novas consultas, aborta
o catálogo de Spaces pela porta existente e invalida o contexto até revalidar.
Reconexão retoma somente consultas; comandos não são repetidos. Uma reconexão
durante uma consulta anterior solicita nova leitura ao terminar essa consulta,
suprimindo resultados antigos pelo ordinal canônico do catálogo. A última
identidade conhecida permanece identificada como possivelmente desatualizada.
Conectividade desconhecida não é apresentada como offline. O sinal online
não comprova acesso ao gateway, computador ou serviço remoto.
Layout, temas, sidebar, dock e lifecycle de janelas foram preservados.
Casos de regressão foram atualizados no source/CI; sem build, npm, testes,
typecheck ou browser locais.
[Owner, risco e aceite](DESKTOP-IDENTITY.md#web-central-canonical-connectivity--2026-10-12).


## Web Central — preferências canônicas de aparência no source — 2026-10-12

Tema da Central/Desktop e Ajustes usa ordax.preference-runtime/1 com o catálogo
existente e o adapter ordax.preference-store/1. A UI não lê/grava localStorage
nem mantém uma segunda escolha de tema. Inicialização recupera valores válidos;
falha de persistência mantém a escolha na sessão com aviso em Ajustes. Temas,
paisagens, cores e geometria aprovados foram preservados. Central/Desktop
continua sendo estado de apresentação da sessão, separado das preferências
da conta. Persistência é local ao navegador; sync cloud e E2E não foram ativados.
Casos de regressão foram acrescentados no source, sem execução de build, npm,
testes ou browser por restrição do usuário.
[Owner, risco e aceite](DESKTOP-IDENTITY.md#web-central-canonical-appearance-preferences--2026-10-12).

## Web Central — integração de conta e Spaces no source — 2026-10-12

A composição Web reutiliza os adapters existentes de sessão, comandos de
identidade e consulta de Spaces no mesmo contexto da Central/sidebar.
Nome e ações vêm da sessão validada; Spaces só é consultado com conta
autenticada. Logout/troca de sujeito limpa catálogo e contexto local anterior.
Geometria responsiva, temas, dock e janelas permanecem no owner existente.
Dados fictícios de plano/cota, projetos, atividade e dispositivos foram
substituídos por estados honestos nos mesmos cards/destinos. Os transports
desses serviços continuam pendentes. A seleção explícita de Space agora usa
ordax.space-selection/1 e o mesmo serviço de domínio do Native, com registro
somente em memória da sessão Web. A escolha é revalidada pelo catálogo,
limpa em logout/troca de conta e removida se o Space desaparecer/for arquivado;
não é persistência cloud, grant ou ativação de serviço.

Fonte conectada aos contratos não comprova gateway ativo, implantação nem
E2E autenticado. No preview Vite sem rotas same-origin de conta, a interface
permanece indisponível. Testes adicionados/ajustados apenas no source;
build, npm, testes e browser não executados por restrição explícita do usuário.
[Owner, contratos, risco e aceite](DESKTOP-IDENTITY.md#web-central-account-and-spaces-binding--2026-10-12).

## Web Central principal — 2026-10-11

Incremento de janelas: Central e Desktop agora compartilham o lifecycle ativo de minimizar, compacto, recolher, expandir, maximizar/restaurar e fechar. Instâncias e rascunhos permanecem montados durante essas transições; no mobile, compacto reserva a metade inferior do viewport. Backend e validação automatizada continuam pendentes. [Owner, risco e aceite](DESKTOP-IDENTITY.md#shared-central-window-lifecycle--2026-10-11).

Pedido explícito do usuário: promover a referência `ordaxsystems/lovable-core-ui`
(`89438133b322e3ef87e862c80af3a3dbe18251f5`) à página Web principal. A entrada
canônica monta somente `Central`; não há rota alternativa, redirect ou montagem
da Home/WebShell anterior. Central e área de trabalho clássica compartilham
dados de apresentação, componentes e temas claro/escuro da referência.

Serviços, Native e Conta pública permanecem sob seus owners. Dados da referência
estão identificados como demonstração; conexão ao backend é a etapa seguinte.
Componentes de aplicativos e estado de janelas existentes foram preservados
após rejeição automática da exclusão ampla. Nenhum build de produção, comando
npm ou teste local foi executado, por restrição explícita do usuário. Fonte e
checks atualizados não equivalem a release ou implantação comprovada.
Owner, limitações e proveniência: [Desktop Identity](DESKTOP-IDENTITY.md#canonical-web-central--2026-10-11).
As notas anteriores sobre Home, dock, panes e navegação Web abaixo ficam
substituídas por essa decisão; seus consumidores de serviços continuam em source.

## Stable v4 — handoff assinado validado, publicação pendente (2026-10-11)

A candidata congelada `03f88eeaf382a59aaefbcf4943d0639d2730741b` passou no workflow oficial [Canonical v4 Signed Handoff Proof, run 38156353913](https://github.com/ordaxsystems/ordax-os/actions/runs/38156353913). A suíte Go completa executou com sucesso em Ubuntu 24.04 na revisão exata; o verificador Windows executou Step 5 e confirmou a assinatura Ed25519, a igualdade byte a byte do payload/manifesto e os hashes e tamanhos reais dos três EROFS. Recibo `prototype-ordax.portable-v4-signed-handoff-verification/1` baixado e conferido: os três indicadores de assinatura, payload e artefatos são `true`, enquanto `release_published`, `release_activated` e `physical_write_performed` são `false`.

O erro de CRLF do checkout Windows foi corrigido pela PR #1656; a separação entre teste de materialização Linux e verificador Windows pela PR #1657. Ambos os arquivos e checks pertencem à `main`, sem mudança dos bytes assinados, do manifesto ou da custódia da chave. Evidências detalhadas: [registro de handoff e correções](evidence/canonical-v4-signed-handoff-git-bytes-2026-10-11.md).

**Bloqueio operacional seguinte:** a candidata ainda não tem os três EROFS e o envelope publicados juntos por HTTPS canônico. Sem a publicação verificada não existe recibo válido de materialização pelo release-agent, portanto `canonical_v4_release_proof_bound=false` e `physical_write_allowed=false` permanecem. Autorizar um USB físico, executar boot e provar rollback são gates distintos e ainda pendentes. Esta prova não lança a release Stable.


Web layout: full-height desktop sidebar and centered floating app dock replace the full-width footer strip; mobile navigation remains unchanged. Owner/acceptance: [Desktop Identity](DESKTOP-IDENTITY.md#full-height-sidebar-and-floating-dock--2026-10-11).


## Web navigation utilities — 2026-10-11

Source preview moves shell search/profile/notifications to shared navigation chrome (desktop sidebar search/profile/notifications; mobile Menu; no Web clock). Apps occupy the top edge; only safe area/sidebar/bottom navigation remain outside. Existing reducers, dialogs and app instances are retained. Services and release gates are unchanged. Acceptance and risks: [Desktop Identity](DESKTOP-IDENTITY.md#system-utilities-in-navigation--2026-10-11).


## Web app opening — 2026-10-11

New and detached app windows open maximized across the workspace, outside the
shared header/sidebar/navigation. Page entries use the full content area. The
existing reducers preserve user-selected normal geometry, compact layouts and
mounted app state; isolated stacking keeps the latest app above older windows
without saturating focus order. No pending service port is activated.
Owner, risks and acceptance: docs/DESKTOP-IDENTITY.md.

## Web mobile usability — 2026-10-11

The canonical workspace now shares its navigation component between the desktop
sidebar and a scrollable mobile Dialog. Bottom navigation reflects the active
area, app switching closes the overview, window actions remain reachable through
the existing menu, and narrow File views retain grid/list controls. Mobile text,
search fields and touch targets are enlarged without duplicating state or
service authority. Menu and launcher headers/close stay visible while content
scrolls; the launcher avoids forced keyboard focus for coarse-pointer devices
and exposes clear-search, filter state and no-results feedback. Home now follows the user-provided responsive HTML structure through one
React composition and the existing tokens/catalog: one-column mobile content,
3/2-column app grid, environment shortcuts, projects and activity. The touch
shell boundary is 820 px; prototype scripts and illustrative data are excluded.
Home scrolls in the primary pane and preserves its shared Intelligence draft.
Bottom navigation follows Início, Aura, Apps, Space and Menu. Aura reuses
Intelligence; the existing window overview remains available within Menu.
Split-pane geometry and mounted app state are preserved.
Owner, dependencies, risks and browser acceptance: docs/DESKTOP-IDENTITY.md.
This remains a Web presentation candidate; pending service integrations are
unchanged.

## Web compact panes — 2026-10-11

The canonical Web workspace now reserves two responsive tracks for primary
content and compact windows. Floating apps fit the primary pane rather than
covering the carousel. Collapsing releases its content space; no compact windows
means no reserved row. App nodes remain mounted across mode changes. Owner,
dependencies, risks and browser acceptance: docs/DESKTOP-IDENTITY.md. This is a
Web source/candidate change; Native and production activation are independent.

## Web Store catalog presentation — 2026-10-11

Store now consumes the existing authority-free catalog port through one React
presentation. It opens in official mode; demonstration requires an explicit
action and is disposed when leaving it. The local AI candidate comes from the
OS source-lock/generated catalog. Snapshot revocation or invalidation clears
old entries. Web transport and real lifecycle remain unavailable; no package
installation, authenticated catalog or model compatibility is claimed.
Owner, public dependencies, risk and acceptance: docs/STORE-WEB-CATALOG-PRESENTATION.md.


## Canonical Web presentation cutover — 2026-10-10

The approved workspace presentation lives under system/surface/workspace and
uses the official Web build. One composition, one root dependency lock and
shared symbol/font sources remain, with no evaluation route or redirect.
Pending app interfaces are preserved. Real service wiring is the next phase:
presentation asserts no authenticated session, user files, inference, sync,
package installation or remote-device access. Native operational UI, services,
contracts and public Account are preserved. See docs/DESKTOP-IDENTITY.md and
migration ledger 007. This is a source/candidate change, not production activation.



## Stable v4 — candidata 03f88eea assinada offline, sem publicação (2026-10-11)

A nova candidata de lançamento foi congelada no SHA
`03f88eeaf382a59aaefbcf4943d0639d2730741b`, em
`release-candidate/<SHA40>`. Os três builds oficiais do mesmo commit
concluíram com sucesso, o builder canônico reconstruiu o pedido ativo e a
montagem não assinada [run 38127644552](https://github.com/ordaxsystems/ordax-os/actions/runs/38127644552)
verificou os artefatos e produziu o pacote público pequeno. No computador
autorizado, os 11 hashes do kit passaram, a assinatura Ed25519 foi gerada com
a chave em custódia local, o verificador conferiu a confiança pública e o
payload assinado corresponde aos bytes do manifesto v4.

`CANONICAL_V4_OFFLINE_SIGNATURE=PASS_VERIFIED_NOT_PUBLISHED`.
Faltam a conferência dos três EROFS do handoff, a publicação HTTPS
controlada dos bytes exatos, materialização, prova física atual e o gate
do Creator público. Nenhum USB foi selecionado, autorizado ou gravado.
A evidência exata está em
[canonical-v4-offline-signing-2026-10-11.md](evidence/canonical-v4-offline-signing-2026-10-11.md).
A assinatura histórica abaixo continua válida somente para seu commit antigo.

## Canonical v4 — assinatura offline verificada, ainda não publicada (2026-10-10)

O candidato v4 com origem congelada em `6128e2c` passou nos três builds de
operador (sistema, Surface e IA local), com artefatos de 14 dias e validação
real dos IDs/recibos pela API do GitHub. A montagem **não assinada**
(run `38031520848`) foi aprovada. O runbook local de assinatura Ed25519
produziu um envelope que passou em **dois verificadores canônicos** e cujo
payload corresponde byte a byte ao manifesto v4. A chave privada permaneceu
fora do repositório e do pacote. Evidência objetiva:
`docs/evidence/canonical-v4-offline-signing-2026-10-10.md`.

**Não confundir com release pronta:** o envelope ainda não foi publicado,
os três EROFS não foram materializados/verificados juntos no destino e não
houve nova prova v4 de release publicada nem boot atual de USB. O Windows
possui somente disco interno com ~5,2 GiB livres em C:, insuficiente como
área de trabalho confortável para cópias grandes; nenhuma gravação física
foi autorizada ou executada. O gate jurídico é independente deste caminho.


## Development vs. public legal attestation — 2026-10-10

The canonical `MVP.md` and
`docs/contracts/public-legal-readiness.json` now distinguish **source
development and integration** from **publication of an online Account flow**.
The public-site candidate and all OS/USB/Native/Apps/Studio/Runtime builds do
not require live legal-policy attestation to proceed. The separate
`public-legal-integrity` workflow still runs strict production attestation on
its schedule or when manually requested. The active policy's published HTML
digest mismatch remains a **public signup/release** issue, not a gate on
source/CI or offline USB development. See `docs/PUBLIC-LEGAL-READINESS.md`.

The identity entry contract no longer carries the retired
`supabase_candidate` project: its sole provider destination owner is
`infra/supabase/product/account_destination_migration_plan.json`
(`ordax-platform`). Runtime policy state is verified live; three stale
source-level false values for policy activation/visibility were removed.
This changes **no authentication credentials, tables, real user records,
legal receipts or public-account activation flags**.


## Public deployment proof — 2026-10-10

`ordax.com.br` serves the public portal deployed from `7d5b4d4` (production
Vercel deployment `dpl_GFtqgXd9TTbfz7QeDN5eh3i9vK7J`, `READY`) with the
verified account dashboard visual fixes and browser-side registration digest
gate. The delivered `/assets/site.js` was independently fetched over HTTPS
and confirmed to include the SHA-256 check for both published legal pages.
Anonymous HTTPS proof uses the shared SSOT state machine with four
explicit states: `gated`, `disabled-unconfigured`, `auth-only`, and `full`. The observed production state
is **`auth-only`**: a real anonymous Supabase-backed session and active
registration policy are reachable through same-origin, while full public
Account activation, cloud sync and password recovery remain **unavailable**.
The public config explicitly keeps `account_activation_ready=false` and
`auth_only_source_enabled=true`. A denied, unchallenged recovery POST is not an
end-to-end recovery proof. Current legal policy in canonical Supabase is active
(version `2026.10.09`); older policy readiness booleans require owner-level
reconciliation. **Legal integrity remains a blocking production defect**:
server-owned active document digests for both legal pages differ from the
published HTML; the strengthened deployment proof now fails closed. See
`docs/evidence/public-legal-integrity-2026-10-10.md` for sanitized hashes,
record counts and the non-destructive remediation path. The browser registration
form now also checks the exact published HTML of both policy documents using
SHA-256 before exposing the consent/submit controls; login is not coupled to
this check. This is defense in depth, **not** a replacement for server policy
reconciliation. No credentialed E2E,
USB physical proof, signed Creator publisher or public Stable release has
been established by this site proof.

## USB source ownership reconciliation — 2026-10-10

`docs/contracts/physical-write-authorization.json` now names the canonical
`ordaxsystems/ordax-os` repository rather than the historical pre-transfer
owner. The previous canonical-v4 release envelope URL remains unchanged as
historical signed provenance. This is **metadata reconciliation only**:
`physical_write_allowed=false`, `explicit_owner_authorization=false`,
`authorization_context_sha256=null`, and
`canonical_v4_release_proof_bound=false` still apply. The read-only operator
checker remains `blocked`, with unresolved release bindings and physical
consent; public Creator Authenticode identity/custody is still unconfigured.
No USB media was attached to the tested Windows host; no disk write occurred.


## Public account and Web entry — 2026-10-09 source candidate

The public portal now has a responsive My account overview at `/conta/` and a
separate `/web/` entry.

The account concept now uses the user-approved transparent ribbon, OS landscape and Inter through
the canonical brand build. Symbol presentation is now shared with all public headers
through the single Surface `brand/symbol.css` owner; legacy CSS drawings are removed. It includes responsive service sections, search,
deep links, keyboard focus and mobile navigation. Plan names are derived from
entitlements; locale uses the existing portal owner. These are presentation
capabilities, not activation of billing, profile editing or device control.
The overview now follows the approved compact desktop/mobile viewport composition;
session controls use a native disclosure and mobile search opens on demand.
The existing isolated browser gate verifies five actual viewports and keyboard
interaction in Public Site CI, with rendered screenshots retained as evidence.

Account data comes only from the existing verified
same-origin session; native sign-out remains unchanged. Back navigation clears
personal data and launch links before revalidation. Plans/storage/devices show
availability without fabricated usage, permissions or assigned subscription.
Web launch requires verified identity and a configured, owner-approved product
destination. Configuration and contract keep the actual Web runtime disabled;
no hosted Surface, public identity activation or live account E2E is implied.
See `docs/PUBLIC-SITE.md` for ownership, acceptance and remaining gates.

## Studio Web availability — 2026-10-09 source candidate

The historical Studio host panel was removed from OS app source and built-in shortcuts on 2026-10-23. The portable product belongs to ordaxsystems/ordax-apps and is not yet installed by the OS. Shared host contracts may remain for future verified integration; no bundled Studio UI is active.


## Surface visual identity — 2026-10-09 source candidate

Midnight (dark) and Ice (light) implement the approved ribbon/blue-violet visual direction in the shared Surface tokens/composition. The approved transparent ribbon PNG and its canonical presentation stylesheet are shared by the shell, loading screen and public headers; the generated landscape is a local offline asset with recorded provenance. Navigation, command search, Home shortcuts and the floating dock retain canonical state owners; Settings previews use the same tokens and the existing `appearance.theme` owner. Light remains the default, and preference persistence, accessibility and account-sync authority are unchanged. See [DESKTOP-IDENTITY.md](DESKTOP-IDENTITY.md) for scope, acceptance and ownership. This source candidate does not activate a production release or establish physical-media evidence.

Status date: 2026-09-30

This is the canonical handoff snapshot. Architecture/contracts win if another document conflicts with it. Detailed historical evidence remains under `docs/evidence/`; this file records the current boundary without treating CI proof, development-hardware proof and product-release authorization as interchangeable. Values that mirror structured source — including product/app versions, component release modes and physical-media geometry — are regression-checked against their owners so this snapshot cannot silently drift from the implementation.

## First-party utility Store policies (2026-10-08)

The first-party delivery policy additionally recognizes twelve optional utility app IDs from `ordaxsystems/ordax-apps` as `on-demand/store-only`. This is **metadata/presentation policy only**: a future verified signed catalog may project them, but no app becomes installed, launchable or production-installable from metadata alone. Initial USB MVP scope and on-demand boot policy remain unchanged; Native Store lifecycle executor and public Store UI remain disabled until separate trust, lifecycle and release gates are proven. The source, G0 package inventory and public App SDK contracts retain their respective canonical owners.

## MVP current release activation (USB) and integrated-development scope (USB + Native target)

```text
MVP_PUBLIC_EXECUTION_MODE=USB_ONLY
MVP_NATIVE_INSTALLATION_AVAILABLE=NO
MVP_INTERNAL_DISK_DESTRUCTIVE_WRITE=NO
MVP_INTEGRATED_DEVELOPMENT_SCOPE=ALL_SUBSTANTIVELY_STARTED_CAPABILITIES
NATIVE_MVP_DEVELOPMENT_TARGET=YES
NATIVE_FOUNDATION_RETAINED_FOR_MVP_INTEGRATION=YES
MVP_BILLING_IMPLEMENTED=NO
MVP_PRICING_DEFINED=NO
MVP_PLAN_STRUCTURE_DEFINED=YES
MVP_PLAN_IDS=free,personal,professional,team
MVP_PAID_PLANS_PURCHASABLE=NO
MVP_DEFAULT_PLAN=free
MVP_ACCOUNT_OPTIONAL=YES
MVP_ACCOUNT_SIGNUP_LOGIN_REQUIRED_IF_CHOSEN=YES
MVP_COMMERCIAL_DEVICE_LIMIT_DEFINED=NO
WEB_MOBILE_SYNC_PUBLIC_STATUS=COMING_SOON_ONLY
OPERATIONAL_REALTIME_CONTRACT=PASS_SOURCE_RUNTIME_DISABLED
ORDAX_OPERATIONAL_REALTIME_PUBLIC=NO
ORDAX_DEVICE_ACTIONS_PUBLIC=NO
ORDAX_MOBILE_ADAPTER_STATUS=ARCHITECTURE_ONLY
ORDAX_ANDROID_APK_IMPLEMENTED=NO
ORDAX_MOBILE_COMPANION_CONTRACT=PASS_SOURCE_RUNTIME_DISABLED
ORDAX_PHONE_CAMERA_AS_WEBCAM_IMPLEMENTED=NO
ORDAX_PHONE_MIC_AS_INTELLIGENCE_INPUT_IMPLEMENTED=NO
ORDAX_DEVICE_LOCATOR_IMPLEMENTED=NO
ORDAX_EDGE_RUNTIME_CONTRACT=PASS_SOURCE_RUNTIME_DISABLED
ORDAX_EDGE_RUNTIME_PUBLIC=NO
ORDAX_PRODUCTION_REQUIRES_USER_NOTEBOOK_ON=NO
```

Native contracts, Creator Core, LUKS2/Btrfs work, Native initramfs, ESP and disposable proofs remain valid engineering foundation, but they do not block or appear as user-facing MVP functionality.

## Autoridade de repositório (reconciliada em 2026-10-09)

O bloco `## Repository` abaixo reflete agora o owner canônico real, conforme
`docs/contracts/repository-ownership.json` e `docs/contracts/repository-migration-status.json`.
A linha `Status date` no início identifica a data do snapshot histórico geral:
não certifica, sozinha, todas as demais capacidades ali descritas como atuais.
Os antigos slugs `washingtonmsdj/prototipo-ordax-os` e
`ordaxsystems/prototipo-ordax-os` permanecem válidos exclusivamente como
proveniência da transferência/renomeação, não como autoridade operacional.
Uma Stable pública assinada não é inferida do nome final do repositório;
seus gates de publicação e hardware continuam independentes.

## Repository

```text
REPOSITORY=ordaxsystems/ordax-os
ROLE=OFFICIAL_ORDAX_OS
DEFAULT_BRANCH=main
PROMOTED_TO_OFFICIAL=YES
LEGACY_REPOSITORY=washingtonmsdj/novo-ordax-os
LEGACY_REPOSITORY_IS_REFERENCE_ONLY=YES
GIT_MAIN_IS_SOURCE_AUTHORITY=YES
USB_IS_SOURCE_AUTHORITY=NO
```

## Product model

```text
ONE_PRODUCT=YES
MODES=WEB,MOBILE,DESKTOP,USB,NATIVE_DISK
ONE_ACCOUNT_MODEL=YES
ONE_SURFACE_SOURCE=YES
CAPABILITY_DIFFERENCES_VIA_ADAPTERS=YES
SYSTEM_ENTRYPOINT_IMPLEMENTED=YES
SURFACE_BOOTSTRAP_RUNTIME=YES
GRAPHICAL_SURFACE_SOURCE=IMPLEMENTED
SHARED_WORKSPACE_WINDOW_MODEL=IMPLEMENTED
FIRST_PARTY_APP_REGISTRY=SETTINGS,ACCOUNT,STORE,SYSTEM
DEVICE_AGENT_PRODUCT_NAME=OrdaX_Device_Agent
DEVICE_AGENT_FOUNDATION=PASS_SOURCE_CONTRACT
DEVICE_AGENT_PROJECTS_CAPABILITY_READER=PASS_SOURCE_READ_ONLY_NO_EXECUTE
DEVICE_AGENT_RUNTIME_IN_PRODUCT=DEFERRED_POST_MVP_FULL_RUNTIME
DEVICE_AGENT_HISTORICAL_INCUBATION_REPOSITORY=washingtonmsdj/mcp-blender
DEVICE_AGENT_CONTROL_PLANE_BACKEND=ordax-control-plane
DEVICE_AGENT_CONTROL_PLANE_AUTHORITY=SHARED_BACKEND_SEPARATE_PRODUCT_AND_DEVELOPMENT
DEVICE_AGENT_DEVELOPMENT_CREDENTIALS_VALID_FOR_PRODUCT=NO
DEVICE_AGENT_PRODUCT_CREDENTIALS_VALID_FOR_ENGINEERING=NO
DEVICE_AGENT_DEVELOPMENT_ADAPTER_BACKEND=APPLIED_BLENDER_V1
DEVICE_AGENT_GITHUB_OIDC_ENROLLMENT=DEPLOYED_V1
DEVICE_AGENT_EXISTING_TOKEN_IDENTITY_RECOVERY=DEPLOYED_V1
DEVICE_AGENT_WINDOWS_V2_ENROLLMENT_PROOF=PENDING_LOCAL_RECOVERY_EXECUTION
DEVICE_AGENT_CERCO_PROJECT_REGISTRATION=PENDING_LOCAL_RECOVERY_EXECUTION
PROJECTS_EXTERNAL_AI_ACCESS=GITHUB_DIRECT_PLUS_ORDAX_MCP
ORDAX_WEB_DEVICE_CONTROL=PASS_SOURCE_SHARED_ACTION_CONTRACT_RUNTIME_DISABLED
SETTINGS_VISIBLE_LABEL=AJUSTES
SURFACE_HOME_TECHNICAL_UPDATE_MARKERS=REMOVED
PRODUCT_VERSION=0.1.0
PRODUCT_VERSION_LABEL=v0.1.0
PRODUCT_MATURITY=PROTOTYPE
PRODUCT_V1_RESERVED_FOR_STABLE_RELEASE=YES
FIRST_PARTY_APP_VERSIONING=PER_COMPONENT
FIRST_PARTY_APP_PRE_1_0_MATURITY=BETA
APP_SETTINGS_VERSION=0.1.0
APP_SETTINGS_MATURITY=BETA
APP_SETTINGS_RELEASE_MODE=bundled
APP_ACCOUNT_VERSION=0.1.0
APP_ACCOUNT_MATURITY=BETA
APP_ACCOUNT_RELEASE_MODE=bundled
APP_STORE_VERSION=0.1.0
APP_STORE_MATURITY=BETA
APP_STORE_RELEASE_MODE=bundled
APP_SYSTEM_VERSION=0.1.0
APP_SYSTEM_MATURITY=BETA
APP_SYSTEM_RELEASE_MODE=bundled
INTERNET_GATE_A=PLATFORM_SOURCE_REMOVED
INTERNET_PORTABLE_SOURCE=CANONICAL_IN_ORDAX_APPS
INTERNET_DISTRIBUTION_ENABLED=NO
APP_NOTES_DELIVERY=ON_DEMAND_STORE_ONLY
APP_NOTES_PORTABLE_SOURCE=CANONICAL_IN_ORDAX_APPS
APP_NOTES_LOCAL_PAYLOAD=ABSENT_CANONICAL_SOURCE_EXTERNALIZED
ASSISTANT_PORTABLE_SOURCE=CANONICAL_IN_ORDAX_APPS
PROJECTS_PORTABLE_SOURCE=CANONICAL_IN_ORDAX_APPS
ACTIVITY_PORTABLE_SOURCE=CANONICAL_IN_ORDAX_APPS
NETWORK_PORTABLE_SOURCE=CANONICAL_IN_ORDAX_APPS
FILES_PORTABLE_SOURCE=OS_SOURCE_REMOVED_EXTERNAL_PACKAGE_PENDING
STUDIO_PORTABLE_SOURCE=CANONICAL_IN_ORDAX_APPS
STUDIO_OS_INTEGRATION=OS_BUNDLED_SOURCE_REMOVED
PRODUCTION_INDEPENDENT_APP_UPDATES_ENABLED=NO
SYSTEM_UPDATE_SCOPE=BASE,SURFACE,SERVICES,SYSTEM
APPLICATION_UPDATE_SCOPE=OPTIONAL_VERIFIED_COMPONENT_SLOTS
UPDATE_HUMAN_IDENTITY=DELIVERY_NUMBER
UPDATE_PR_NUMBER_IS_PRODUCT_IDENTITY=NO
UPDATE_RUNNING_LABEL=EM_EXECUCAO
WEB_CLIENT_CANDIDATE=PASS
APPEARANCE_THEME_VALUES=DARK,LIGHT
SURFACE_ACCESSIBILITY_PREFERENCES=CONTRAST,MOTION,TEXT_SCALE
SURFACE_TEXT_SCALE_VALUES=STANDARD,LARGE,EXTRA_LARGE
APPEARANCE_PERSISTENCE=WEB_LOCAL_PASS
APPEARANCE_ACCOUNT_SYNC=PASS_SOURCE_WEB_PUBLIC_ROLLOUT_GATED
NATIVE_GRAPHICAL_HOST=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_PRIMARY_INPUT=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_POWER_RESTART=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_POWER_SHUTDOWN=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_GIT_HOT_UPDATE=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_UPDATE_SELF_HEALING=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_GUARDIAN_SUPERVISOR=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_RESCUE_CHANNEL=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_TELEMETRY_RELAY=PASS_PHYSICAL_DEVELOPMENT_USB
NATIVE_CANDIDATE_PREFLIGHT_SUCCESS_PATH=PASS_PHYSICAL_DEVELOPMENT_USB
CANONICAL_TRUST_TOOLKIT_REQUIRES_PORTABLE_ONE_SHOT_PROOF=YES
CANONICAL_TRUST_TOOLKIT_PROVENANCE_ELIGIBLE=YES
CANONICAL_TRUST_TOOLKIT_SOURCE_COMMIT=2172eb6a18430910afd036199ec492ad63dc185d
CANONICAL_TRUST_TOOLKIT_WORKFLOW_RUN_ID=35617567458
CANONICAL_TRUST_TOOLKIT_ARTIFACT_SHA256=cb8232d20a9cdbaa81e73d55b52e2d6047b3b800a06a73a14869e6dc2245af31
CANONICAL_TRUST_TOOLKIT_LOCAL_PREFLIGHT_EXECUTED=YES
PORTABLE_COLD_HEALTH_PROOF_SCOPE=PHYSICAL_STABLE_MVP_REQUIRED_NO_SYNTHETIC_CI
CANONICAL_KERNEL_ACPI_BATTERY_SUPPORT=EXPLICIT
CANONICAL_KERNEL_SYSRQ_RESTART_FALLBACK=EXPLICIT
REAL_SYSTEM_BUNDLE_REPRODUCIBLE=PASS
GRAPHICAL_SURFACE_COMPLETE=NO
CANONICAL_SYSTEM_RUNTIME_COMPLETE=NO
```


The canonical prototype trust ceremony and public handoff are complete. The eligible toolkit bound to `2172eb6a18430910afd036199ec492ad63dc185d` passed read-only preflight; canonical Ed25519 key material was generated locally, independent public derivation matched, the proof signature passed, recovery was verified from a distinct restored copy, and the recovered signing envelope passed public verification. The exact public anchor is pinned in Git and the minimal-bootstrap trust binding remains resolved. An earlier owner authorization existed for the first Stable/MVP USB proof, release sequence 1, but it was bound to a previous physical-writer context and is no longer valid after the writer changed. On 2026-09-26 the owner-controlled v4 candidate was signed and published as a prerelease, then materialized and verified from its exact versioned HTTPS URL in CI run `36234573905`; aggregate proof SHA-256 `2dd17580ddbf5a0fd0433a912e97e6bded04fd0a44ea0849e9da15e13df01e4b` is bound in the repository. This prerelease did not become GitHub's stable `latest` release. The authorization contract is now `blocked-explicit-physical-authorization-pending`, with `physical_write_allowed=false`, `explicit_owner_authorization=false` and no authorization-context hash. A fresh explicit owner authorization must be recorded against the current writer context before any destructive physical flow becomes eligible. No target-specific consent has been recorded and no USB is selected or authorized for a new write; live target revalidation, Windows UAC and target-specific destructive confirmation remain separate later gates. The local PEM remains a controlled prototype signing backend rather than the intended long-term production custody model; independent off-device custody and managed non-exportable KMS/HSM remain broad-distribution hardening requirements, with signed trust rotation required before broad public distribution.

The first formal human product version is **OrdaX Prototype v0.1.0**. Product version, Entrega, Git SHA and app SemVer are separate identities; first-party apps on the 0.x line are Beta, and a component version does not imply an independent update channel. Source ownership is now: Internet, Assistente, Projetos, Atividade, Rede and Notas in `ordax-apps`; Arquivos had its bundled product source removed on 2026-10-23; the OS retains File Space services and verified-slot host contracts, with external installation still gated by signed packages and health/rollback proof; Studio has portable product source in ordax-apps, while the OS-local git-app integration was removed on 2026-10-23; future activation requires a compatible signed external package. Loja, Ajustes, Conta and Sistema remain structural OS surfaces. Product v1.0 remains reserved for the stable product.

`system/` is the shared product source. The native development path is physically proven through `system/entrypoint (guardian) -> system/supervisor -> system/surface/entrypoint -> system/surface/bin/ordax-surface`; repository CI also proves that the actual `system/` tree can be bundled deterministically as `system.tar`.

The shared graphical source remains under `system/surface/ui/` with platform-neutral contracts, workspace/window lifecycle and capability-driven app availability. Projetos remains a first-party product with canonical portable source in `ordax-apps` and no bundled app source in the OS; verified package installation remains gated. It consumes the existing neutral local project catalog and optional `ordax.project-cloud-links-reader/1` read-only overlay over `ordax.project-cloud-links/1` data; it does not create a second project store, require an account, upload local files by default or change local project identity. Web currently degrades honestly when no local/cloud project catalog is supplied. Notes remains a known first-party product with stable app id `notes`, classified as `on-demand` and `store-only`. After the completed source transfer, its app payload is intentionally absent from `system/`: there is no local Notes runtime, fixed launcher path, app-owned localization payload or legacy `/__ordax/native/notes` persistence endpoint. Its canonical app source is already in `ordax-apps`; a future verified package will consume public platform contracts such as `ordax.app-data/1`, `ordax.intelligence/1` and `ordax.file-space/11`. The Store is discovery/request UI only; its authority-free lifecycle request contract now models install, update and remove while refusing artifact/version selection, trust changes, permission grants, verification bypass and implicit user-data deletion. Verified acquisition, install/update staging, health, promotion, rollback, uninstall execution and inventory remain platform lifecycle authority, and the Native executor stays unmounted while canonical component trust/publication/activation gates remain closed. Internet is the first-party browser app with stable id `internet` and canonical source in `ordax-apps`; version `0.3.0 Beta` does not claim production Store installation or an independent updater. Its shared Surface owns the approved concept structure (navigation toolbar, workspace/tab rail, central web viewport and project-context panel), while Native/USB provide `browser.web-content` through a separate unprivileged WebKit context and one external WebView per tab. The native slice supports up to 16 tabs, back/forward/reload, tab search, keyboard accelerators, persisted public tab URLs/order/active tab, project-context selection, explicit saved web references with bounded per-reference notes, automatic reference cleanup after project removal, public-network filtering and an exact loopback Host/browser-provenance boundary. Saved project references are owned by a neutral project-domain runtime and persist in the Native privileged profile with honest session fallback; the external page never receives project storage capability. Web intentionally exposes an unavailable browser-session port rather than pretending arbitrary sites can be safely embedded. Notes web references activate this same `internet` app. Internet also owns bounded device-local favorites through a neutral `ordax.browser-favorites/1` port; the Native privileged profile persists them while external website WebViews receive no access to that store. Native hardware proof for the new WebKit host remains pending, so the browser slice is implemented in source but not yet marked physically proven. Ajustes now owns persisted Surface-level contrast, motion and text-scale preferences; text scale changes the shared typographic base without claiming host-level accessibility control. Platform-specific behavior belongs in adapters/compositions, not in forks of the shared Surface. The normal Home now keeps technical delivery/recovery markers out of the area label; real delivery identity and update details live in Sistema. The visible settings identity is standardized as **Ajustes** while preserving the stable internal app id `settings`.

### Nova OrdaX pre-USB functional closure

The legacy/product-vision audit has been revalidated before the first Stable/MVP
physical USB. `PLANO-03-FECHAMENTO-PRE-USB-NOVA-ORDAX.md` is now the active
pre-USB closure plan. Physical media work is intentionally held while the remaining
class-A product gaps are closed. Ordax Intelligence consumers, Native local
session/lock, safe Files removal and PT-BR/en-US launch-language coverage are now
source-complete. The historical v4 candidate carrying the proven local-AI runtime was
signed, materialized, exactly verified and bound by a non-activating proof at source
`b924ff8d74d1761232381ae3f9604bba17497cfd`. It remains a public prerelease and valid
historical pre-hardening evidence, but PR #588 and later source hardening superseded it
for current-main physical promotion. The stable `latest` channel has not been promoted.
Diagnostics/recovery presentation and the conservative MVP hardware-support matrix
are source-complete; their target-hardware/physical proofs remain later gates.

The v4 Creator payload change deliberately revoked the stale 15-artifact authorization
context instead of widening it. The structured physical-authorization contract is now
authoritative at `blocked-canonical-v4-release-proof-pending`: the historical
`canonical-v4-release-proof.json` cannot be rebound to reopen consent. A replacement
signed/materialized v4 proof from a different post-hardening source commit must be
produced, verified and bound before owner consent becomes reachable. The 17-artifact
writer remains fail-closed, no USB target is selected, no target-specific destructive
confirmation is current and no new physical write/proof is authorized. The physical Creator
now keeps writer/tooling provenance separate from release identity: the writer embeds its own
Git SHA as provenance plus the canonical v4 release source commit from
`physical-write-authorization.json -> release_binding.source_commit`. Target-specific
Portable media/application plans must use that canonical release commit, and
`prepare-portable`/`apply-portable` fail closed unless it matches; the v4 writer accepts
exactly 17 canonical artifact sources, never the previous 15-source shape.

```text
PRE_USB_NOVA_ORDAX_AUDIT=PASS
INTELLIGENCE_REAL_SYSTEM_CONSUMER=PASS_SOURCE
INTELLIGENCE_STABLE_V4_BACKEND_LIFECYCLE=PASS_SOURCE_SIGNED_STABLE_PROOF_PENDING
INTELLIGENCE_MEMORY_NATIVE_RUNTIME=PASS_SOURCE_FAIL_SOFT
INTELLIGENCE_MEMORY_REVIEW_UI=PASS_SOURCE_NATIVE_ACCOUNT_MEMORY_SECTION
INTELLIGENCE_MEMORY_WEB_DURABLE_REVIEW=UNAVAILABLE_NO_FAKE_PERSISTENCE
INTELLIGENCE_MEMORY_AUTOMATIC_INJECTION=PASS_SOURCE_COMPOSITION_AUTHORIZED_DEVICE_ACCOUNT_SPACE
INTELLIGENCE_MODEL_ROUTER_LOCAL_IDENTITY=PASS_SOURCE_ENGINE_PLUS_MODEL
LOCAL_AI_HARDWARE_PROBE_BEFORE_START=PASS_SOURCE_NON_BOOT_CRITICAL
LOCAL_SESSION_LOCK_POLICY=PASS_SOURCE
LOCAL_SESSION_LOCK_IMPLEMENTATION=PASS_SOURCE
LOCAL_SESSION_LOCK_PHYSICAL_PROOF=PENDING
FILES_DAILY_OPERATIONS=PASS_SOURCE
FILES_SAFE_REMOVAL=PASS_SOURCE
FILES_TRASH_PHYSICAL_PROOF=PENDING
DIAGNOSTICS_RECOVERY_PRESENTATION=PASS_SOURCE
RECOVERY_STATUS_PHYSICAL_PROOF=PENDING_PHYSICAL
SUPPORTED_HARDWARE_MATRIX=PASS_SOURCE
CANONICAL_STABLE_TARGET_HARDWARE_PROOF=PENDING_PHYSICAL
CANONICAL_V4_OPERATOR_PREFLIGHT=PASS_SOURCE_READ_ONLY
CREATOR_PORTABLE_WRITER_RELEASE_SOURCE_BINDING=PASS_SOURCE
CREATOR_PORTABLE_WRITER_ARTIFACT_SOURCE_COUNT=17
CREATOR_WRITER_SOURCE_PROVENANCE_SEPARATE=YES
CANONICAL_V4_OPERATOR_INPUT_EXPORT=PASS_SOURCE_MANUAL_WORKFLOW_DISPATCH_ONLY
CANONICAL_V4_OPERATOR_INPUT_RETENTION=1_DAY_NON_PUBLICATION
CANONICAL_V4_OPERATOR_INPUT_SAME_SHA_REQUIRED=YES
CANONICAL_V4_OPERATOR_RECEIPT_SCHEMA=prototype-ordax.canonical-v4-operator-artifact/1
CANONICAL_V4_OPERATOR_RECEIPTS=PASS_CI_SAME_SHA_SHA256_SIZE_REVERIFIED
CANONICAL_V4_OPERATOR_RECEIPT_TAMPER_REJECTION=PASS_CI_WRONG_COMMIT_AND_BYTE_TAMPER
CANONICAL_V4_OPERATOR_RECEIPT_WORKFLOW_RUN_ID=36166653548
CANONICAL_V4_RELEASE_PROOF_HISTORY=PASS_SIGNED_MATERIALIZED_VERSIONED_PRERELEASE_PRE_HARDENING
CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN=PASS_POST_HARDENING_SIGNED_HTTPS_MATERIALIZED_AND_BOUND
STABLE_MVP_USB_READINESS_GATE=PASS_SOURCE_AGGREGATES_PRE_USB_AND_PHYSICAL_PROMOTION
STABLE_MVP_USB_READINESS_CURRENT_STAGE=EXPLICIT_OWNER_AUTHORIZATION_PENDING
CANONICAL_V4_RELEASE_PROOF_BINDING_CURRENT_MAIN=PASS
PHYSICAL_OWNER_AUTHORIZATION_RECORDED=NO
PHYSICAL_OWNER_AUTHORIZATION_REACHABLE=YES_EXPLICIT_OWNER_CONSENT_REQUIRED
FIRST_STABLE_MVP_USB_WRITE=HOLD_EXPLICIT_PHYSICAL_AUTHORIZATION_PENDING
PHYSICAL_WRITE_AUTHORITY=BLOCKED_EXPLICIT_OWNER_AUTHORIZATION_PENDING
```

### Pre-MVP ecosystem foundation

A separate product-domain foundation is now defined before public accounts carry real data. The account model distinguishes one OrdaX identity from **Spaces** and versioned **Profile Packs**; the initial Developer and Legal-BR packs are draft descriptors only and do not activate professional-domain behavior. Billing, prices and commercial tier names remain undefined. A provisional two-private-Space default exists only as an internal capacity foundation and is not a public commercial claim.

Persistent Intelligence memory is now implemented as OrdaX-owned through `ordax.memory/1`, with explicit `device|account` ownership, device/account/space/project/session scopes, provenance, bounded search/review/edit/delete semantics and durable `flush()` confirmation. Native/USB owns a bounded private atomic memory state through a loopback-only endpoint and mounts the memory runtime fail-soft; Web fallback is explicitly ephemeral and cannot pretend durable device/account/Space/project state. Account → Memory now mounts a user-visible Native review surface over the same owner-scoped runtime, with device/account owner switching, bounded search/pagination, editing, deletion and durable flush feedback; the Web composition deliberately shows durable memory as unavailable instead of simulating persistence. `ordax.memory-context-auth/1` and the authorized-memory bridge require composition-layer authorization before any memory reaches Intelligence, and ordinary Intelligence requests still inject no memory automatically unless Native composition has an explicit identity-bound `Space em uso`; Native composition now explicitly authorizes a shared bounded Memory set: device scope always remains available locally, authenticated account scope is added only for the real signed-in `subjectId`, and selected-Space scope is added only for that same subject plus exact `spaceId`; project/session/restricted memory is not inferred. in that case only account-owned, non-restricted `scope=space` memory for that exact `subjectId + spaceId` is eligible as selected Space Memory context. `ordax.model-router/1` is now active in the Intelligence runtime, binds local routes to `engineId + modelId` and keeps future OpenAI/xAI routes fail-closed without explicit egress plus an enabled adapter. Local AI remains the offline baseline and no inference provider owns persistent memory.

The dedicated Supabase project `ordax-control-plane` is the selected pre-MVP backend target for the product schema. The source-controlled migrations under `infra/supabase/product/` have been applied: `ordax_accounts`, Spaces/membership, server-authoritative entitlement grants, versioned Profile Packs, memory metadata + pgvector embeddings and project-connection metadata all use RLS. The older duplicate `ordax_profiles` migration was removed so Auth has one OrdaX product bootstrap owner. The Supabase password provider is implemented and the OrdaX account gateway is deployed to the dedicated control-plane backend. Sign-in, sign-up implementation, refresh, validated session state and logout use HttpOnly cookies and never expose provider tokens to Surface JavaScript. Account registration itself is now explicitly fail-closed across Surface capability, Native host and gateway until a reviewed legal policy plus server-authoritative document-version receipt binding exists; login remains independent. Account sync now uses an atomic initial snapshot plus a subject-bound persisted incremental cursor for appearance, portable preferences and workspace metadata on Web and Native/USB. **Public browser login remains fail-closed** pending the same-origin production hosting boundary, leaked-password protection, remaining Auth hardening and legal readiness. The Account Surface now also has a minimal read-only Spaces view on Web and Native/USB: it consumes only `/account/spaces`, validates a bounded provider-neutral projection, clears cached Space data on sign-out and never invents a local Space. The account gateway source remains internally versioned v17, but the destination provider is still on Edge Function provider revision 13 and does not yet include the latest canonical `domain/subtype` Spaces projection; the reviewed GitHub Actions deploy owner remains fail-closed until its `SUPABASE_ACCESS_TOKEN` management credential is configured. Registration remains explicitly disabled. The live gateway also enforces the shared server-authoritative auth rate limit on direct Native credential/recovery paths and keeps password-recovery credentials isolated from normal account sessions. A service-role-only read projection now exposes only the active/effective canonical Privacy/Terms metadata through `/auth/registration-policy`; Web and Native source consume that same projection, intersect it with their local registration gate, and require affirmative acceptance without trusting client-supplied version/hash authority. The server-authoritative registration legal receipt migration `20261002221427_account_registration_legal_receipt_v1` is applied: the existing single `auth.users` trigger now requires a short-lived service-issued legal intent, binds it to the normalized-email SHA-256 and active canonical legal policy, snapshots Privacy/Terms version + effective date + SHA-256 into a private receipt in the same user-creation transaction, and rejects direct signup bypasses. No active legal policy exists yet, so the source-ready Web/Native acceptance UI remains unavailable and public registration stays fail-closed; the dedicated account lifecycle service is deployed as revision 2 with global session revocation before account deletion while account-close remains disabled. Public browser account access and account-close execution remain disabled.

OrdaX Network now has a live server-authoritative MVP backend in the same
`ordax-control-plane`. The six v1 Network migrations plus all six canonical v2
mutation migrations are applied: message-send, direct-create, block-change,
group-join, report-create and group-create. Public v2 wrappers remain
`SECURITY INVOKER`; privileged implementations remain private
`SECURITY DEFINER` with `search_path=''`. The live schema exposes zero direct
Network table grants to `anon` or `authenticated`. Group/report idempotency
columns are nullable for legacy v1 rows and protected by partial unique indexes
for v2 retries. The multi-tenant PostgreSQL proof covers cross-account denial,
viewer write denial, block behavior, idempotency, rate-limit durability, group
lifecycle and deletion/tombstone behavior. The first-party Network app exists
as an optional fail-soft component and pins a draft to its sender Space; a
global Space change never silently retargets the pending draft. The same-origin
message route is deployed through Native -> account gateway -> Edge ->
`ordax_network_send_message_v2`, while `PUBLIC_SITE_NETWORK_ENABLED=false`
keeps public Network activation fail-closed.

```text
ORDAX_NETWORK_MVP_BACKEND=PASS_APPLIED
ORDAX_NETWORK_V1_SCHEMA=PASS_APPLIED
ORDAX_NETWORK_V2_MUTATIONS=MESSAGE_SEND,DIRECT_CREATE,BLOCK_CHANGE,GROUP_JOIN,REPORT_CREATE,GROUP_CREATE
ORDAX_NETWORK_V2_MIGRATIONS=PASS_APPLIED
ORDAX_NETWORK_DIRECT_BROWSER_TABLE_GRANTS=NONE
ORDAX_NETWORK_RPC_BOUNDARY=PUBLIC_INVOKER_PRIVATE_DEFINER_SEARCH_PATH_EMPTY
ORDAX_NETWORK_MULTI_TENANT_PROOF=PASS_POSTGRESQL16
ORDAX_NETWORK_RETENTION_TOMBSTONE_POLICY=PASS_CONTRACT_V1
ORDAX_NETWORK_COLLABORATIVE_HISTORY_ON_ACTOR_DELETE=RETAIN_WITH_ATTRIBUTION_TOMBSTONE
ORDAX_NETWORK_AUTOMATIC_MESSAGE_PURGE=NO
ORDAX_NETWORK_SURFACE_APP=PASS_SOURCE_OPTIONAL_FAIL_SOFT
ORDAX_NETWORK_DRAFT_SENDER_SPACE=PINNED_NO_SILENT_RETARGET
ORDAX_NETWORK_MESSAGE_TRANSPORT_SERVER=PASS_DEPLOYED
ORDAX_NETWORK_PUBLIC_SITE_ENABLED=NO
```

First-party Product OAuth now has a separate persistent authorization domain from
owner/development MCP credentials. The private OAuth client/code/grant/access-token
authority is applied in `ordax-control-plane`; authorization code + PKCE S256,
single-use code consumption, opaque access-token resolution/revocation and current
Space authority are proven end to end through the provider-neutral HTTP boundary.
The canonical Achegue-se client `acheguese-web-01` remains deliberately
`disabled` with an empty redirect allowlist and exactly the three initial read
scopes. A read-only Product Network resource server is also applied: its server-only
RPCs accept only SHA-256 access-token digests, revalidate token/grant/client/scope
and current owner/admin authority, and expose bound Space, discoverable directory
and active communities reads. Public RPC EXECUTE is limited to `service_role`;
`anon` and `authenticated` have no Product Network resource RPC authority.
No public listener, real redirect or Achegue-se linking is enabled.

```text
PRODUCT_OAUTH_AUTHORITY=PASS_APPLIED_PRIVATE_RPC_ONLY
PRODUCT_OAUTH_HTTP_BOUNDARY=PASS_SOURCE_DISPOSABLE_E2E
PRODUCT_OAUTH_PKCE_S256=PASS_DISPOSABLE_E2E
PRODUCT_OAUTH_ACHEGUESE_CLIENT=DISABLED_ZERO_REDIRECTS
PRODUCT_OAUTH_ACHEGUESE_INITIAL_SCOPES=NETWORK_SPACE_READ,NETWORK_DIRECTORY_READ,NETWORK_COMMUNITIES_READ
PRODUCT_NETWORK_READ_RESOURCE=PASS_APPLIED_SERVER_ONLY
PRODUCT_NETWORK_READ_RESOURCE_TOKEN_TO_DB=SHA256_ONLY
PRODUCT_NETWORK_READ_RESOURCE_BROWSER_EXECUTE_GRANTS=NONE
PRODUCT_NETWORK_READ_RESOURCE_LIVE_UNKNOWN_TOKEN=DENIED
PRODUCT_OAUTH_PUBLIC_LISTENER=NO
PRODUCT_OAUTH_REAL_HTTPS_REDIRECT=NO
PRODUCT_OAUTH_PUBLIC_LINKING=NO
```

A Product MCP boundary is also specified separately from the owner/development Control Plane. Future ChatGPT/Grok clients authenticate to OrdaX OAuth, then receive only account/Space/project-scoped tools. GitHub is a separate connection, preferably through a GitHub App restricted to selected repositories; upstream GitHub credentials are never returned to the external model. Public Product MCP deployment, mutating tools, connectors and automations remain post-MVP functionality.

This foundation does not change the current physical release gate:

```text
ECOSYSTEM_FOUNDATION=PASS_SOURCE_BACKEND_SCHEMA_PREPARED
PUBLIC_IDENTITY_PASSWORD_FLOW=PASS_SOURCE_ACTIVATION_GATED
PUBLIC_IDENTITY_EDGE_GATEWAY=DEPLOYED_ORDAX_CONTROL_PLANE_SOURCE_V17_REV27_NATIVE_AUTH_RATE_LIMIT_LIVE_REGISTRATION_CLOSE_DISABLED
PUBLIC_IDENTITY_EDGE_DEPLOYMENT_REVISION=27_SOURCE_V17_LIVE
PUBLIC_SITE_SAME_ORIGIN_ADAPTER=PASS_SOURCE_NGINX_NOT_DEPLOYED
PUBLIC_IDENTITY_GATED_FORMS=PASS_SOURCE_NATIVE_POST_JS_NO_CREDENTIAL_READ
PUBLIC_SITE_DEPLOYMENT_PROOF_HARNESS=PASS_SOURCE_CREDENTIAL_FREE
PUBLIC_AUTH_CSRF_STATE_CHANGE_PROTECTION=PASS_DEPLOYED
PUBLIC_AUTH_SERVER_SIDE_ACTIVATION_GATE=PASS_DEPLOYED_DISABLED
PUBLIC_AUTH_PUBLIC_SITE_MARKER=X-OrDaX-Public-Site
PUBLIC_AUTH_REGISTRATION_PASSWORD_POLICY=PASS_PRODUCT_MIN_12_PROVIDER_CONFIG_PENDING
PUBLIC_AUTH_REGISTRATION_ENABLED=NO
PUBLIC_AUTH_REGISTRATION_LEGAL_BINDING=SERVER_RECEIPT_AND_POLICY_PROJECTION_IMPLEMENTED_FINAL_POLICY_AND_E2E_PENDING
PUBLIC_AUTH_REGISTRATION_NATIVE_BYPASS_ALLOWED=NO
PUBLIC_AUTH_REGISTRATION_POLICY_PROJECTION=PASS_SOURCE_APPLIED_SERVICE_ROLE_ONLY
PUBLIC_AUTH_REGISTRATION_POLICY_ACTIVE=NO
PUBLIC_AUTH_REGISTRATION_UI_BINDING=PASS_SOURCE_DISABLED_UNTIL_ACTIVE_POLICY_AND_SWITCH
PUBLIC_AUTH_RATE_LIMIT_REVIEW=PASS_SHARED_POLICY_DB_AUTHORITY_NATIVE_DIRECT_LIVE_PUBLIC_EDGE_V6_LIVE_VERCEL_REAL_IP_PROOF_PENDING
PUBLIC_AUTH_RATE_LIMIT_DEPLOYED=NATIVE_DIRECT_AND_PUBLIC_EDGE_V6_YES_VERCEL_ADAPTER_PROOF_PENDING
PUBLIC_AUTH_SESSION_REVOCATION_PROOF=PENDING_REAL_CREDENTIALLED_EXECUTION_LOCAL_SCOPE
PUBLIC_AUTH_SESSION_REVOCATION_HARNESS=PASS_SOURCE_CREDENTIAL_SAFE_SANITIZED_RECEIPT
PUBLIC_AUTH_SESSION_REVOCATION_WORKFLOW=PASS_SOURCE_MANUAL_SECRETS_REQUIRED
PUBLIC_AUTH_SESSION_REVOCATION_RECEIPT_SCHEMA=prototype-ordax.account-session-revocation-proof/1
PUBLIC_AUTH_RECOVERY_REQUEST=PASS_SOURCE_EDGE_V27_DISABLED_SESSION_ISOLATED
PUBLIC_AUTH_RECOVERY_REDIRECT_CONFIG=CANONICAL_ORIGIN_SELECTED_PROVIDER_ALLOWLIST_PROOF_PENDING
PUBLIC_AUTH_RECOVERY_EMAIL_TEMPLATE=PASS_SOURCE_NOT_APPLIED_TO_PROVIDER
PUBLIC_AUTH_RECOVERY_COMPLETION_ENABLED=NO
PUBLIC_AUTH_RECOVERY_COMPLETION_FLOW=PASS_SOURCE_EDGE_V27_DISABLED_TOKEN_HASH_SERVER_SIDE_RECOVERY_ONLY_COOKIES
PUBLIC_AUTH_LEAKED_PASSWORD_PROTECTION=PASS_PRODUCT_GATEWAY_HIBP_K_ANONYMITY_PROVIDER_NATIVE_PROTECTION_STILL_REQUIRED
PUBLIC_AUTH_PROVIDER_LEAKED_PASSWORD_ADVISOR=WARN_DISABLED_SUPABASE_FREE_PLAN
SUPABASE_CONTROL_PLANE_STATUS=ACTIVE_HEALTHY_VERIFIED_2026_10_02
SUPABASE_PRODUCT_RLS_POLICY_REVIEW=PASS_VERIFIED_OWNER_SPACE_PROJECT_SCOPES
SUPABASE_PRODUCT_DATA_API_ANON_GRANTS=NONE_VERIFIED
SUPABASE_PRODUCT_DATA_API_AUTHENTICATED_DIRECT_GRANTS=SELECT_ONLY_VERIFIED
SUPABASE_PRODUCT_MUTATIONS_DIRECT_DATA_API=DENIED_SERVER_AUTHORITATIVE
SUPABASE_SECURITY_ADVISOR_RLS_NO_POLICY=INFO_72_DENY_BY_DEFAULT_REVIEWED
PUBLIC_AUTH_ACTIVATION_PREFLIGHT=PASS_CI_SAFE_DISABLED
PUBLIC_AUTH_ACTIVATION_PREFLIGHT_WORKFLOW_RUN_ID=36166653490
PUBLIC_IDENTITY_NATIVE_SIGNED_GATEWAY_CONFIG=PASS_SOURCE
ACCOUNT_SYNC_BACKEND_V2=PASS_APPLIED_PRIVATE_RLS_INCREMENTAL
ACCOUNT_SYNC_WEB_DATA_CLASSES=APPEARANCE,PREFERENCES,WORKSPACE_METADATA
ACCOUNT_SYNC_CURRENT_READ_MODE=ATOMIC_SNAPSHOT_PLUS_PAGED_INCREMENTAL_CURSOR
ACCOUNT_SYNC_INCREMENTAL_CURSOR=PASS_APPLIED_AND_CLIENT_CHECKPOINTED
ACCOUNT_SYNC_CLIENT_INTEGRATION=PASS_SOURCE_WEB
ACCOUNT_SYNC_OFFLINE_RECONNECT=PASS_SOURCE_WEB_NATIVE
ACCOUNT_SYNC_OFFLINE_LOCAL_CHANGES_PRESERVED=PASS_SOURCE
ACCOUNT_SYNC_CHECKPOINT_SCOPE=SUBJECT_BOUND_DEVICE_WITH_SESSION_FALLBACK
ACCOUNT_SYNC_MULTI_DEVICE_E2E_PROOF=PENDING_REAL_CREDENTIALLED_EXECUTION
ACCOUNT_SYNC_TWO_CLIENT_PROOF_HARNESS=PASS_SOURCE_CREDENTIAL_SAFE_SANITIZED_RECEIPT
ACCOUNT_SYNC_TWO_CLIENT_PROOF_WORKFLOW=PASS_SOURCE_MANUAL_SECRETS_REQUIRED
ACCOUNT_SYNC_TWO_CLIENT_PROOF_RECEIPT_SCHEMA=prototype-ordax.account-sync-two-client-proof/1
ACCOUNT_AUTH_PROOF_WORKFLOWS_SOURCE_VALIDATION=PASS_CI_SOURCE_ONLY
ACCOUNT_AUTH_PROOF_WORKFLOWS_SOURCE_VALIDATION_RUN_ID=36167856584
ACCOUNT_GATEWAY_STABLE_BOOTSTRAP_BINDING=PASS_SOURCE_OPTIONAL_HTTPS_ORIGIN
ACCOUNT_SYNC_NATIVE_USB_INTEGRATION=PASS_SOURCE_GATEWAY_DEPLOYED_PHYSICAL_PROOF_PENDING
ACCOUNT_SYNC_ACCOUNT_UI_CONTINUITY_STATUS=PASS_SOURCE_REAL_RUNTIME_SNAPSHOT
ACCOUNT_SPACES_UI=PASS_SOURCE_READ_ONLY_WEB_NATIVE
ACCOUNT_SPACES_GATEWAY_SOURCE=V17_MAIN_CANONICAL_SEMANTICS_PENDING_DESTINATION_DEPLOY_PROVIDER_REV13
ACCOUNT_SPACES_RLS=OWNER_OR_ACTIVE_MEMBER
ACCOUNT_SPACES_MUTATION_UI=NONE
ACCOUNT_SPACES_CREATION_PREFLIGHT=PASS_SOURCE_EXACT_PROFILE_RESOLUTION_NO_MUTATION
ACCOUNT_SPACES_CREATION_DEFAULTS=PIZZARIA_BR_V1_AND_IMPRESSAO_3D_BR_V1
ACCOUNT_SPACES_CREATION_EXECUTION=NOT_IMPLEMENTED
ACCOUNT_SPACES_DESTINATION_GATEWAY_DEPLOY=BLOCKED_MISSING_GITHUB_ACTIONS_SUPABASE_ACCESS_TOKEN
ACCOUNT_SYNC_PUBLIC_AVAILABILITY=NO
PUBLIC_IDENTITY=DISABLED_FAIL_CLOSED
BILLING=NO
PUBLIC_STORE=NO
PRODUCT_MCP_DEPLOYED=NO
FIRST_STABLE_MVP_USB_WRITE=HOLD_EXPLICIT_PHYSICAL_AUTHORIZATION_PENDING
```

### System diagnostics and recovery presentation

Sistema now composes the existing Native diagnostic-review owner instead of passing a
null controller. The review remains explicit, local and sanitized, and can copy/export
only through the existing bounded adapters.

A separate `ordax.recovery-status/1` observer exposes factual Portable v2 state:
running slot/source, current, known-good, candidate/activation transaction and the
actual recovery loader entry on ORDAX-ESP. The recovery entry is not accepted by
presence alone; the observer checks the expected kernel/initramfs/portable-init and
`ordax.mode=recovery` markers. This port is intentionally read-only and exposes no
rollback, reboot, repair, network or mutation authority.

The MVP hardware support matrix is also now canonical in source. It explicitly says
that driver presence is not a support claim and that canonical Stable target hardware
still requires physical proof.

```text
DIAGNOSTICS_RECOVERY_PRESENTATION=PASS_SOURCE
RECOVERY_STATUS_AUTHORITY=READ_ONLY
RECOVERY_STATUS_PHYSICAL_PROOF=PENDING_PHYSICAL
SUPPORTED_HARDWARE_MATRIX=PASS_SOURCE
CANONICAL_STABLE_TARGET_HARDWARE_PROOF=PENDING_PHYSICAL
```

### Shared Surface localization

The Surface now owns `ordax.localization/1`, derived from the existing persisted
`regional.locale` preference rather than a second locale state. The shell is
created in the selected locale on its first frame and re-renders localized shell
copy without rebuilding windows or losing interaction state. English entries now
cover the shared shell, launcher, workspace/window chrome, connectivity labels and
first-party app metadata. Unsupported message IDs fail closed; locales without a
shared translation fall back to PT-BR source copy explicitly.

English is now marked as a complete Surface locale for the public MVP. Files covers its
primary navigation/search/list/selection/Recents/Trash journey, common forms, deep operational
feedback, locale-aware sorting, import/export, copy/move/rename/create-folder flows, preview and
Files → Notes presentation through the shared catalog.
Settings/System cover their section navigation/header copy, and System now also derives
its overview health/summary, memory and user-storage resource views, update transaction details/history, component/update scopes, About/versioning, capability inventory, Intelligence presentation, and the explicit sanitized diagnostic review from structured runtime state through the shared
localization owner. Runtime failure banners in these System flows now retain semantic message IDs and translate at render time, so changing locale does not preserve stale rendered PT-BR copy. Settings now also covers Appearance, Accessibility, Regional preferences,
physical keyboard layout and deep Network/Wi-Fi presentation in PT-BR/en-US through that same owner;
async keyboard/Wi-Fi feedback stores semantic message IDs rather than rendered copy, and Wi-Fi
credentials remain transient interaction state. Settings covers its Notifications policy/source and local-session
Security sections end to end, and the Native live session lock rerenders through the same
localization owner while keeping
the entered secret only in transient repaint memory. Account covers its complete
first-party overview/sync experience in English. Notes now covers its
primary navigation/editor shell, project/list states, core persistence copy,
locale-aware relative time, image/file-picker/checklist/reference flows, capacity/statistics,
prompts/confirmations and consultative Intelligence controls. Its picker/runtime failures retain
semantic message IDs and newly attached local-file metadata no longer persists translated system
labels. Internet now covers its primary browser shell,
locale-aware tab/address search, project context, home status, project references,
favorites/history and first-party operational feedback deeply in PT-BR/en-US. Its own
feedback is stored as semantic message identity so a live locale change does not preserve
stale rendered copy. The shared Home continuation/pending cards, power controls,
global update accelerator, desktop-clock fallback and Surface boot screen also use the shared
localization owner; first-party async feedback retains semantic message identity across live locale
changes. Network and battery tray/quick-panel presentation plus the Notification Center use
`ordax.localization/1` and rerender on locale changes. `ordax.notifications/3` keeps
backward-compatible text fallbacks while first-party update events persist bounded semantic
presentation identity, allowing stored update history to rerender in the active locale without
heuristic text translation. The public MVP selectors expose only PT-BR and en-US. Spanish, German
and French remain OOBE-complete compatibility/future-rollout locales and are not advertised as
complete Surface languages.

```text
SURFACE_LOCALIZATION_OWNER=PASS_SOURCE
SURFACE_SHARED_SHELL_EN_US=PASS_SOURCE
FILES_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
FILES_FORMS_SORT_EXPORT_PREVIEW_EN_US=PASS_SOURCE
SETTINGS_SYSTEM_NAV_EN_US=PASS_SOURCE
SYSTEM_OVERVIEW_SUMMARY_EN_US=PASS_SOURCE
SYSTEM_RESOURCE_VIEWS_EN_US=PASS_SOURCE
SYSTEM_UPDATE_DETAILS_HISTORY_EN_US=PASS_SOURCE
SYSTEM_COMPONENTS_ABOUT_EN_US=PASS_SOURCE
SYSTEM_CAPABILITIES_INTELLIGENCE_EN_US=PASS_SOURCE
SYSTEM_RUNTIME_FAILURE_COPY_EN_US=PASS_SOURCE
SYSTEM_DIAGNOSTIC_REVIEW_EN_US=PASS_SOURCE
SETTINGS_NOTIFICATIONS_EN_US=PASS_SOURCE
SETTINGS_SECURITY_EN_US=PASS_SOURCE
LOCAL_SESSION_LOCK_EN_US=PASS_SOURCE
ACCOUNT_EN_US=PASS_SOURCE
PROJECTS_PRIMARY_JOURNEY_EN_US=EXTERNALIZATION_SOURCE_PENDING
NOTES_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
NOTES_DEEP_EN_US=PASS_SOURCE
NOTES_SEMANTIC_ASYNC_MESSAGES=PASS_SOURCE
INTERNET_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
INTERNET_DEEP_EN_US=PASS_SOURCE
INTERNET_SEMANTIC_FEEDBACK=PASS_SOURCE
NETWORK_TRAY_QUICK_PANEL_EN_US=PASS_SOURCE
BATTERY_TRAY_QUICK_PANEL_EN_US=PASS_SOURCE
NOTIFICATION_CENTER_EN_US=PASS_SOURCE
FIRST_PARTY_UPDATE_NOTIFICATION_HISTORY_EN_US=PASS_SOURCE
FILES_DEEP_EN_US=PASS_SOURCE
FILES_SEMANTIC_OPERATIONAL_MESSAGES=PASS_SOURCE
SHELL_DEEP_EN_US=PASS_SOURCE
MVP_PUBLIC_LOCALES=pt-BR,en-US
RETAINED_COMPATIBLE_LOCALES=es-ES,de-DE,fr-FR
SURFACE_COMPLETE_LOCALES=pt-BR,en-US
SETTINGS_DEEP_EN_US=PASS_SOURCE
SETTINGS_ASYNC_MESSAGE_IDENTITIES=PASS_SOURCE
SURFACE_EN_US_APP_CONTROLS=PASS_SOURCE
```

### Files safe removal

The Native Files owner now exposes `ordax.file-space/11` with recoverable
`trashEntry()`, `listTrash()` and `restoreTrashEntry()`. The trash payload and
metadata live in a private reserved namespace under the user root that is not valid
as a public logical file-space path. Same-filesystem removal uses no-clobber rename;
restore also uses no-clobber and refuses to overwrite a new item at the original
path. Cross-device trash is rejected rather than converted into an unsafe delete,
and symlinks remain outside the supported boundary. Recent-file references are
cleared when their item is trashed, while Project continuity is invalidated only
after the file operation succeeds. Permanent delete and empty-trash actions are not
part of this MVP flow.

```text
FILE_SPACE_SCHEMA=ordax.file-space/11
FILES_SAFE_REMOVAL=PASS_SOURCE
FILES_TRASH_RESTORE_NO_CLOBBER=YES
FILES_PERMANENT_DELETE_MVP=NO
FILES_TRASH_PHYSICAL_PROOF=PENDING
```

### Arquivos device-local broker candidate — 2026-10-22

Na branch `codex/files-host-broker-20261022`, o contrato Native acrescenta
`ordax.file-space-scope/1` com escopo fixo `device-local`. O broker entrega ao
iframe isolado somente os métodos explícitos de Arquivos, Recentes, Projetos e
ativação necessários ao app `files`; caminhos, payloads e previews são limitados,
e cada chamada/notificação revalida a identidade/revisão exatas do slot atual.
Notificações coalescem por inscrição e a revogação drena operações pendentes.
O controller compartilhado agora também aguarda as mutações assíncronas do bridge,
sem perder compatibilidade com ports Native síncronos.

Isso continua separado de arquivos pertencentes à Conta ou a um Space. O
estado de 2026-10-22 foi superado no source: a PR #2184 removeu a fonte bundled
`system/apps/files/`, e a PR #2186 substituiu os providers exclusivos do boot
Native por providers genéricos de slots verificados (11 workflows aprovados,
incluindo QEMU). Não há implementação de Files embutida nem instalação externa
por essas mudanças. File Space, Recentes e Projetos seguem nativos; a prova
`pending` utiliza contexto isolado, e portas de uso normal exigem o slot
`current` verificado. Distribuição externa em `ordax-apps`, bootstrap
assinado, lifecycle, rollback e prova física permanecem pendentes. O QEMU
aprovado não comprova boot no USB ou notebook reais.

### Ordax Intelligence and local inference

The canonical Memory-to-Intelligence composition now guards account/Space
continuity throughout asynchronous inference. Account changes, logout and Space
changes discard a pending response even after returning to the original context;
changes during Memory retrieval block inference. Independent requests release
their observers, and disposed Intelligence rejects an in-flight completion.
The existing Memory, Model Router and Local AI ports remain the only authorities.
Regression evidence: 388 Node tests from Intelligence Foundation and its existing
consumer chain pass locally, including deferred account/Space races. The pipeline
test uses the real Intelligence/router with a deferred test backend; it is not a
physical model run or a remote Studio/plugin integration. Public plugin transport,
client/device grants and context/egress authorization remain separate gates.

Ordax Intelligence is now a first-class system service with stable contract `ordax.intelligence/1`; an Assistant UI is only a possible client. The Native composition now creates the provider-neutral `ordax.local-ai/1 -> ordax.intelligence/1` chain and exposes real consultative first-party consumers: Notes can request a bounded provenance-bearing summary without rewriting the note, and System can request an explanation using only local Surface capabilities/connectivity plus sanitized metrics. Neither consumer imports llama.cpp/Qwen directly, and both retain `authority=none` with tool execution disabled. The service therefore exists as a real system function in source rather than only a model/runtime test. The Stable v4 source handoff is now implemented: Portable v2 verifies `release-manifest/4`, resolves and mounts the content-addressed `local-ai-runtime.erofs` read-only, and Stable Base starts the loopback backend when the verified runtime is available. Intelligence/model failure remains non-boot-critical and degrades the capability instead of blocking boot, Surface, recovery, files or updates. Disposable QEMU/UEFI v4 boot and fallback are now PASS_CI; canonical Stable v4 signing/materialization and the later physical Stable/MVP proof remain separate release gates.

The initial source lock pins Qwen3.5-0.8B-Q4_0 by exact GGUF SHA-256/size and llama.cpp by exact source commit plus the reproducibly observed `llama-server` ELF SHA-256/size. The real `local-ai-runtime.erofs` is now CI-proven: the current source lock produced byte-identical A/B builds in one job, the EROFS was mounted read-only, the exact model loaded, eight real completion tokens were generated on loopback-only HTTP, and the same runtime produced a real `OK` chat completion inside the pinned Alpine 3.22.5 userspace used by Stable Base. The current candidate engine SHA-256 is `4a974691b9905b88cb46d97c85c2b035b33592a16cd0239ae4c6687f68799afe` (17,039,584 bytes); the current EROFS candidate SHA-256 is `b244056dad3609357e8a70433f53f41becacd8f3bd93da3d8b23f9e99d86e11a` (568,061,952 bytes). `prototype-ordax.release-manifest/4` already binds this payload to the canonical source lock and content-addressed AI runtime store. The Local AI candidate workflow now also owns a non-promotional integration gate that signs a v4 envelope with an ephemeral CI-only key, serves the three artifacts over loopback HTTPS, materializes them through `materialize-portable-v4`, revalidates them offline, and byte-compares the content-addressed stored AI EROFS with the real built runtime. This proves the real-byte protocol/materialization path without activation or physical media. Canonical v4 signing and exact prerelease materialization are now proven and bound; stable `latest` channel promotion and the real physical Stable USB proof remain pending.

```text
ORDAX_INTELLIGENCE_CONTRACT=ordax.intelligence/1
ORDAX_INTELLIGENCE_LAYER=SYSTEM
ASSISTANT_APP_OWNS_INTELLIGENCE=NO
LOCAL_AI_BACKEND_CONTRACT=ordax.local-ai/1
LOCAL_AI_STABLE_MVP_DISTRIBUTION_REQUIRED=YES
LOCAL_AI_BOOT_CRITICAL=NO
LOCAL_AI_MODEL_ARTIFACT_PINNED=YES
LOCAL_AI_ENGINE_ARTIFACT_PINNED=YES
LOCAL_AI_RELEASE_MANIFEST_V4=PASS_SOURCE
LOCAL_AI_CONTENT_ADDRESSED_ACQUISITION=PASS_SOURCE
LOCAL_AI_REAL_RUNTIME_EROFS=PASS_CI_ALPINE
LOCAL_AI_REAL_V4_MATERIALIZATION_CI_GATE=IMPLEMENTED_NON_PROMOTIONAL
LOCAL_AI_V4_QEMU_UEFI_PROOF=PASS_CI
LOCAL_AI_CANONICAL_SIGNED_STABLE_MATERIALIZATION=PENDING
LOCAL_AI_PHYSICAL_STABLE_MVP_PROOF=PENDING
```

### First run, regional preferences and physical keyboard

The Native/USB first-use flow is now implemented as a persistent device-owned OOBE rather than a presentation-only screen. It follows `welcome -> network -> account -> security -> name -> ready`, stores completion separately from preferences, local-session credentials and online identity, and does not dismiss until durable state has been written. The Security step can configure an optional offline PIN/passphrase through `ordax.local-session/1`; the secret stays transient in Surface memory and never enters `first-run.json`. When configured, the Native host stores only a salted scrypt verifier in private device state and a new Surface session starts locked. The lock keeps the existing Workspace mounted but makes the Surface inert until local authentication succeeds. This is explicitly a session gate, not USB file encryption. The MVP always offers a local-only route: account creation/sign-in is optional and capability-driven, provider unavailability does not block first use, and cloud sync is not an MVP requirement. Network setup is skippable and reuses the existing Native network-management port; Wi-Fi credentials remain transient and do not enter first-run state.

Regional choices are real persisted preferences. The first-use OOBE retains translations for `pt-BR`, `en-US`, `es-ES`, `de-DE` and `fr-FR`, while the public MVP selectors expose only `pt-BR` and `en-US`; both are complete across the shared Surface. Spanish, German and French remain accepted compatibility/future-rollout locales with translated OOBE source but are hidden from the public selectors until their Surface coverage reaches the same launch standard. PT-BR remains the source/default locale. The default time zone is `America/Bahia`, and locale/time zone remain editable later under **Ajustes -> Idioma e região**. Physical keyboard layout is a separate Native device capability, not a Web preference: `br-abnt2` is the Stable/MVP default and `us` is the alternative. The selected layout is stored privately on the USB and mapped to fixed `XKB_DEFAULT_*` values before Cage starts. Arbitrary XKB values and shell input from HTTP are rejected. When the configured layout differs from the layout already applied to the running compositor, Ajustes reports that a new Surface start is required; no fake live-switch behavior is claimed. The OOBE keyboard selector intentionally remains hidden until a safe current-session application or pre-Surface handoff exists.

```text
FIRST_RUN_OOBE=PASS_SOURCE_NATIVE_USB
FIRST_RUN_PERSISTENT=YES
FIRST_RUN_ACCOUNT_OPTIONAL=YES
FIRST_RUN_LOCAL_ONLY_ALWAYS_AVAILABLE=YES
FIRST_RUN_NETWORK_SKIPPABLE=YES
FIRST_RUN_SOURCE_LOCALE=pt-BR
FIRST_RUN_OOBE_COMPLETE_LOCALES=pt-BR,en-US,es-ES,de-DE,fr-FR
SURFACE_LOCALIZATION_OWNER=PASS_SOURCE
SURFACE_SHARED_SHELL_EN_US=PASS_SOURCE
FIRST_RUN_FULL_SURFACE_TRANSLATIONS=PT_BR_EN_US_COMPLETE_ES_DE_FR_HIDDEN_MIGRATING
FIRST_RUN_DEFAULT_TIME_ZONE=America/Bahia
FIRST_RUN_WEB_DEVICE_OOBE=NO
KEYBOARD_LAYOUT_NATIVE=PASS_SOURCE
KEYBOARD_LAYOUT_DEFAULT=br-abnt2
KEYBOARD_LAYOUT_ALTERNATIVE=us
KEYBOARD_LAYOUT_WEB_CAPABILITY=NO
KEYBOARD_LAYOUT_LIVE_RECONFIGURE=NO
KEYBOARD_LAYOUT_FIRST_RUN_SELECTOR=NO_GATED_ON_SAFE_APPLY
KEYBOARD_LAYOUT_PHYSICAL_STABLE_MVP_PROOF=PENDING
EARLY_BOOT_GRAPHICAL_SPLASH=NO_CONSOLE_TEXT
```

On the target notebook, the owner/development USB has physically proven the Git-first native host: Cage/Wayland + Barkery/WebKitGTK renders the shared Surface fullscreen; keyboard and mouse/touchpad work; authenticated native restart and shutdown work; and Git changes can be pulled and applied with a Surface reload while the notebook remains running. The temporary live-update marker appeared and then disappeared automatically in the same running session, proving the rebootless update round trip.

The Git-first update path is now split between a stable `system/entrypoint` guardian and a child `system/supervisor`. Ordinary Surface changes reload the browser, native-host changes restart only the Surface, supervisor/guardian changes use a controlled supervisor restart, and boot/bootstrap changes are marked as requiring a later reboot instead of rebooting automatically. The guardian monitors the supervisor's state-file heartbeat and can restart a stalled supervisor child without returning to the Development Base maintenance shell. The controlled `exit 75 -> guardian refresh -> supervisor restart` path has been physically exercised on the target notebook.

Recovery no longer depends on that supervisor alone. A persistent, bounded `ordax-rescue` agent lives under `/state/ordax/rescue/` and consumes only target-bound, monotonic commands from the separate Git rescue ref. The physical notebook has acknowledged multiple rescue generations, including no-op generations while healthy. The rescue protocol does not provide remote shell, arbitrary commands, reboot, poweroff or arbitrary Git reset.

Operational observability is also physically active through the temporary Supabase relay. A host-base telemetry agent starts before the graphical runtime and reports checkout SHA, human `deliveryNumber`, pending `bootRefreshRequired`, updater state, health state, rescue generation/action, power-action proof fields and a supervisor state-file heartbeat. The deployed relay configuration is source-controlled. Supabase is observation-only and has no command semantics. This allowed the recovery from the stale `d071477a` graphical session to be diagnosed and verified without relying on the visible screen.

A native-host update delivered through the live Git path has been physically validated to restart only the Surface and return to the graphical session without rebooting the notebook. Candidate Git objects are now preflighted before switching the live checkout, and the valid-candidate success path has been physically exercised; rejection/rollback of an intentionally broken candidate remains a separate physical exercise. The development Base channel also materializes an exact-commit `rootfs.tar` into a versioned root. Acquisition is delegated by the supervisor to the persistent base-update owner and runs inside the replaceable native runtime, so the minimal development Base does not gain a Python dependency. The Git-refreshable `ordax-dev-init` then selects that root only when its SHA matches the one-shot A/B candidate slot. The mapping is per slot and preserves the seed Base as the legacy fallback. The selector/materializer is source/CI work only: `dev-base-ready-sha` is not yet consumed by an ESP staging/one-shot activation owner, so this change does not arm a boot candidate. Disposable selector proof, authorized A/B staging and broken-candidate physical rollback remain separate gates; none is claimed as physical proof here. The durable offline sync-state store is implemented and CI-proven; survival of a deliberately created pending mutation across a later explicit Surface restart remains a separate physical persistence exercise.

These development-USB results do **not** imply that the canonical signed release-acquisition/native-disk product path is complete. `GRAPHICAL_SURFACE_COMPLETE` and `CANONICAL_SYSTEM_RUNTIME_COMPLETE` remain `NO` until their separate product gates close.

## Development USB — physically proven path

```text
OWNER_DEVELOPMENT_USB_BOOT=PASS
DEVELOPMENT_GIT_CHECKOUT=PASS
DEVELOPMENT_NETWORK_FOR_GIT=PASS
REPLACEABLE_NATIVE_RUNTIME=PASS
CAGE_WAYLAND_RENDER=PASS
BARKERY_WEBKIT_RENDER=PASS
PHYSICAL_KEYBOARD=PASS
PHYSICAL_MOUSE_TOUCHPAD=PASS
NATIVE_RESTART=PASS
NATIVE_SHUTDOWN=PASS
RETURN_BOOT_AFTER_SHUTDOWN=PASS
GIT_HOT_UPDATE_RELOAD=PASS
GIT_HOT_UPDATE_ROUND_TRIP=PASS
GUARDIAN_SUPERVISOR_RESTART=PASS
INDEPENDENT_GIT_RESCUE=PASS
HOST_BASE_REMOTE_TELEMETRY=PASS
CANDIDATE_PREFLIGHT_VALID_PATH=PASS
USB_REFLASH_REQUIRED_FOR_NORMAL_SYSTEM_CHANGES=NO
SSH_REQUIRED=NO
REMOTE_CONTROL_PLANE_REQUIRED=NO
```

The physical evidence is recorded in `docs/evidence/physical-native-surface-2026-09-17.md`. The original BusyBox `command -v` handoff failure was corrected in PR #21 and subsequent owner/development USB boots progressed through the Git checkout into the graphical Surface, so that historical bring-up blocker is closed for this development path.

## Build autonomy

```text
CODEX_REQUIRED=NO
LOCAL_DEVELOPER_TOOLCHAIN_REQUIRED=NO
MANUAL_KERNEL_BUILD_REQUIRED=NO
CI_BUILD_REQUIRED=YES
ARTIFACT_PROVENANCE_REQUIRED=YES
ARTIFACT_SHA256_REQUIRED=YES
PINNED_KERNEL_BUILD_ENVIRONMENT=PASS
KERNEL_REPEAT_DIGEST_PROOF=PASS
GITHUB_ACTIONS_IMMUTABLE_SHA_POLICY=PASS
GITHUB_ACTIONS_MUTABLE_TAGS=FORBIDDEN
GITHUB_ACTIONS_UNKNOWN_EXTERNAL_REFS=FORBIDDEN
GITHUB_ACTIONS_PULL_REQUEST_TARGET=FORBIDDEN_BY_DEFAULT
BASE_UPDATE_FAT32_STAGING_PROOF=PASS_DISPOSABLE_CI
```

GitHub Actions remains the current build/proof executor; repository recipes are source authority. Kernel/build reproducibility, Action pinning and deterministic real-`system/` bundling remain CI-proven. The current A/B base staging code is also exercised on a disposable FAT32 loop image: the proof preserves current/recovery entries and the active slot, writes and verifies the inactive candidate, unmounts, runs read-only `fsck.vfat`, remounts and re-verifies bytes. That proof is explicitly filesystem-staging-only: it does not exercise canonical release trust, authorize physical writes, activate a candidate or prove notebook boot. CI proof does not authorize destructive physical writes or substitute for hardware validation.

## Physical architecture

The capacity-independent bootstrap seed and the current transitional USB prepared by Creator are different artifacts and must not be collapsed into one partition count:

```text
BOOTSTRAP_SEED_PARTITIONS=2
BOOTSTRAP_SEED_PARTITION_NAMES=ORDAX-ESP,ORDAX
SEED_PARTITION_1_FILESYSTEM=FAT32
SEED_PARTITION_2_FILESYSTEM=EXT4
PREPARED_USB_PARTITIONS=3
PREPARED_USB_PARTITION_NAMES=ORDAX-ESP,ORDAX,ORDAX-DATA
PREPARED_PARTITION_1_FILESYSTEM=FAT32
PREPARED_PARTITION_2_FILESYSTEM=EXT4
PREPARED_PARTITION_3_FILESYSTEM=EXFAT
SEPARATE_HOME_PARTITION=NO
LEGACY_ORDAX_PLATFORM_PARTITION=FORBIDDEN
LEGACY_ORDAX_HOME_PARTITION=FORBIDDEN
```

`docs/contracts/physical-media.json` is authoritative for the two-partition capacity-independent seed (`ORDAX-ESP` + `ORDAX`). `docs/contracts/physical-prepared-media.json` is authoritative for the current **transitional Owner/Development** prepared USB (`ORDAX-ESP` + bounded `ORDAX` + target-capacity-specific `ORDAX-DATA`). These counts describe different validation artifacts and are not the final Stable/MVP layout. The legacy/transitional release tree remains validation-only and must not become the public MVP default.

The durable MVP target is portable USB v2:

```text
ORDAX-ESP   FAT32
ORDAX-DATA  exFAT
  -> .ordax/base/stable-base.erofs
  -> .ordax/releases/<commit>/system.erofs
  -> .ordax/releases/<commit>/surface-runtime.sha256
  -> .ordax/runtimes/sha256/<runtime-sha256>/native-surface-runtime.erofs
  -> .ordax/state/persistent-state.img   # ext4-in-file
```

Mutable activation authority (`current`, `known-good`, `candidate`, `rejected` and `activation-transaction.json`) lives inside the ext4 persistent-state image, never as a mutable exFAT symlink/pointer. Portable v2 remains the storage/bootstrap compatibility shape; the current Stable/MVP candidate uses signed `release-manifest/4`, binding `system.erofs`, the content-addressed Surface runtime and the content-addressed Local AI runtime/source-lock identity. `release-manifest/3` remains a verified compatibility baseline for pre-v4 devices and for the already-proven v3 activation evidence; it is not the current MVP release shape. The Stable Base remains a separate immutable minimal OS EROFS. The fixed initramfs candidate owns exact release selection, capsule/Base verification, system/runtime EROFS mounts and the read-only-to-ephemeral OverlayFS handoff; signature authority remains in the bootstrap-owned release agent. The Stable supervisor is v4-aware: it inspects the signed manifest schema, selects exact v3 or v4 materialization/verification, blocks v3 downgrade after a v4 boot, and preserves the one-shot `candidate -> cold-health -> commit/rollback` lifecycle. The dedicated disposable QEMU/UEFI v4 proof now proves boot handoff with the Local AI runtime plus safe fallback, while the older v3 one-shot proof remains compatibility evidence for candidate rejection/rollback behavior. This still does **not** prove cold-health commit, physical Stable/MVP USB boot, Secure Boot, physical known-good or physical rollback. The graphical cold-health path is intentionally not synthesized in CI: the actual product path requires Cage/Wayland/WebKit/seatd plus the native host and Surface heartbeat/health handshake with the exact release SHA, and no equivalent headless product mode is currently implemented.

```text
PORTABLE_USB_V2_STORAGE_PROOF=PASS_CI_DISPOSABLE
PORTABLE_RELEASE_EROFS_REPRODUCIBLE=PASS_CI
PORTABLE_RELEASE_MANIFEST_V2_SIGN_VERIFY=PASS_CI_COMPATIBILITY
PORTABLE_RELEASE_MANIFEST_V3_SIGN_VERIFY=PASS_CI_COMPATIBILITY
PORTABLE_RELEASE_V3_CONTENT_ADDRESSED_RUNTIME=PASS_CI_COMPATIBILITY
PORTABLE_RELEASE_MANIFEST_V4_SIGN_VERIFY=PASS_CI_CURRENT_MVP
PORTABLE_RELEASE_V4_LOCAL_AI_CONTENT_ADDRESSED_RUNTIME=PASS_CI
PORTABLE_RELEASE_OFFLINE_EXACT_VERIFY=PASS_CI_V2_V3_V4
PORTABLE_MOUNT_HANDOFF_PROOF=PASS_CI_DISPOSABLE
PORTABLE_BOOTSTRAP_CAPSULE_REPRODUCIBLE=PASS_CI
PORTABLE_INITRAMFS_HELPERS=PASS_CI
PORTABLE_SURFACE_RUNTIME_APK_LOCK=RESOLVED_305_EXACT_PACKAGES_REPROOF_REQUIRED
PORTABLE_SURFACE_RUNTIME_EROFS_REPRODUCIBLE=PASS_CI
PORTABLE_SURFACE_RUNTIME_EROFS_SHA256=5b44729139777b610c300864d6f41c0580a3d6ca0b694b8dc53e38f505f99236
PORTABLE_SURFACE_RUNTIME_BOOT_CONNECTED=PASS_CI_RUNTIME_V3_HANDOFF
PORTABLE_STABLE_RUNTIME_V3_HANDOFF_PROVEN=PASS_CI_DIRECT_KERNEL_AND_UEFI
PORTABLE_STABLE_GRAPHICAL_SURFACE_OFFLINE_PROVEN=NO_PHYSICAL_GRAPHICAL_EXERCISE_PENDING
PORTABLE_STABLE_BOOT_APK_INSTALL_ALLOWED=NO
PORTABLE_V3_UPDATE_ACTIVATION_SOURCE=CONNECTED_ONE_SHOT_REBOOT_COLD_HEALTH
PORTABLE_V3_UPDATE_BASELINE_QEMU_REGRESSION=PASS_CI_CURRENT_MAIN_DIRECT_AND_UEFI
PORTABLE_V3_UPDATE_ACTIVATION_QEMU_ONE_SHOT_PROOF=PASS_CI_DISPOSABLE_EXACT_SOURCE
PORTABLE_V3_UPDATE_ONE_SHOT_PROVEN_SOURCE_COMMIT=837a99733654943f08a400d6cc3fb28bf84605f8
PORTABLE_V3_UPDATE_ONE_SHOT_WORKFLOW_RUN_ID=35607396175
PORTABLE_V3_UPDATE_ONE_SHOT_PROOF_ARTIFACT_SHA256=57712b1364b5e6ee2efc44645238abc21e50d531fa41f6936f7674465cdf5a23
PORTABLE_V3_UPDATE_COLD_HEALTH_COMMIT_PROOF=PENDING
PORTABLE_V3_UPDATE_ACTIVATION_PHYSICAL_PROOF=NO
PORTABLE_V3_REJECTED_SHA_PERSISTED=PASS_CI_DISPOSABLE_ONE_SHOT
PORTABLE_SURFACE_RUNTIME_EPHEMERAL_OVERLAY=/run
PORTABLE_PINNED_INITRAMFS_COMPOSITION=PASS_CI
PORTABLE_QEMU_DIRECT_KERNEL_BOOT=PASS_CI_RUNTIME_V3
PORTABLE_QEMU_UEFI_BOOT=PASS_CI_RUNTIME_V3_OVMF_NON_SECURE_BOOT
PORTABLE_RUNTIME_V3_LAST_PROVEN_SOURCE_COMMIT=c8c8fe526d03ced7630420cd116dd954b08ef03a
PORTABLE_RUNTIME_V3_LAST_PROVEN_WORKFLOW_RUN_ID=35598937763
PORTABLE_RUNTIME_V3_PROOF_ARTIFACT_SHA256=73e7db317b1983f7cdf7f5be369b9e7d0509a8932235318176166d1469ca2bc3
PORTABLE_RUNTIME_V3_QEMU_DIRECT_KERNEL_BOOT=PASS_CI
PORTABLE_RUNTIME_V3_QEMU_UEFI_BOOT=PASS_CI_OVMF_NON_SECURE_BOOT
PORTABLE_QEMU_NETWORK_REQUIRED=NO
PORTABLE_QEMU_PHYSICAL_TARGET_TOUCHED=NO
PORTABLE_QEMU_SECURE_BOOT=NO
PORTABLE_PHYSICAL_USB_BOOT=NO
PORTABLE_V2_PUBLIC_WRITER_ENABLED=NO
```

The offline Stable/MVP graphical runtime is a separate EROFS artifact. Its signed Alpine lock contains 324 packages, including GStreamer Good/libav for the advertised MP3/WAV/FLAC/MP4/WebM previews and PipeWire/WirePlumber/Pulse-compatible services for native output routing. Package selection has one owner, `system/surface/runtime/packages.txt`, consumed by development provisioning and the offline builder/resolver. `docs/evidence/surface-media-audio-package-resolution-2026-10-22.json` records signed-index resolution; `bootstrap/surface-runtime/source.json` binds that report and the current-lock reproof. On source `4e67c9643e4e78c6ab071d84ba62a4005ec44a67`, Surface Runtime Candidate run **39743126535** rebuilt identical images: tree manifest SHA-256 `3372add84e7be149c11b7f8e6d1aaaf20a5af18e16d950c546d50c1df9b317c1`, normalized tar SHA-256 `ee263b12adfc73805d7e752877c0e3f525ef2f31128a01bcee149175ee301411`, and EROFS SHA-256 `6160275670bbb7485cf5d89ca9c1ef1c53fa347574c6b9001634c469dca67106` (1,145,323,520 bytes). Its proof artifact is **12410487038**, archive SHA-256 `46900749be9cf8660dfdaeacb7d9f8b5cca0e980b3cc7c2d7f9f5bfc6406dfd3`. Portable v2 QEMU run **39743125963** on the same source passed direct boot, one-shot rollback and OVMF/systemd-boot with networking disabled and no network required for first boot. Its metadata artifact is **12411065881**, archive SHA-256 `f29555b1f29d174962171845d37e1349c4f01290ac115bb5aa5308cb23df6d5c`. This proves reproducible software images and an offline virtual handoff only; the device-less PipeWire startup probe does not open a speaker or prove physical playback. Speaker, headset, hot-plug and volume behavior remain hardware validation gates. Camera and microphone capture remain denied. Generated machine identity and Fontconfig caches stay outside signed bytes. Release-manifest/3 binds the runtime by SHA-256, Creator preseeds the content-addressed bytes, the candidate PID1 re-verifies v3 offline and mounts the runtime read-only beneath an ephemeral OverlayFS in `/run`, and the Stable launcher refuses boot-time `apk add` provisioning. The exact older runtime-v3 handoff was proven at source `b9e1b164d7510f2dfc7572e473642b8fb885fa8c` in both direct-kernel QEMU and non-Secure-Boot OVMF/UEFI with networking disabled and no physical target touched. **This proves the older signed offline runtime handoff, not a complete graphical Surface session on real hardware; the final Stable/MVP USB graphical boot remains a physical validation gate.**

Portable v2 itself has now crossed the CI boot-handoff gate with the final two-partition layout: the direct-kernel QEMU proof and the UEFI/OVMF + systemd-boot proof both reached `ORDAX_PORTABLE_V2_HANDOFF=VERIFIED` and `ORDAX_STABLE_INIT_HANDOFF=VERIFIED`, selected the exact `current` slot/source identity, ran with QEMU networking disabled, destroyed disposable guest state afterward and did not touch a physical target device. The UEFI proof uses non-Secure-Boot OVMF; **Secure Boot and physical USB boot remain unproven**.

CI proof remains distinct from physical boot evidence and does not authorize the public writer.

## Minimal bootstrap and canonical release path

The product bootstrap/release architecture remains distinct from the owner/development USB Git path.

```text
FULL_SYSTEM_PRESEEDED=NO
NORMAL_APPS_PRESEEDED=NO
REMOTE_CORE_PRESEEDED=NO
CONTROL_PLANE_PRESEEDED=NO
SSH_PRESEEDED=NO
BUILD_TOOLCHAIN_PRESEEDED=NO
KNOWN_GOOD_OFFLINE_BOOT_REQUIRED=YES
RELEASE_BUNDLE_TOOLING_IMPLEMENTED=YES
DETERMINISTIC_SYSTEM_TAR=PASS
REAL_REPOSITORY_SYSTEM_BUNDLE=PASS
RELEASE_MANIFEST_TOOLING_IMPLEMENTED=YES
RELEASE_SIGNING_TOOLING_IMPLEMENTED=YES
RELEASE_PIPELINE_CI=PASS
RELEASE_AGENT_CANONICAL_SHA256=550df685679f1bf15a636729960fe6fc3ffc1afda1a346214ce96716f7170a66
RELEASE_AGENT_HASH_ADDRESSED_ASSET_PUBLISHED=YES
RELEASE_AGENT_PUBLICATION_RELEASE_ID=393818764
RELEASE_AGENT_PUBLICATION_SOURCE_COMMIT=3db77f679b85f8f62a87ce8aab3414c9c12f688a
RELEASE_AGENT_LEGACY_SEED_SHA256=721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740
PRODUCTION_RELEASE_PUBLISHED=NO
CANONICAL_GITHUB_LATEST_RELEASE=NONE_404_VERIFIED_2026_09_25
CANONICAL_GITHUB_RELEASES_CURRENT=PRERELEASE_TECHNICAL_ONLY_VERIFIED_2026_09_25
SIGNED_TRUST_TRANSITION_PROTOCOL=PASS_CI_SIGNER_AGENT
TRUST_TRANSITION_SIGNER_VERIFIER=PASS_CI
TRUST_TRANSITION_RELEASE_AGENT_VERIFIER=PASS_CI
TRUST_TRANSITION_SIGNER_AGENT_WORKFLOW_RUN_ID=35640416446
TRUST_TRANSITION_RELEASE_AGENT_WORKFLOW_RUN_ID=35640416481
TRUST_TRANSITION_STATEFUL_DEVICE_ACTIVATION=NO
BOOTSTRAP_EFFECTIVE_ROTATED_TRUST_SELECTION=NO
PRODUCTION_ROTATION_READY=NO
PUBLIC_TRUST_PROMOTION_TOOL=IMPLEMENTED_FAIL_CLOSED
PUBLIC_TRUST_PROMOTION_CANONICAL_INPUT=OrdaX-Public-Trust-Handoff.zip
PUBLIC_TRUST_PROMOTION_ZIP_CHECK=PASS_CI
PUBLIC_TRUST_PROMOTION_ZIP_APPLY_ISOLATED=PASS_CI
PUBLIC_TRUST_PROMOTION_WORKFLOW_RUN_ID=35642338419
PUBLIC_TRUST_PROMOTION_PHYSICAL_WRITE_SIDE_EFFECT=NO
FULL_BOOTSTRAP_CANONICAL_TRUST_PROOF=PASS_MAIN
FULL_BOOTSTRAP_CANONICAL_TRUST_WORKFLOW_RUN_ID=35661774796
FULL_BOOTSTRAP_CANONICAL_TRUST_PROOF_ARTIFACT_SHA256=079aad05492867000989fa2c2768b8a29354f9458fa0d791171f4ed02dbe3d0b
```

The canonical release channel resolves `release-envelope.json`; the URL selects bytes and Ed25519 verification decides authenticity. The release acquisition code remains fail-closed with SHA-256 verification, exact source-commit binding, safe materialization, atomic activation and known-good preservation.

### Canonical release trust — public anchor and v4 candidate proof bound; physical consent pending

```text
RELEASE_TRUST_POLICY=RESOLVED
TRUST_POLICY_SCHEMA=prototype-ordax.release-trust-policy/1
CANONICAL_KEY_ID=ordax-prototype-release-v1
CANONICAL_KEY_MATERIAL_GENERATED=YES
CANONICAL_PUBLIC_TRUST_SHA256=d2836df77a3d5a54ccf64cc5643cfd5c19052efc83f2e3e2666c6d3197fce250
CANONICAL_TRUST_RECOVERY_VERIFIED=YES
PUBLIC_ANCHOR_PINNED=YES
RELEASE_TRUST=PASS_CANONICAL_PUBLIC_ANCHOR_PINNED
PRIVATE_SIGNING_KEY_IN_GIT=FORBIDDEN
PRIVATE_SIGNING_KEY_IN_USB=FORBIDDEN
PRIVATE_KEY_CUSTODY_OWNER=repository-owner-developer
RELEASE_SIGNING_BACKEND_CURRENT=LOCAL_PEM_CONTROLLED_PROTOTYPE
RELEASE_SIGNING_BACKEND_PRODUCTION_TARGET=MANAGED_NON_EXPORTABLE_KMS_HSM
GITHUB_IS_KEY_CUSTODIAN=NO
MANAGED_KMS_HSM_REQUIRED_FOR_FIRST_PHYSICAL_PROOF=NO
SIGNED_TRUST_ROTATION_REQUIRED_BEFORE_BROAD_PUBLIC_DISTRIBUTION=YES
RECOVERY_PUBLIC_HANDOFF_SHA256=85d4f8430f0a4066ebed84a410071409c112c65aa72a5818483a664a41b91e20
LOCAL_ENCRYPTED_BACKUP_COPY_VERIFIED=YES
EXTERNAL_OFFLINE_BACKUP_CUSTODY_CONFIRMED=NO
EXTERNAL_OFFLINE_BACKUP_REQUIRED_BEFORE_BROAD_DISTRIBUTION=YES
PUBLIC_TRUST_PROMOTION=PASS_PUBLIC_HANDOFF_VALIDATED
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=YES
PHYSICAL_AUTHORIZATION_ELIGIBLE_BY_TRUST=YES
CANONICAL_V4_HISTORICAL_SOURCE_COMMIT=b924ff8d74d1761232381ae3f9604bba17497cfd
CANONICAL_V4_RELEASE_STATUS=PUBLIC_PRERELEASE_NOT_LATEST_CURRENT_CANDIDATE
CANONICAL_V4_RELEASE_PROOF_HISTORY=PASS_SIGNED_MATERIALIZED_EXACT_PRE_HARDENING
CANONICAL_V4_RELEASE_PROOF_HISTORY_SHA256=2dd17580ddbf5a0fd0433a912e97e6bded04fd0a44ea0849e9da15e13df01e4b
CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN=PASS_POST_HARDENING_SIGNED_HTTPS_MATERIALIZED_AND_BOUND
CANONICAL_V4_RELEASE_PROOF_BINDING_CURRENT_MAIN=PASS
PHYSICAL_OWNER_AUTHORIZATION_RECORDED=NO
PHYSICAL_OWNER_AUTHORIZATION_REACHABLE=YES_EXPLICIT_OWNER_CONSENT_REQUIRED
PHYSICAL_WRITE_ALLOWED=NO_EXPLICIT_OWNER_AUTHORIZATION
PHYSICAL_WRITE_SCOPE=first-real-stable-mvp-usb-proof
PHYSICAL_WRITE_RELEASE_SEQUENCE=1
PHYSICAL_TARGET_SELECTED=NO
PHYSICAL_TARGET_DESTRUCTIVE_CONFIRMATION=PENDING
```

The eligible Windows trust toolkit from canonical `main` source `2172eb6a18430910afd036199ec492ad63dc185d` (workflow run `35617567458`) completed operator steps 1, 2 and 3 on 2026-09-21. The uploaded `OrdaX-Public-Trust-Handoff.zip` was then independently revalidated: archive shape, exact public hashes and the recovered Ed25519 signing proof all passed. The exact public anchor is pinned at `bootstrap/trust/release-ed25519.json`, and the minimal bootstrap trust group is resolved. The private key remains outside Git/USB/Actions artifacts and is not recorded here. A same-host encrypted backup copy was verified byte-for-byte; this is accepted for the first controlled prototype but is not independent off-device custody, which remains required before broad public distribution. Public trust promotion itself did not authorize destructive media writes. On 2026-09-22 the owner provided the exact Stable/MVP authorization phrase for scope `first-real-stable-mvp-usb-proof`, release sequence 1, bound to the then-current 15-artifact writer context; later writer changes invalidated that consent. On 2026-09-26 the exact v4 candidate was signed, published as a prerelease, materialized and verified by the source-owned agent, aggregated with the signed-handoff proof, and bound to the physical authorization contract. The proof binds source commit `b924ff8d74d1761232381ae3f9604bba17497cfd`, manifest SHA-256 `ddab1681ffecacca000ff1014d3b354978c1f4a785985998b673816e18e65b85`, envelope SHA-256 `cc89cf7436357c5d479624d74e32325d4eb249a6fc1334385fb55827c313f5c9` and proof SHA-256 `2dd17580ddbf5a0fd0433a912e97e6bded04fd0a44ea0849e9da15e13df01e4b`. The prerelease did not move GitHub's stable `latest` channel. The current writer change invalidates the previously recorded owner consent, so the authorization contract is fail-closed with `physical_write_allowed=false`; fresh explicit owner authorization is required before any target-specific preparation or application. No USB is selected or currently authorized for a new destructive write; live USB revalidation, Windows UAC and target-specific destructive confirmation remain later independent gates.

## Creator and physical-write boundary

```text
CREATOR_CORE_IMPLEMENTED=YES
CREATOR_COMPONENT_CHANNEL_STATUS=CANDIDATE_ENABLED
CREATOR_COMPONENT_PUBLICATION_ALLOWED=NO
CREATOR_VERIFY_PAYLOAD_IMPLEMENTED=YES
CREATOR_STAGE_TREE=IMPLEMENTED_TRANSACTIONAL
CREATOR_DISPOSABLE_GPT_FILESYSTEM_PROOF=PASS
CREATOR_WINDOWS_TARGET_DISCOVERY=PASS
CREATOR_WINDOWS_SYSTEM_DISK_EXCLUSION=PASS
CREATOR_WINDOWS_NATIVE_RAW_DISK_BACKEND=PASS_TAGGED_UNBOUND
CREATOR_WINDOWS_RAW_BACKEND_BUILD_TAG=ordax_raw_backend
CREATOR_WINDOWS_RAW_BACKEND_BUILD_TAG_ISOLATION=PASS
CREATOR_WINDOWS_RAW_BACKEND_IN_PUBLIC_BUILD=NO
CREATOR_NATIVE_BACKEND_PUBLICLY_REACHABLE=NO
CREATOR_PORTABLE_PHYSICAL_WRITER_IMPLEMENTED=YES_TAGGED_INTERNAL
CREATOR_PORTABLE_PHYSICAL_WRITER_OPERATION_COUNT=39
CREATOR_PORTABLE_PHYSICAL_WRITER_ARTIFACT_READBACKS=17
CREATOR_PORTABLE_PHYSICAL_WRITER_WHOLE_DISK_RAW=NO
CREATOR_PORTABLE_PHYSICAL_WRITER_UAC_REQUIRED=YES
CREATOR_PORTABLE_PHYSICAL_WRITER_LIVE_USB_REVALIDATION=YES
CREATOR_PUBLIC_PHYSICAL_APPLY_IMPLEMENTED=NO
PHYSICAL_WRITE_AUTHORIZED=NO_EXPLICIT_OWNER_AUTHORIZATION
PHYSICAL_TARGET_SELECTED=NO
PHYSICAL_TARGET_DESTRUCTIVE_CONFIRMATION=PENDING
```

The Windows destructive backend remains compile-time isolated behind `ordax_raw_backend` and unreachable from the public Creator command. The final Portable writer is now implemented inside that tagged boundary: it executes the Core-owned 39-operation `ORDAX-ESP + ORDAX-DATA` plan, with 17 exact artifacts including the Local AI runtime and its signed-release digest reference, and performs per-artifact sync/readback SHA-256+size verification without a target-sized whole-disk RAW image. **Implementation alone does not authorize use.** Canonical v4 trust, proof and source bindings resolve, but the current writer change invalidates the previously recorded owner authorization. Fresh explicit owner consent must be recorded against the current authorization context before a destructive candidate can be prepared or applied. The candidate release is a prerelease and has not moved the stable `latest` channel. Public reachability remains closed, and choosing/revalidating a concrete USB plus Windows UAC and the target-specific destructive confirmation remain separate execution gates.

The byte-complete media workflow remains proven with ephemeral CI trust and disposable media only. That proof establishes composition and growth behavior; it does not establish canonical public trust or authorize a product-media write. The notebook development-USB boot is a separate physical proof and must not be used to collapse those boundaries.

## Recovery

```text
RECOVERY_ENTRY=YES
RECOVERY_ORDAX_MOUNT=READ_ONLY
RECOVERY_AUTOMATIC_NETWORK=NO
RECOVERY_SSH=NO
RECOVERY_AUTOMATIC_MUTATION=NO
RECOVERY_PHYSICAL_EXERCISE=PENDING_FINAL_VALIDATION
```

## Host independence and remote access

```text
WSL_REQUIRED=NO
QEMU_REQUIRED=NO
POWERSHELL_REQUIRED=NO
BASH_REQUIRED=NO
SPECIFIC_DEVELOPER_DESKTOP_OS_REQUIRED=NO
END_USER_KERNEL_TOOLCHAIN_REQUIRED=NO
THIN_HOST_ADAPTERS_ALLOWED=YES
SSH_REQUIRED=NO
REMOTE_CORE_REQUIRED=NO
CONTROL_PLANE_REQUIRED=NO
```

## Physical state

```text
OWNER_DEVELOPMENT_USB_PRESENT=YES
PHYSICAL_NOTEBOOK_BOOT_PROVEN=PASS_DEVELOPMENT_USB
PHYSICAL_NATIVE_GRAPHICS=PASS_DEVELOPMENT_USB
PHYSICAL_PRIMARY_INPUT=PASS_DEVELOPMENT_USB
PHYSICAL_NATIVE_RESTART=PASS_DEVELOPMENT_USB
PHYSICAL_NATIVE_SHUTDOWN=PASS_DEVELOPMENT_USB
PHYSICAL_LIVE_UPDATE=PASS_DEVELOPMENT_USB
PHYSICAL_GUARDIAN_SUPERVISOR=PASS_DEVELOPMENT_USB
PHYSICAL_RESCUE_CHANNEL=PASS_DEVELOPMENT_USB
PHYSICAL_TELEMETRY_RELAY=PASS_DEVELOPMENT_USB
CANONICAL_SIGNED_RELEASE_BOOT_PROVEN=NO_PHYSICAL_STABLE_MVP_PENDING
CANONICAL_NATIVE_DISK_INSTALL_PROVEN=NO_POST_MVP
CREATOR_PUBLIC_PHYSICAL_APPLY_IMPLEMENTED=NO
RELEASE_TRUST=PASS_CANONICAL_PUBLIC_ANCHOR_PINNED
PHYSICAL_AUTHORIZATION_ELIGIBLE=YES_PREFLIGHT_ONLY_EXPLICIT_OWNER_CONSENT_PENDING
PHYSICAL_WRITE_AUTHORIZED=NO_CANONICAL_V4_RELEASE_PROOF_PENDING
PHYSICAL_TARGET_SELECTED=NO
PHYSICAL_TARGET_DESTRUCTIVE_CONFIRMATION=PENDING
MVP_SURFACE_SMOKE_HARNESS=PASS_SOURCE
MVP_SURFACE_SMOKE_TOUR_ITEMS=12
MVP_SURFACE_SMOKE_ACCOUNT_MEMORY=REQUIRED_WITHOUT_ONLINE_LOGIN_DEPENDENCY
MVP_SURFACE_SMOKE_PHYSICAL=PENDING
CANONICAL_STABLE_GRAPHICAL_MODE=PENDING
PUBLIC_PHYSICAL_APPLY=NO
```

Do not reinterpret `PASS_DEVELOPMENT_USB` as canonical release/install proof. The proven target today is the owner/development Git-first USB on the tested notebook.

The source-controlled Stable/MVP physical smoke harness is now ready for the verified Stable runtime and remains non-promotional until executed on the real Stable/MVP USB. The running Surface publishes a private ephemeral proof context, and the harness fails closed unless that context identifies the exact Owner/Development dynamic runtime or `stable-mvp + verified-erofs-overlay + canonical-stable-mvp` with its verified runtime SHA-256. The Stable graphical runtime no longer depends on or mounts a Git repository. The smoke also checks configured/applied physical keyboard state, preserves baseline/after comparison, rejects mixed runtime evidence, and requires all 12 manual tour items — including Account/Memory without requiring an online login — plus a fresh fail-closed finalization. This is source/CI readiness only: `MVP_SURFACE_SMOKE_PHYSICAL=PENDING` and `CANONICAL_STABLE_GRAPHICAL_MODE=PENDING` remain authoritative until real hardware evidence exists.

## Deferred/final physical validation

The following are intentionally left for later/final hardware validation rather than blocking current product development:

```text
SURFACE_ONLY_NATIVE_HOST_RESTART_PHYSICAL=PASS_DEVELOPMENT_USB
SUSPEND_RESUME=PENDING_FINAL
AUDIO=PENDING_FINAL
GRAPHICS_ACCELERATION_QUALITY=PENDING_FINAL
LONG_RUN_STABILITY=PENDING_FINAL
RECOVERY_PHYSICAL_EXERCISE=PENDING_FINAL
BROADER_HARDWARE_COVERAGE=PENDING_FINAL
```

## Current priorities

The disposable QEMU activation inspectors replay only the committed ext4 journal
on a copied persistent-state image before mounting that copy read-only. QEMU is
stopped after a durable serial marker without a clean guest unmount, so inspecting
with `noload` before journal replay can expose uncheckpointed metadata. General
filesystem repair is forbidden; the original guest disk remains untouched by
inspection and is reused for the independent second boot. This correction does
not itself establish a passing cold-health or physical proof.

1. prioritize the Stable/MVP **USB system path**: preserve the green source/QEMU/UEFI path, complete canonical signed Stable v4 materialization with the proven local-AI runtime, then close the later real-hardware gates for first canonical USB boot, cold health, known-good promotion and rollback without coupling ordinary app changes to a full system reboot;
2. keep the **local inference payload** pinned and reproducible: the exact llama.cpp/model artifacts, real-byte v4 materialization and disposable QEMU/UEFI v4 path are already CI-proven; the remaining non-physical release gate is canonical Stable signing/materialization, without making AI boot-critical;
3. keep PT-BR/en-US launch coverage regression-closed and continue Spanish, German and French migration without exposing those hidden compatibility locales as complete before their Surface coverage reaches the same standard;
4. keep the current first-party apps useful and coherent as Beta components, focusing app work on correctness, regression coverage and genuine MVP gaps; move an app toward production-independent packaging only when the signed `component-slot` path is actually ready to prove it;
5. continue hardening staged/transactional Owner/Development Git-first activation while keeping it explicitly separate from the Stable/MVP public update channel;
6. execute the integrated Surface smoke only on the eventual Stable/MVP physical USB for canonical promotion; Owner/Development evidence remains development-only and CI or an unexecuted runbook must never become physical PASS;
7. continue account/cloud preference and workspace continuity through neutral contracts without making an authenticated provider or cloud sync an MVP boot dependency;
8. keep the already-pinned canonical Ed25519 public trust stable, keep private signing material outside Git/CI/chat, and treat independent off-device custody plus managed non-exportable signing as broad-distribution hardening rather than an unfinished first-prototype trust ceremony;
9. keep all physical writers fail-closed after scope authorization until non-published candidate review, exact target confirmation/UAC and post-write verification are deliberately completed; source/CI readiness alone never selects or authorizes erasing a particular USB;
10. continue product experience work that does not weaken boot safety, including the early graphical OrdaX splash with mandatory text fallback; leave suspend/resume, audio, acceleration-quality, long-run and broader-hardware exercises for final physical validation unless an MVP gate depends on them sooner.

## Autonomous recovery and observation boundary

```text
NORMAL_UPDATE_CONTROL=GIT_MAIN
BOUNDED_RECOVERY_CONTROL=GIT_ORDAX_RESCUE
OBSERVABILITY=SUPABASE_ORDAX_OS_RELAY
REMOTE_SHELL=NO
SUPABASE_COMMAND_CHANNEL=NO
GUARDIAN_NETWORK_ACCESS=NO
SUPERVISOR_GIT_ACCESS=YES
INTENTIONALLY_BAD_UPDATE_ROLLBACK_PHYSICAL_PROOF=PENDING
FULL_A_B_RUNTIME_ACTIVATION=NO
BASE_UPDATE_A_B_CONTRACT=DEFINED
BASE_UPDATE_FAT32_STAGING_PROOF=PASS_DISPOSABLE_CI
BASE_UPDATE_CANONICAL_TRUST_EXERCISED_BY_FAT32_PROOF=NO
BASE_UPDATE_PHYSICAL_HARDWARE_PROVEN=NO
BASE_UPDATE_PHYSICAL_WRITER=NO
```

The temporary Supabase project is an operational relay, not product authority. It may be migrated later without changing the device identity or telemetry contract. Git `main` remains product source authority; `ordax-rescue` remains a separate, deliberately narrow recovery path.

## Canonical documentation freshness

The Foundation regression suite compares this snapshot against structured owners for product version, first-party app versions/release modes and seed/transitional-media geometry. A source change that makes those values stale must fail CI until the canonical snapshot and nomenclature contract are updated in the same change. Portable v2 remains governed separately by `docs/contracts/portable-usb-v2.json`; transitional geometry must never be mistaken for the final public MVP target.

## Handoff rule

Any new AI/conversation must read `AGENTS.md`, this file and the canonical contracts before changing source. It must also reconcile current structured source with the snapshot before planning work from a historical statement. CI alone never proves physical boot, native graphics or destructive safety. For the tested owner/development USB notebook, physical native graphics/input/power/live-update claims are supported by `docs/evidence/physical-native-surface-2026-09-17.md`; those claims still do not promote CI trust, authorize physical mutation, prove canonical signed release acquisition or declare the product complete.


## Runtime component trust identity

The signed `component-slot` protocol intentionally uses a trust domain separate
from whole-OS release signing. Source now defines the operator ceremony and
fail-closed policy for the first component identity, but no canonical component
key is pinned yet.

```text
COMPONENT_TRUST_DOMAIN=runtime-components
COMPONENT_TRUST_KEY_ID=ordax-runtime-components-v1
COMPONENT_TRUST_CEREMONY=PENDING_OPERATOR_EXECUTION
CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED=NO
COMPONENT_PUBLISH_ALLOWED=NO
PRODUCTION_COMPONENT_SLOT_ACTIVATION_ALLOWED=NO
```

Only a reviewed public anchor may later enter
`system/trust/runtime-components-ed25519.json`. The matching private key remains
external to Git/device and must pass independent derivation plus encrypted-recovery
signing proof before public pinning.

The Native Surface now has a fail-closed, read-only component-slot broker backed
by the signed `ordax-runtime-component-channel` helper. It is available only for
Stable/MVP USB when both the helper and a real component trust file exist, and it
revalidates component bytes through the verifier rather than trusting writable
slot paths directly. Source also implements non-activation probation: Notes'
`import-contract` candidate is imported only inside a temporary opaque-origin
frame, with no host port, and the exact unknown-health pending revision is checked
before and after import. The candidate is never mounted and the result cannot
launch it; `healthy` here proves only the import/export contract, not runtime
health. No host-owned mount-health probe is wired. The Native health recorder is
bound to the exact component identity and probation revision, the system-owned
nonce-bound health bridge exposes no generic HTTP mutation authority, and the
promotion policy can only return hold/reject/promote decisions. Neither the
recorder nor policy executes promotion, rejection or rollback. The canonical
component trust file is not pinned, so the broker remains unavailable in the
current product and production component-slot activation remains blocked. The
next authority boundary is a separate Native executor consuming exact
revision+identity policy decisions only after canonical component trust and the
promotion/rollback proof gates are satisfied.

PUBLIC_ACCOUNT_LIFECYCLE_CONTRACT=PASS_SOURCE_OWNER_DEFINED
PUBLIC_ACCOUNT_CLOSE_FLOW=PASS_SOURCE_AND_GATEWAY_DEPLOYED_DISABLED_REQUIRES_REAL_PROOF_BEFORE_ACTIVATION
PUBLIC_ACCOUNT_DATA_EXPORT_FLOW=PASS_SOURCE_DB_EDGE_AUTHENTICATED_PUBLIC_DISABLED

PUBLIC_ACCOUNT_DATA_EXPORT_RPC=ordax_account_export_v1_SECURITY_INVOKER_RLS

PUBLIC_IDENTITY_GATEWAY_SOURCE=V16_POLICY_PROJECTION_SPACES_READ_DEPLOYED_REV22
PUBLIC_ACCOUNT_CLOSE_SOURCE=PASS_DISABLED
PUBLIC_ACCOUNT_CLOSE_MAIN_GATEWAY_DEPLOYED=YES_SOURCE_V16_REV22_DISABLED
PUBLIC_ACCOUNT_LIFECYCLE_SERVICE=DEPLOYED_REV2_GLOBAL_REVOCATION_DISABLED_VERIFY_JWT

PUBLIC_ACCOUNT_DATA_EXPORT_NATIVE_USB=PASS_SOURCE_READ_ONLY_SESSION_BOUND
PUBLIC_ACCOUNT_DATA_EXPORT_SURFACE_UX=PASS_SOURCE_SIGNED_IN_SAME_ORIGIN_DOWNLOAD

PUBLIC_AUTH_EMAIL_CONFIRMATION_POLICY=PASS_PROVIDER_VERIFIED_MAILER_AUTOCONFIRM_FALSE_2026_10_07
PUBLIC_AUTH_REDIRECT_ALLOWLIST_POLICY=REVIEWED_SAME_ORIGIN_NO_WILDCARD_CANONICAL_ORIGIN_SELECTED_PROVIDER_VERIFICATION_PENDING

PUBLIC_ACCOUNT_CLOSE_GATEWAY_ROUTE=DEPLOYED_DISABLED
PUBLIC_ACCOUNT_CLOSE_LIFECYCLE_SERVICE=DEPLOYED_DISABLED
PUBLIC_ACCOUNT_CLOSE_ENABLED=NO
PUBLIC_ACCOUNT_CLOSE_DISABLED_PROOF_HARNESS=PASS_SOURCE_CREDENTIAL_FREE

MEMORY_CAPTURE_POLICY_BOUND_AUTO_SAVE=PLATFORM_SERVICE_RETAINED_ASSISTANT_APP_NOT_MOUNTED_GATE_A
ASSISTANT_AUTO_MEMORY_EXTRACTION=PASS_SOURCE_STRICT_JSON_FAIL_CLOSED
ASSISTANT_AUTO_MEMORY_AUTHORITY=COMPOSITION_OWNS_DEVICE_ACCOUNT_SPACE
ASSISTANT_AUTO_MEMORY_SECRET_FILTER=PASS_SOURCE_CREDENTIAL_SIGNAL_REJECT
ASSISTANT_AUTO_MEMORY_SOURCE_EVIDENCE=PASS_SOURCE_VERBATIM_USER_TURN_REQUIRED_NOT_PERSISTED
ASSISTANT_AUTO_MEMORY_PERSISTED_CONTENT=VERBATIM_USER_EVIDENCE_ONLY_NO_MODEL_PARAPHRASE

MEMORY_MANUAL_ENTRY=PASS_SOURCE_NATIVE_ACCOUNT_SURFACE
MEMORY_APP_MUTATION_PORT=PASS_SOURCE_ASYNC_REVIEW_CAPTURE_SHARED_NATIVE
MEMORY_ACCOUNT_PROTECTED_PROVIDER_NATIVE_WIRING=PASS_SOURCE_FIXED_ENTITLEMENT_ROUTE_NO_CLOUD_TRANSPORT
MEMORY_ACCOUNT_PROTECTED_PROVIDER_CORRUPTION_POLICY=RECOVERY_REQUIRED_BLOCK_BEFORE_LOCAL_MUTATION
MEMORY_ACCOUNT_CRASH_RECOVERY_NATIVE=PASS_SOURCE_NON_BLOCKING_SIGN_IN_AND_RECONNECT_RETRY
MEMORY_ACCOUNT_PROTECTED_PROVIDER_PUBLIC_CLOUD_PROMOTION=NO

MEMORY_AUTO_CAPTURE_PREFERENCE=PASS_SOURCE_DEVICE_LOCAL_DEFAULT_ON
MEMORY_EXACT_CAPTURE_DEDUP=PASS_SOURCE_EXACT_ONLY


CLOUD_MEMORY_SYNC_BOUNDARY=PASS_SOURCE_DISABLED
CLOUD_MEMORY_TWO_CLIENT_PROOF=PASS_SOURCE_EXECUTION_PENDING_PREPROVISIONED_ENTITLEMENT
CLOUD_MEMORY_PROOF_ENTITLEMENT_OPERATOR=DEPLOYED_OPERATOR_ONLY_NO_GRANT
CLOUD_MEMORY_LOCAL_FIRST_IDENTITY=PASS_SOURCE_UUID_V4_PRESERVED_DEPLOYMENT_PENDING
CLOUD_MEMORY_NATIVE_FRESH_INSTALL_RESTORE=PASS_CI_COMPOSITION_MEMORY_BEFORE_CHECKPOINT_NO_ECHO
CLOUD_MEMORY_NATIVE_PHYSICAL_REINSTALL_PROOF=NO

Account-owned and Space-owned Memory are currently local OrdaX Memory ownership domains, not a released cloud-sync claim. The dedicated control-plane database contains RLS-protected `ordax_memory_items` plus a separate sync-object stream, and the server-authoritative `ordax_apply_memory_mutation_v1` boundary is deployed so canonical Memory and its sync/tombstone mirror advance atomically. The manual proof harness is now source-ready for two independent authenticated sessions of the same dedicated non-admin account: Client A creates/edits/deletes while Client B independently consumes the incremental sync stream, attempts a stale mutation that must be rejected, and verifies the canonical deleted state. Public cloud Memory remains disabled because execution still requires a deliberately preprovisioned `memory.cloud.enabled` entitlement and a real authenticated run; the proof itself never creates that grant or uses service-role authority. The operator-only issue/revoke boundary is now deployed in `ordax-control-plane`, owned by `postgres` and inaccessible to `anon`, `authenticated` and `service_role`; no proof entitlement has been issued and the live active-grant count remains zero. Independent client dual-write remains forbidden; device/session/project/restricted Memory remain outside the initial cloud-sync eligibility boundary.


PROFILE_PROVISIONING_COMPLETED_GATES=RECEIPT_INVENTORY,TRUSTED_EXECUTOR,HEALTH_ROLLBACK,SURFACE_CATALOG_UI
PROFILE_PROVISIONING_NEXT_GATE=FIRST_PUBLIC_PROFILE_PROOF
PROFILE_PROVISIONING_FIRST_PUBLIC_PROFILE_PROOF=BLOCKED_CANONICAL_TRUST_PUBLICATION_REQUIRED


### Operational realtime / Web / Mobile foundation

The product now has a provider-neutral source contract separating account synchronization
from live operational events and remote device actions. `ordax.operational-event/1` uses
Space-scoped aggregate identity, server sequence and revision; device mutations use
`ordax.device-action-request/1` + `ordax.device-action-receipt/1` and must be matched
to an explicit approved Device Agent write grant.

This foundation is intentionally non-activating. There is no released Android APK, no public
operational realtime transport and no public remote-device Action Gateway yet. Web/Mobile/
Desktop/Native/MCP share the same future action boundary; account sync is not a command queue,
notifications are not source of truth, and push payloads are not command authority.

Machine-readable owner: `docs/contracts/operational-realtime.json`.

## Personal OrdaX orchestration foundation

Personal OrdaX is now a mounted **Native foreground orchestration** capability, not merely a
source-only architecture stub. It reuses the canonical identity session, Space selection, Projects,
Memory/Intelligence and tool-grant authorities; it does not own a parallel identity, Memory, sync,
permission or project system.

`ordax.personal-work-item/1` binds every Work item to the exact device/account owner and optional
explicit Space/project. `ordax.personal-activity/1` is the ordered user-visible activity stream,
`ordax.personal-work-result/1` stores bounded reasoning results with fixed `authority=none`, and
approvals/decisions/attempts are persisted in the same owner partition. Account/Space/project
changes pause affected active Work and cannot silently retarget it. Stale inference responses are
discarded.

### Personal OrdaX foreground runtime

The Native composition mounts the canonical Personal OrdaX runtime plus its owner-partitioned
device store and Activity app. The Surface supports deliberate Work creation, visible
`waiting-approval`, explicit pause/resume/cancel/remove, approval/deny controls and bounded result
review. Durable owner records are capped and validated; corrupt durable bytes are preserved rather
than silently reset. Account sync remains separate from operational Work state.

One real foreground side effect is enabled:
`ordax-native-file-space/files.directory.ensure`. It is intentionally narrow and idempotent.
Execution requires an explicit human approval, a short-lived exact grant, matching
owner/Space/project/Work/approval/resource/tool/action/effect, matching SHA-256 identity for the
tool/adapter artifact, and final revalidation immediately before the adapter is resolved. The
runtime persists an `ordax.personal-action-attempt/1` before adapter entry. A crash or ambiguous
post-adapter failure becomes `uncertain`, revokes live authority and pauses Work; there is no
automatic replay.

The authority-free Action Proposal boundary is source-ready and connected to an explicit
foreground planner action. The catalog can produce an ephemeral
`ordax.personal-action-proposal/1` only for an existing nonterminal Work in the current owner
partition and a registered Action Catalog entry. The planner sees only
`entryId + inputKind + resourceScheme`, requires exact JSON and revalidates the candidate through
the catalog. A proposal carries only `workItemId + entryId + resourceValue + rationale`, fixes
`authority=none`, `executionAuthorized=false` and `approvalRequested=false`, and rejects
tool/action IDs, canonical resource references, grants, approvals, decisions, effects and artifact
identities. Proposal -> approval remains a separate explicit user action and there is no automatic
proposal -> execution path.

Semantic Work recovery is also source-ready as an explicit foreground lookup. Only current-owner
`queued|paused` Work without unresolved authority is eligible. Intelligence sees
`workItemId + goal + state + spaceBound + projectBound` and never receives owner/Space/Project
IDs. The returned `ordax.personal-work-recovery-suggestion/1` carries no authority, cannot switch
context and cannot resume automatically. A runtime-local binding pins owner and exact Work revision;
accepting a paused match delegates to the canonical `resume()`, which still fails closed unless
the original Space/Project context is valid.

Background/autonomous execution remains disabled. Generic external egress, device-control, shell,
raw disk, release-key access, physical writes, non-idempotent file mutations, model-generated action
proposal generation, specialist workers and hybrid cloud execution are not enabled by this runtime.

```text
PERSONAL_ORDAX_NATIVE_RUNTIME=PASS_MOUNTED_FOREGROUND
PERSONAL_ORDAX_ACTIVITY_SURFACE=BLOCKED_APP_SOURCE_REMOVED_GATE_A
PERSONAL_ORDAX_OWNER_PARTITIONED_STORE=PASS_NATIVE_DEVICE_WITH_SESSION_FALLBACK
PERSONAL_ORDAX_CONTEXT_RETARGET=DENY_PAUSE_ON_OWNER_SPACE_PROJECT_CHANGE
PERSONAL_ORDAX_APPROVAL_GATE=PASS_EXPLICIT_HUMAN_CONSENT
PERSONAL_ORDAX_FOREGROUND_ACTION_EXECUTION=PASS_ONE_BOUNDED_ACTION
PERSONAL_ORDAX_FOREGROUND_ACTION_SCOPE=ORDAX_NATIVE_FILE_SPACE_FILES_DIRECTORY_ENSURE
PERSONAL_ORDAX_ACTION_ATTEMPT_JOURNAL=PASS_CRASH_SAFE_NO_AUTO_REPLAY
PERSONAL_ORDAX_ACTIVITY_EXPORT=PASS_SOURCE_NATIVE_EXPLICIT_JSON_DOWNLOADS
PERSONAL_ORDAX_ACTIVITY_EXPORT_AUTHORITY_REPLAYABLE=NO
PERSONAL_ORDAX_ACTIVITY_EXPORT_ACCOUNT_SYNC=NO
PERSONAL_ORDAX_ACTION_PROPOSAL_CONTRACT=PASS_SOURCE_AUTHORITY_NONE
PERSONAL_ORDAX_ACTION_PROPOSAL_NATIVE_PORT=PASS_SOURCE_CURRENT_WORK_BOUND
PERSONAL_ORDAX_MODEL_TO_PROPOSAL=PASS_SOURCE_USER_TRIGGERED_STRICT_JSON
PERSONAL_ORDAX_MODEL_PROPOSAL_CATALOG_VIEW=ENTRY_ID_INPUT_KIND_RESOURCE_SCHEME_ONLY
PERSONAL_ORDAX_MODEL_PROPOSAL_AUTHORITY=NONE
PERSONAL_ORDAX_MODEL_PROPOSAL_OWNER_DRIFT=DISCARD
PERSONAL_ORDAX_MODEL_PROPOSAL_TO_APPROVAL=EXPLICIT_USER_ACTION_ONLY
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY=PASS_SOURCE_CURRENT_OWNER_EXPLICIT_REQUEST
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY_MODEL_VIEW=WORK_ID_GOAL_STATE_CONTEXT_BOUND_FLAGS_ONLY
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY_OWNER_SPACE_PROJECT_IDS_TO_MODEL=NO
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY_CONTEXT_SWITCH=NO
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY_AUTO_RESUME=NO
PERSONAL_ORDAX_SEMANTIC_WORK_RECOVERY_PAUSED_GATE=CANONICAL_RUNTIME_RESUME
PERSONAL_ORDAX_AUTOMATIC_PROPOSAL_TO_APPROVAL=NO
PERSONAL_ORDAX_AUTOMATIC_PROPOSAL_EXECUTION=NO
PERSONAL_ORDAX_BACKGROUND_EXECUTION=NO
PERSONAL_ORDAX_GENERIC_EGRESS=NO
PERSONAL_ORDAX_GENERIC_DEVICE_CONTROL=NO
PERSONAL_ORDAX_PUBLIC_STABLE_AUTONOMY=NO
```

Canonical authority: `docs/PERSONAL-ORDAX.md` +
`docs/contracts/personal-ordax.json`.


## Spaces por domínio/capabilities — fundação + primeiro provider real — 2026-10-15

A fundação de Spaces por domínio/capabilities está mergeada na `main` e resolve semântica `domain.subtype`, capabilities permitidas, navegação contextual, widgets/métricas de dashboard, projeção de métricas dos cards de Espaços e contexto Aura por Space. O owner técnico do catálogo é `system/services/spaces/type-catalog.mjs`; o compositor fail-closed é `system/services/spaces/composition.mjs`; contratos versionados ficam em `system/contracts/space-experience.mjs`.

A disponibilidade não nasce do tipo nem do Profile Pack. Uma capability só entra na projeção quando um provider real do owner retorna snapshot `ready` ligado ao mesmo Space. Widget/card exige ainda a métrica exata; ausência não vira zero/mock. Provider ausente, inválido ou com erro degrada sem impedir a Surface. A composição Native promove agora somente `aura`, via `system/services/spaces/aura-provider.mjs`, porque a Intelligence existente já é vinculada ao Space selecionado/autorizado. O provider Aura exige o mesmo Space selecionado e inferência real disponível, não emite `aura.summary` sintético e não promove orders/tables/printers/finance ou qualquer outro owner transacional ainda inexistente.

O contrato de capability provider exige escopo explícito por `spaceTypes`. Capabilities homônimas em verticais diferentes não compartilham owner por acidente: providers da mesma capability só podem coexistir com escopos de tipo disjuntos, e a seleção é feita por `capability + space type`. Aura declara somente `food.pizzeria` e `fabrication.3d-printing`, os dois tipos atualmente promovidos.

A identidade semântica canônica do Space passa a pertencer ao registro de conta (`public.ordax_spaces.domain` + `subtype`) e é projetada pelo `/account/spaces` até `ordax.spaces/1`. As colunas são pareadas/validadas e permanecem nullable apenas para compatibilidade com registros legados; novos inserts exigem semântica explícita e um Space já canônico não pode regredir para `null/null`, enquanto legado pode ser promovido posteriormente. Não há backfill derivado de Profile Pack. O fallback por binding de Profile Pack continua somente para legado e não concede capabilities. O export de conta preserva `domain/subtype` sem alterar a fronteira `account-export/1`. A apresentação do tipo para a pessoa usuária é resolvida por `system/services/spaces/presentation.mjs`: `domain/subtype` explícitos sempre vencem, o Profile Pack só identifica tipo para registro legado sem semântica canônica e um tipo explícito desconhecido nunca cai silenciosamente no Profile Pack. O Profile ativo pode aparecer somente como contexto técnico secundário.

Estado operacional em 2026-10-15: a migration `20261015153000_space_semantics_v1` já foi aplicada e verificada no destino `ordax-platform` (`jhfphsjptrpmtnzkpwud`), que continua sem Spaces persistidos. O `ordax-account-gateway` do destino permanece na revisão 13 enquanto a credencial de gestão `SUPABASE_ACCESS_TOKEN` não está configurada no GitHub Actions. O workflow `OrdaX Account Gateway Destination` é fail-closed: sem a credencial registra `NOT_DEPLOYED` e não instala CLI, não publica Edge e não altera cutover/registro público.

`food.pizzeria` e `fabrication.3d-printing` estão estruturados como fundação MVP compatível com os Profile Packs existentes. `product-operations.territorial-platform`, `education.school` e `development.software` estão estruturados, porém `DEFERRED`: o compositor publica zero navegação/widget/capability para eles até promoção explícita posterior. Development modela muitos Projects dentro de um único Space e Studio apenas como ferramenta de abertura do Project. Escola preserva REL-001 e não introduz tracking/câmera irrestritos. Achegue-se permanece operacional, não um Space de desenvolvimento.

Profile Pack continua sendo composição técnica versionada e seus manifests não receberam uma segunda cópia de navigation/dashboard/provider state. A sidebar global continua independente da navegação contextual. Nenhum kernel, base, Creator, physical-write ou workflow físico faz parte desta mudança.


## Account display name in the authenticated session — source only — 2026-10-20

The authenticated `/auth/session` projection now optionally reads `ordax_accounts.display_name` with the same user's access token and the table's existing owner-scoped RLS policy. A missing or unavailable profile row does not invalidate login. The Native gateway and Windows emulator preserve only the bounded display-name field; account credentials and provider tokens remain outside Surface JavaScript. The shared identity adapter uses this name when present and keeps its existing email-handle fallback when it is absent.

```text
ACCOUNT_DISPLAY_NAME_SESSION_PROJECTION=PASS_SOURCE_RLS_BOUND
ACCOUNT_DISPLAY_NAME_NATIVE_AND_EMULATOR_FORWARDING=PASS_SOURCE
ACCOUNT_DISPLAY_NAME_PROFILE_PHOTO_OR_COUNTRY=NOT_AVAILABLE
ACCOUNT_DISPLAY_NAME_EDGE_DEPLOYMENT=PENDING_GATEWAY_DESTINATION_CREDENTIAL
```

This source change does not claim that the live Supabase Edge Function has been deployed. The existing destination remains on provider revision 13 until the reviewed gateway deployment credential is configured.
