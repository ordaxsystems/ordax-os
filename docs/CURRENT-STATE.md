Warning: truncated output (original token count: 47702)
Total output lines: 2489

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
A reconciliação preserva essas mudanças e acrescenta os testes de r…22702 tokens truncated…ry Surface changes reload the browser, native-host changes restart only the Surface, supervisor/guardian changes use a controlled supervisor restart, and boot/bootstrap changes are marked as requiring a later reboot instead of rebooting automatically. The guardian monitors the supervisor's state-file heartbeat and can restart a stalled supervisor child without returning to the Development Base maintenance shell. The controlled `exit 75 -> guardian refresh -> supervisor restart` path has been physically exercised on the target notebook.

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

The offline Stable/MVP graphical runtime is a separate EROFS artifact. The reviewed 324-package lock includes GStreamer Good/libav for the advertised MP3/WAV/FLAC/MP4/WebM preview formats and the PipeWire/WirePlumber/Pulse stack plus GStreamer PipeWire integration for native output routing. Package selection has one owner, `system/surface/runtime/packages.txt`, consumed by development provisioning and the offline builder/resolver. `docs/evidence/surface-media-audio-package-resolution-2026-10-22.json` binds the GitHub Actions Alpine `apk` resolution to the exact package manifest, source commit and lock digest. Surface Runtime Candidate run `39742186298` built byte-identical EROFS images for source `3cd5e4b0fe2ad087c4d4e2bc0416abac47c55042`: tree `3372add84e7be149c11b7f8e6d1aaaf20a5af18e16d950c546d50c1df9b317c1`, normalized tar `ee263b12adfc73805d7e752877c0e3f525ef2f31128a01bcee149175ee301411`, and EROFS `6160275670bbb7485cf5d89ca9c1ef1c53fa347574c6b9001634c469dca67106`. This candidate also passed the device-less PipeWire startup probe; that proves service/socket readiness without opening a speaker. The current branch still requires its offline QEMU handoff reproof before the package-lock gate closes. Physical speaker/headset output and playback remain unproven. Camera and microphone capture remain denied. Generated machine identity and Fontconfig caches stay outside signed bytes. Release-manifest/3 binds the runtime by SHA-256, Creator preseeds the content-addressed bytes, the candidate PID1 re-verifies v3 offline and mounts the runtime read-only beneath an ephemeral OverlayFS in `/run`, and the Stable launcher refuses boot-time `apk add` provisioning. The exact older runtime-v3 handoff was proven at source `b9e1b164d7510f2dfc7572e473642b8fb885fa8c` in both direct-kernel QEMU and non-Secure-Boot OVMF/UEFI with networking disabled and no physical target touched. **This proves the older signed offline runtime handoff, not a complete graphical Surface session on real hardware; the final Stable/MVP USB graphical boot remains a physical validation gate.**

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
slot paths directly. Source also implements the next non-activation layers: a
pending probation loader, an internal Native health recorder bound to the exact
component identity and probation revision, a system-owned nonce-bound health
bridge, and a fail-closed promotion policy that can only return hold/reject/promote
decisions. The bridge does not expose generic HTTP mutation authority and neither
the recorder nor the policy executes promotion, rejection or rollback. Because the
canonical component trust file is not pinned, the broker remains unavailable in
the current product and production component-slot activation is still blocked.
The next authority boundary is a separate Native executor consuming exact
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
