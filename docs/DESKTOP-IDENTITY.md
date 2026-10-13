# OrdaX Desktop Identity

The OrdaX shared Surface identity follows the user-approved 2026-10-09 ribbon/blue-violet reference: **Midnight / Meia-noite** (dark) and **Ice / Gelo** (light). Navigation, command search, a landscape Home and a floating dock are implemented in the existing shared Surface, with the same application and preference owners across Web/Native. This direction supersedes the earlier visual candidate.

This is a product identity contract, not a screenshot contract. Implementations preserve the visual language while remaining functional, responsive, accessible, offline-capable and shared across supported hosts.

## Canonical visual language

- midnight navy and ice canvases, with opaque working application surfaces;
- ice text in dark mode and deep blue ink in light mode;
- blue/violet/cyan for brand decoration; accessible semantic accents for controls;
- thin structural rules, rounded cards, restrained glow and translucent shell materials;
- Inter as the canonical product type family, with compact, legible controls;
- the user-approved transparent ribbon-loop image shared by the navigation, header, Home and loading screen;
- labeled lateral navigation on desktop, compact rail on intermediate widths and one-column Home on narrow surfaces;
- a top command search and real Home shortcuts; a floating dock for areas, app shortcuts, running applications, updates and connectivity.

The original mountain/arc wallpaper is an optional decorative layer behind functional HTML controls. It has no embedded text or UI. Light mode uses a shared scrim, and high contrast removes the wallpaper and translucent material. Application headings remain sized for working interfaces. Palette, geometry and motion are authoritative in the tokens, not duplicated in documentation or app palettes.

The user-approved symbol is `system/surface/ui/brand/ordax-symbol.png`, copied byte-for-byte from the transparent image supplied on 2026-10-09. Normal presentation uses its original colors; high contrast and forced colors use the same asset's alpha silhouette. Its SHA-256 and provenance, together with the original landscape, are recorded in `system/surface/ui/brand/ARTWORK-SOURCE.md`. Both assets are included by the offline source graph. The public account/Web compiler copies the symbol from this owner and verifies byte equality; it does not track a second source. No external software, runtime generator dependency or new font is introduced.

## Shared design-system ownership

`system/surface/ui/tokens.css` owns the USB palette, typography, geometry and accessibility policy. `system/surface/ui/color-palettes.css` owns standard light/dark colors moved from the approved Web stylesheet and semantic aliases for both renderers. These sources form the single source of visual policy. Each palette is declared once; Surface and first-party application styles consume that shared policy without a second palette per application.

`system/surface/ui/identity.css` is the shared component/composition layer for this identity. It may map existing components onto the semantic tokens while older component CSS is migrated, but it must not become a second token source.

`system/surface/ui/brand/symbol.css` owns symbol presentation and accessible
silhouettes. Web/Native compositions load it directly. The public compiler
derives the same rules alongside its existing token export, without changing
legal HTML transforms or introducing page-specific drawings of the mark.

Legacy palette literals must be removed from active contracts when the identity changes; they must not be retained in comments or assertions merely to satisfy obsolete tests. Projects, Notes and Internet now consume the shared semantic tokens directly in their component styles, so the temporary first-party application identity bridge is no longer part of the runtime.

Existing `appearance.theme` values (`light`, `dark`), labels (Claro, Escuro), persistence, account synchronization and the light default remain unchanged. Users switch materials in **Ajustes → Aparência**. Settings miniatures inherit the exact theme tokens through `data-theme-preview`, so they cannot drift into independent palettes. Success, warning and error retain independent semantic colors.

Normal text, secondary text and state labels must maintain at least 4.5:1 contrast on their opaque canvas/panel backgrounds; focus must maintain at least 3:1. High-contrast text maintains at least 7:1. Automated palette checks complement real browser rendering, theme persistence and responsive layout checks; they do not replace assistive-technology or physical-device verification.

Motion is restrained to short UI transitions, normally 150–250 ms, and must honor both the OrdaX reduced-motion preference and the host `prefers-reduced-motion` signal. Focus remains visibly distinct in both themes and in high-contrast mode.

## Typography and offline operation

Inter is the canonical UI/display family. The Surface ships a local Latin variable WOFF2 covering normal weights 100–900 at `system/surface/ui/fonts/inter-latin-wght-normal.woff2`. Its pinned source provenance is recorded under `third_party/fonts/` and its SIL OFL license under `third_party/licenses/`.

`tokens.css` loads that font only through a relative local URL. The declared fallback chain remains `system-ui`, `Segoe UI`, sans-serif for hosts or glyphs outside the vendored subset; no host-specific font is source authority. The Surface/Web source graph follows local CSS assets, so the WOFF2 is copied into offline bundles without introducing a runtime network dependency.

## Interaction contract

The desktop shell must remain operational rather than decorative:

- Arquivos, Projetos, Notas, Internet, Ajustes, Conta and Sistema launch their real first-party applications when their capabilities are available;
- `Ctrl+K` opens the shared application launcher;
- Home restores the desktop by minimizing existing windows through the workspace owner; it does not delete sessions;
- Home and dock shortcuts use the same app catalog, activation handler, capability checks and live localization as lateral navigation;
- continuation and pending cards appear only from real ProjectCatalog/RecentFiles/Notifications/Sync snapshots; there are no illustrative people, device counts, tasks or automation toggles;
- area controls are backed by `ordax.workspace-store/2` and independent window state;
- `+` creates a real new area subject to the workspace bound;
- power actions remain host-capability driven and require explicit confirmation;
- update status is surfaced from the update watcher rather than inferred by the UI;
- visual updates must remain compatible with live Surface reload/restart and workspace persistence;
- keyboard navigation, focus restoration, text scaling and reduced motion remain functional after visual changes.

## Landing-page boundary

The public landing is an aesthetic reference only. Its Aurora project workspace, illustrative Intelligence response, notebook/phone simulations and marketing composition are not product contracts and must not be imported into `system/` as working capabilities.

The public landing is not the palette authority for the refreshed desktop. Its demonstrations and assets do not enter the runtime. OS appearance remains owned here; independently distributed apps adopt portable visual assets through their own public integration boundary without creating another global preference owner.

## Non-goals

The visual reference must not be implemented by embedding the supplied concept image as the desktop background, duplicating the Surface per platform, introducing remote visual dependencies, copying the public demo runtime, or hiding non-functional placeholders behind presentation.

New desktop controls must have a real state owner and contract before being presented as available functionality. A redesign must not change release mode, update semantics, recovery behavior, security boundaries or physical-media policy merely for presentation.

## Acceptance and delivery

Roadmap: shared Surface identity and minimal functional desktop in `PLANO-FUNCIONAL-SURFACE-E-APPS.md`. Owner: OrdaX OS Surface. Dependencies: existing appearance/runtime/workspace/store contracts, local Inter, SVG and PNG; no new public execution contract. Scope: shared Web/Native composition, loading screen, shell, Settings previews and tokens consumed by first-party views. Risks: contrast over artwork, CSS specificity, narrow layout, image size and offline asset resolution.

Acceptance requires visual/contrast regressions, existing preference/localization tests, source-graph and deterministic bundle verification, and real Chromium shell/composition smoke. Web inspection covers desktop and narrow breakpoints and both materials. Source publication is a reviewable candidate, not production activation, a signed release or proof of USB/mobile hardware operation. A visual refresh does not require a kernel rebuild or USB rewrite.


## Canonical Web Central — 2026-10-11

The sole active Web page now mounts `Central` from
`system/surface/workspace/components/central/`, through the existing boot,
error boundary and root route in `system/composition/web/main.tsx`.
The user explicitly selected `ordaxsystems/lovable-core-ui` at
`89438133b322e3ef87e862c80af3a3dbe18251f5` as the primary presentation.
Central and classic desktop are two views within this same page, sharing
`config.ts`, visual primitives, theme tokens and the desktop-state reducer.
There is no alternate product URL, query-selected old page or redirect.

The Web palette, spacing and composition come from the adopted
`components/central/styles.css`, with local light/dark alpine assets and the
existing vendored Inter font. Native identity, public Account, services,
contracts, dependency locks and installation/release gates remain unchanged.
The reference's TanStack Start server, telemetry and remote font links are not
imported into the product. The existing shared Button/Dialog are reused.

Backend wiring is deferred at the user's request. The reference's account,
projects, activity, devices and storage are examples; the brand labels the
page as a demonstration. Prompt submission does not infer or execute actions.
Local theme/view preferences do not establish an Identity or sync service.
Existing application, Store and Intelligence consumers remain in source for
the next integration phase; the former WebShell is not mounted or exposed as
a second page. Broad code removal was rejected by automatic approval review,
so no shared application/window functionality was deleted.

Owner: OrdaX OS Surface, under `PLANO-FUNCIONAL-SURFACE-E-APPS.md`.
Provenance and reversible integration adjustments:
`docs/evidence/web-central-reference-2026-10-11.json`.
Risk: unconnected example data, viewport/focus behavior, dependency versions
and final distribution license review. Local build, npm and test execution
were explicitly excluded by the user. Updated checks are prepared for CI;
their presence is not a passing result or a release/deployment proof.

## Superseded Web presentation notes — 2026-10-10/11

The Web notes below describe the previous presentation, retained as source
history and library capabilities. They do not describe the currently mounted
Central or certify its behavior. The section above is the active Web decision.

### Previous canonical Web presentation — 2026-10-10

The approved Account Hub layout is adopted into the OS-owned portable Surface at
system/surface/workspace/. The sole Web bootstrap is system/composition/web/main.tsx.
The evaluation workspace has been removed; no compatibility route or redirect remains.

Upstream: washingtonmsdj/account-hub-pro@0f955ece6e570801976d8ed77d2cada101b7a3fa.
Digests, reversible edits and asset exclusions are recorded in
docs/evidence/web-layout-reference-2026-10-10.json. User approved copying their
supplied layout and replacing Web presentation. Upstream README states author
ownership; no LICENSE was found. Distribution license review remains pending.

Owner: OrdaX OS Surface. Root package.json/package-lock.json own dependencies;
tools/surface-web owns compilation and candidate receipts. React/router/UI code
is bundled locally. Existing shared Inter and approved symbol remain the asset
authority. Browsers need no Node, CDN or remote font to render the client.
This Web-only cutover preserves the Native operational composition and controls.

Service integration is explicitly the next phase. Studio, Files, Projects,
Spaces, Gallery, Notes, Internet, Settings, Store and Intelligence interfaces
remain, including future controls. Unavailable services cannot create accounts,
expose user files, grant tools or activate packages. Labeled Store/Intelligence
demonstrations are interface examples. Account links to canonical /conta/;
it does not create another Identity flow.

Future connections must consume existing services, contracts and adapters.
The public /web/ portal remains a separately configured Identity/runtime
handoff: this source change does not enable that production gate.
Native/domain assertions and browser proof remain; obsolete Web DOM wiring
checks are replaced by canonical compiled-client route/viewport/window proofs.

Acceptance: strict typecheck, reference integrity, atomic build receipts,
repeatable compilation, Chromium desktop/mobile proof and Native/domain
regressions. Risks: initial JS/artwork payload, dependency maintenance, final
distribution review and deferred service wiring. No kernel rebuild, USB write,
signing or production activation is implied.

## Web Store consumer — 2026-10-11

The canonical workspace Store now projects the public OS catalog port and
source-locked local AI candidate. It defaults to official mode, with an
explicit demonstration inside the same renderer. No Web transport or lifecycle
authority has been introduced. See [Store boundary and acceptance](STORE-WEB-CATALOG-PRESENTATION.md).


## Responsive compact-window panes — 2026-10-11

Owner: OrdaX OS Surface, within the functional workspace/window increment of
`PLANO-FUNCIONAL-SURFACE-E-APPS.md`. The canonical Web composition divides the
available desktop into a primary pane and a compact pane. Expanded compact
windows receive half the height after the shared navigation and mobile safe
area are deducted. Collapsing the carousel leaves only its accessible control
row; minimizing or closing the last compact window releases the whole primary
pane. The existing immersive mode remains a full-viewport option.

Geometry is owned by two CSS Grid tracks in `workspace/styles.css`. The layout
state is derived from the existing window reducer and carousel flag; there is
no second window manager or persisted geometry copy. Every AppWindow keeps its
key and parent across compact, restored and minimized modes, preserving mounted
React state. Pages and app content scroll independently. Normal windows stay
within the primary track and drag/resize measure that pane. Maximized windows
span both workspace tracks, leaving shell sidebar/navigation outside. The top edge belongs to the app; system utilities live in navigation.

Dependencies: existing workspace reducer, ResizeObserver, shared appearance
tokens and browser viewport/safe-area support. Risk: short viewports, narrow
carousel capacity, absolute grid positioning and dialog transitions. Acceptance:
strict compilation and reversible reference integrity; real Chromium proof at
320, 390, 700, 844, 1024 and 1440 px, including short-height resizing, collapse,
last-window minimization/closure, drag bounds and mounted text/filter retention.
No App, Runtime, Intelligence, Identity or device-execution authority changes.

## Mobile workspace navigation — 2026-10-11

Owner: OrdaX OS Surface, within the canonical Web workspace increment of
`PLANO-FUNCIONAL-SURFACE-E-APPS.md`. Mobile navigation uses the same
`WorkspaceNavigation`, catalog and reducer as the desktop sidebar. The bottom
bar follows the reference order: Início, Aura, Apps, Space and Menu. Aura opens
the existing Intelligence session and Space opens the existing Space picker.
Selection derives from the actual page and open dialogs; it no longer highlights
Apps permanently. Window overview is reached through the Menu footer without
creating another window manager. A scrollable bottom Dialog exposes
projects, applications, favorites and Settings with focus containment, Escape,
outside dismissal and focus restoration. Its header/close and window-action
footer remain fixed while only navigation content scrolls. The shared close
marker scopes touch-target styling to the close control instead of all buttons. The shared Dialog owns its center or
bottom placement; CSS does not counteract centered utility transforms.

Mobile titlebars retain three direct actions with 44 px touch targets; closing,
maximizing and immersive mode remain in the existing window menu. Compact
controls show the visible app and ordinal. File locations scroll horizontally,
and both grid/list controls remain visible. Search fields use 16 px type, text
and spacing remain legible at 320 px, and primary/compact tracks keep their
existing geometry and mounted app state. No separate mobile app or state store.
The launcher focuses its title on coarse-pointer devices, preserving desktop
search focus; touching the search still permits typing. Clear-search restores
input focus, category buttons expose their actual filter state, and an empty
search is announced. The launcher app list scrolls separately from its header,
search, categories and close control.

Dependencies: existing Radix Dialog, workspace/window reducer, ResizeObserver,
shared tokens and local assets. Risks: focus restoration, dialog positioning,
CSS/container specificity, short viewports and mobile/desktop transitions.
Acceptance: strict compilation and reversible reference verification; real
Chromium checks at 320, 390, 700, 844, 1024 and 1440 px, including touch input,
menu traversal, Escape/outside dismissal, breakpoint transition, grid/list
selection, touch target sizes, split geometry and mounted text/filter retention.
Launcher proof additionally covers touch/desktop focus, category/query filtering,
no-results feedback, clear-query, native touch scrolling with a stationary
header/close, and launch/reopen at short mobile heights.
This source/candidate improvement does not connect pending service ports,
change Native or activate production.


### Responsive Home structure — 2026-10-11

The user-provided `ordax_os_web_inicio_responsivo.html` is a structural
reference, recorded by digest in the existing Web provenance ledger. Home uses
one React composition: welcome/Space entry, the shared Intelligence card and
environment shortcuts, application grid, project continuation and activity.
Desktop uses two overview/continuation columns; narrow layouts use one, with
three application columns and two at 365 px or below. The Web touch shell uses
the 820 px boundary and safe-area padding; dragging follows CSS presentation
instead of keeping a second JavaScript breakpoint. Existing Surface tokens,
app catalog, action handlers and Intelligence session remain their owners.
The HTML prototype scripts, simulated account/projects and alternate logo
are not imported. Unconnected service states remain explicit.

The existing workspace grid still owns primary/compact tracks. Home has one
scroll container in the primary pane and its Intelligence draft survives
compact expansion/collapse; no window node is reparented or remounted. Search,
notifications, identity, launcher, window overview and compact controls remain
available. Source work is an explicitly requested functional-plan increment,
not a new mobile app or a change to release/installation authority.

Risks: nested overflow, short heights, card reflow and touch-shell transitions.
Acceptance: strict build/reference restoration, real Chromium at 320, 390,
700, 820, 821, 844, 1024 and 1440 px, Home ordering/grids and native touch
scrolling, accessible control sizes, 8 direct views, launcher/menu focus and
shared app/draft retention through compact modes.

### Full workspace app opening — 2026-10-11

Owner: OrdaX OS Surface, under the same functional-plan window increment. New
windows open maximized; detaching a compact app also fills the available
workspace. Explicit normal geometry, minimizing and compact modes remain
choices, and reopening a manually restored window retains that choice. Page
entries (Projects, Spaces, Store, Apps and Intelligence) use the complete primary
area without reserving a hidden compact control row. Their transitions preserve
the Home pane preference; explicit compact actions reveal split panes again.

The existing reducer owns opening/restoration/focus. The window stage isolates
its stacking below shell chrome; per-window layers no longer saturate at 35,
so the latest opened/focused app stays in front after repeated switches. No app
node is remounted or reparented, no second window manager or service authority.
Risks: maximized grid bounds, stacking contexts and page/compact transitions.
Acceptance: reducer lifecycle/geometry and repeated-focus checks, strict build,
source reference restoration and real Chromium at eight viewports. Every app
entry fills the workspace and owns the hit-test foreground; all page entries
fill the shell content area, with compact, immersive and draft state retained.

### System utilities in navigation — 2026-10-11

Owner: OS Surface. Explicit user-requested continuation of full workspace opening.
The shared WorkspaceChrome component places brand/search and account/notifications in the desktop sidebar through
shared WorkspaceAccount. Mobile Menu keeps these utilities. The Web shell has no
clock, clock state or refresh interval. There is no shell topbar or reserved header
row: apps/pages own the top edge, bounded only by device safe area, sidebar and
bottom navigation. Search remains available through Apps/Ctrl K and the Menu;
Space switching remains in the desktop sidebar/mobile Space destination.
Sidebar navigation scrolls separately from its utilities; the collapsed sidebar
keeps icon actions accessible. No identity, service, app state or authority is copied.

Risks: short-height navigation, dropdown focus, mobile menu dismissal, expanded
workspace bounds and compact pane geometry. Acceptance: eight responsive viewports,
64 direct routes, foreground/full workspace opening, compact restoration, mobile
launcher/Menu/identity/notification reachability, safe-area offsets, no horizontal
overflow and original app draft/node retention. Existing Home controls enforce
44 px touch minimum at the shared tablet/mobile breakpoint.

### Full-height sidebar and floating dock — 2026-10-11

Owner: OS Surface; explicit user-requested layout revision. Desktop sidebar reaches
the viewport bottom, including account/notifications. The footer contains only the
centered app dock: no full-width background, blur or separator line. Only the dock
receives pointer input. Space selection/window arrangement move to the sidebar;
connection state remains in the existing sidebar service status. Workspace extends to the bottom behind the dock; content padding preserves
app control reachability without a reserved footer strip. No second window
manager or app state is introduced. Mobile retains the five-destination navigation.
Acceptance: sidebar bottom aligns with viewport, dock centers in usable width,
transparent/pointer-transparent footer, sidebar collapsed controls, notification
opening and mobile menus at desktop/short/tablet widths.

## Shared Central window lifecycle — 2026-10-11

User-requested increment in the Surface functional plan: minimize, compact,
collapse, expand, maximize, restore and close in the approved primary Web UI.
Owner: OrdaX OS Surface. Dependency: shared UI controls and presentation-only
Central data; no new Runtime, grants, identity, storage or intelligence authority.

`central/desktop-state.ts` owns the active window lifecycle for both presentations.
Central holds the reducer; Desktop consumes it. `central/window-layer.tsx` renders
one keyed, stable app instance per title. Minimized and inactive apps stay mounted
but hidden; close removes the instance. Switching Central/Desktop preserves these
instances, local drafts and modes within the current page session. Page reload
and closing a window discard this local presentation state; this is not durable
project memory or task persistence.

New windows open maximized in the app area. Mobile compact mode reserves a lower
half in the viewport grid, above navigation and running-app controls; the current
Central/app retains an independently scrollable upper half. Collapse reserves
only the titlebar; minimize releases the compact track. Desktop uses a bounded
lower panel. The same CSS tracks size the background and window layer, including
safe-area clearance. No iframe duplication, viewport scaling or second active
window manager is introduced. Shared controls have accessible names and 44px
window-action targets; focus moves to the active window or its restore shortcut.

Risk: viewport/focus regressions, hidden app resource usage and draft loss on
explicit close/reload. Backend apps are still pending; illustrative panels do not
claim a real connection. Source provenance retains upstream hashes and records
normalized derivative hashes and reasons for these authorized modifications.

Acceptance: one open instance per app; compact/minimize/restore preserve the same
app DOM and draft; minimized apps remain reachable; close removes them; mobile
panes fit above navigation with independent scrolling. Existing reducer/browser
checks were updated to cover the increment, but NOT executed locally. No build,
npm, typecheck or test was run, per the user's explicit restriction. Browser and
CI evidence remain pending; these notes do not establish production readiness.

## Shared bottom navigation — 2026-10-11

User-requested Surface increment: Central/Desktop switching moves to the button
beside Start, in exactly the same mounted bottom navigation in both views.
`WorkspaceNavigation` owns the launcher and consumes the shared window reducer;
all open/minimized apps are listed after the toggle. It is rendered once outside
the view presentations. The former top switch, separate Central running strip
and five-item mobile navigation are removed from this active presentation.
Mobile destinations remain accessible through Start; running apps scroll within
the dock while Start and the view switch stay fixed. Safe-area spacing and the
reserved bottom track apply equally to both views. No backend or authority change.

Owner: OS Surface. Dependencies: existing Central reducer and shared Button.
Risk: launcher focus and viewport spacing. Acceptance: one navigation node,
constant toggle position beside Start, reachable open apps in both views and no
app remount on switching. Existing browser-check source is updated; build, npm
and tests were not executed, according to the standing user restriction.

## Full-height shared sidebar — 2026-10-11

User-requested Surface revision: one sidebar spanning the entire viewport in
Central and Desktop, including the area beside the bottom running-app dock.
Start and the view toggle now belong to this sidebar; the dock lists running apps.
The sidebar is mounted once outside either presentation and never scrolls.
ResizeObserver measures its navigation slot; visible destinations fit 44px rows
with 4px gaps, and a More button opens the existing launcher for remaining items.
The narrow layout uses a 64px icon rail; short layouts leave utilities reachable
through the launcher. Compact mode does not shorten the sidebar. Shared CSS
rail width reserves the same space for the main area, apps and bottom dock.

Owner: OS Surface. No new backend, execution or permission authority. Risks:
small viewport spacing and hidden overflow controls. Acceptance: one full-height
non-scrolling sidebar, Start/toggle inside it, destinations reachable via More,
and running apps on the bottom dock without covering the rail. Existing browser
check source updated; no build, npm or tests executed under the user restriction.
This supersedes the location of Start/toggle in the previous bottom-nav notes.

## Sidebar launcher row and account card — 2026-10-11

User-requested presentation adjustment: restore the simple LayoutGrid four-square
view switch beside Start in one horizontal row, and place the referenced account
card at the sidebar bottom. `AccountCard` reuses Avatar, Button and theme tokens;
its Space and settings actions use the existing shared window launcher.
`presentationAccount` and the derived usage percent in Central config are the
single demonstration fixture for this card and the Space panel. No live quota,
subscription or identity backend is inferred from the sample 128/500 GB and Pro.
The narrow rail keeps the launcher horizontal with compact 24x44px controls and
an icon/usage card; small heights keep Space accessible while details remain in
the Space panel. Measured More overflow still prevents sidebar scrolling.

Owner: OS Surface. Risk: narrow-rail spacing and source provenance drift. Acceptance:
four-square icon without toggle text, both launch controls on the same row, bottom
card with avatar/plan/derived usage/settings, same state in both views. Source review
and whitespace inspection only; build, npm and tests not run under user restriction.

### Home row notification control — 2026-10-11

User-requested Surface placement: pin Home and its notification icon in a single
shared sidebar row. Remaining destinations keep the measured More overflow; the
previous lower standalone notification control is removed. Both actions remain
separate keyboard-accessible buttons and use the existing launcher/state. The
narrow rail preserves the same horizontal row. Very short layouts retain access
to Space via Start. No backend changes; no build, npm or tests executed.

### Dock-edge view switch — 2026-10-11

User-requested revision: remove Start from the sidebar and move the existing
four-square Central/Desktop switch to the bottom dock's right edge, replacing
the Minimize All button. The switch retains one shared instance, accessible target
labels and current view state; it does not close/minimize apps on switching.
Home is the window-focus fallback. More retains overflow destination access.
This supersedes the previous sidebar launcher-row placement. Owner: OS Surface;
no backend changes. Existing browser checks were adapted, not executed. Build,
npm and local tests remain unexecuted under the standing user restriction.

### Compact bottom dock height — 2026-10-11

Requested Surface density adjustment: shared dock height decreases from 58px to
40px, with 32px-high controls and unchanged 44px minimum widths. CSS tokens own
these dimensions; the workspace/compact tracks and menu clearance derive from
the same dock height. Mobile retains additional safe-area clearance. Backend
and window state unchanged; no build, npm or tests executed per user restriction.

### Maximized app fills available workspace — 2026-10-11

User-requested correction: the existing default maximized app state now fills the
entire window grid track without outer margins, rounded gaps or Desktop-header
clearance. The shared layer already excludes sidebar width and dock height; the
maximized selector takes precedence over both desktop/mobile presentation rules.
Normal restored and compact modes keep their separate layouts. Owner: OS Surface;
no backend/state authority change. Existing browser-check source includes available
area bounds; no build, npm or tests executed under the standing user restriction.

## Central viewport layout without page scrolling — 2026-10-11

User-requested Surface increment: Central/Home fits the actual available workspace
container, including reduced height during compact split mode. A size container and
CSS grid tracks replace the vertically scrolling presentation. No page transforms,
whole-page scaling or second workspace state. Full layouts retain hero, shortcuts,
summary panels and space/devices; narrower layouts select one of Projects/Apps/
Activity panels with a shared local presentation selection. Height queries reduce
summary item counts and, in short panes, prioritize Aura, shortcuts and More options.
Hidden sections and add actions remain available through the existing launcher/
windows or Central overflow menu. Aura modes use the same state through a select
when chips cannot fit. App-window bodies retain their independent scrolling.

Owner: OS Surface; CSS tokens, shared UI, demo fixtures and existing window reducer.
No backend/grant changes. Risk: container-query sizing, zoom/keyboard viewport and
access to hidden summaries. Acceptance: no Main scroll overflow at supported sizes,
visible overflow entry above the dock, accessible full lists/actions, preserved
theme/drafts and compact window behavior. Existing viewport-check source updated;
no build, npm, typecheck or tests run under the user's standing restriction. Visual
and automated viewport evidence remain pending; this source increment is not a
production-readiness claim.

## Collapsible sidebar and lower account utilities — 2026-10-11

User-requested Surface revision: remove visible OrdaX OS Web/More Options labels
from the Home footer, retaining an accessible icon for overflow destinations and
the mode select where required. Move the sidebar bell into AccountCard's action
row beside settings, removing the Home-row bell. Add one sidebar collapse control.
Central owns the presentation mode (auto/collapsed/expanded); CSS owns resolved rail
width and responsive layout. The existing resize observer reads that resolved
layout for the control's accessible expanded state. No second window manager.
Desktop collapse frees app space; mobile expansion overlays the content instead
of shrinking the already narrow work area. App instances remain mounted.

Owner: OS Surface. Risk: responsive rail sizing and narrow account action spacing.
Acceptance: no visible footer labels, one sidebar bell next to settings, operable
collapse/expand in both views, available overflow/actions and stable app instances.
Existing browser-check source updated; no build, npm, typecheck or tests executed
under the user's standing restriction. No backend authority or real quota change.

### Remove Home ellipsis modal entry — 2026-10-11

Explicit user revision: remove the Home-footer ellipsis button and its More-modal
branch. The footer only reserves height when the responsive Aura mode selector is
needed. Sidebar navigation and measured overflow remain available independently.
Owner: OS Surface; no backend/window-state change. Existing check source updated;
no build, npm or tests run under the standing restriction.

### Sidebar edge chevron — 2026-10-11

Explicit Surface styling request: move the existing collapse control outside the
sidebar header flow to the divider edge, centered vertically. A left/right chevron
shows collapse/expand direction. It has no persistent button frame and uses shared
theme hover/focus feedback; its 24x44px target and accessible labels are retained.
The CSS rail/visual-width variables position it for desktop and mobile overlay
modes. One state/control remains; no window remount or backend change. No build,
npm or tests executed under the standing user restriction.

### Single-line sidebar storage caption — 2026-10-11

Requested account-card readability adjustment: show used/limit once as 128 / 500 GB
in the expanded rail, with nowrap and tabular numbers. A compact rail shows the
same fixture's derived 25.6% usage (localized decimal), keeping the full used/limit
in the tooltip and accessible progress metadata. No smaller illegible font,
ellipsis hiding units or wrapped quota sentence. Actions stay beside each other.
Owner: OS Surface; presentation-only quota, no backend change. No build, npm or
tests executed under the standing user restriction.

### User name in sidebar account card — 2026-10-11

Requested presentation change: the account card title now uses the shared demo
user display name instead of the Space name. Avatar name/initials consume the
same presentation fixture; the existing single-line truncation is retained with
full-name tooltip/accessible labels. Space labels elsewhere retain their own
meaning. The account action/real identity backend is unchanged and remains
pending. Owner: OS Surface. No build, npm or tests run under user restriction.

### Edge chevron aligned with logo — 2026-10-11

Requested placement revision: the outside-flow edge chevron now uses the shared
sidebar top inset and logo-row height for its vertical position, rather than the
viewport midpoint. The header and arrow consume the same CSS geometry in expanded,
collapsed and narrow modes; short layouts retain the logo row with a smaller inset.
Owner: OS Surface. State, app layout and backend unchanged. No build, npm or tests
executed under the standing user restriction.

### Visible sidebar edge control — 2026-10-11

Requested visibility revision: the existing logo-aligned chevron now has an
opaque theme surface, contrasting border, subtle elevation and a larger, heavier
icon. Hover/keyboard focus use shared accent tokens. The same control remains
outside sidebar flow in both themes and responsive states. Owner: OS Surface.
Acceptance: visible resting control with unchanged sidebar behavior and geometry.
No build, npm or tests executed under the standing user restriction.

### Neutral app frame and Home-aligned chevron — 2026-10-11

Owner: OS Surface. Active windows use the same neutral border token as the
resting shell, without the lime active-frame highlight. Automatic region focus
does not paint the frame; keyboard focus retains an inset visible indicator.
The divider chevron aligns with Home using shared header, gap and Home-height
tokens across responsive sidebar modes. Window lifecycle and app contracts
remain unchanged. Acceptance: neutral resting app edges and Home-centered arrow.
No build, npm or tests executed under the standing user restriction.

### Compact divider chevron — 2026-10-11

Owner: OS Surface. Requested size refinement reduces the edge button to 24 by
32 pixels and its chevron to 16 pixels, retaining the shared contrasting surface
and Home-row alignment. No behavior or contract changes. No build, npm or tests
executed under the standing user restriction.

### Single desktop brand in sidebar — 2026-10-11

Owner: OS Surface. Removed the duplicated Brand from the desktop header, keeping
the shared sidebar as its sole brand location. Existing theme/profile actions
remain right aligned; app and window behavior are unchanged. No build, npm or
tests executed under the standing user restriction.

### Desktop controls through sidebar — 2026-10-11

Owner: OS Surface. Removed the desktop header profile and theme buttons.
Theme switching remains in the existing Appearance settings, reached through
the shared sidebar gear; no duplicate theme state/control was added. Removed
the now-empty header and its workspace clearance. Acceptance: desktop has no
duplicate account header; sidebar Settings still exposes the theme action.
No build, npm or tests executed under the standing user restriction.

### Central controls consolidated in sidebar — 2026-10-11

Owner: OS Surface. Removed duplicated profile, notifications and theme actions
from Central hero/mobile headers, including the repeated mobile brand. Narrow
grid tracks no longer reserve space for that header. Sidebar account/bell/gear
remain shared entry points; Appearance uses existing theme state. Existing
browser-check source follows Settings but was not executed.
No build, npm or tests run under the standing user restriction.

### Responsive hero landscape — 2026-10-11

Owner: OS Surface. Removed the older viewport rule that hid hero wallpaper
and overlay below 760px. A single hero image selects the existing day/night
asset from shared theme state; removed conflicting display overrides.
Central retains clipped rounded hero and theme foreground at narrow widths.
Acceptance: landscape remains visible in both themes and responsive layouts.
No build, npm or tests executed under the standing user restriction.

### Time-aware Central greeting — 2026-10-11

Owner: OS Surface. Replaced fixed date and theme-dependent greeting with local
browser date/time and the shared presentation user fixture. Refresh on minute
interval and window focus has effect cleanup; accessible time carries ISO value.
No separate identity source or backend inference. Acceptance: greeting matches
local hour across themes; date updates after midnight and resume.
No build, npm or tests executed under the standing user restriction.

### Current destination from window SSOT — 2026-10-11

Owner: OS Surface. Sidebar current destination derives from the existing window
state, with project windows grouped under Projects and Intelligence under Aura.
Home highlights only Central without an active visible window. Navigation and
overflow entries expose aria-current; More indicates a current hidden destination.
No second navigation state or execution authority added. Acceptance: open,
focus, minimize and close update the indicated destination from the same reducer.
No build, npm or tests executed under the standing user restriction.

### Multiple compact apps — 2026-10-11

Owner: OS Surface. All non-minimized compact apps divide the available width
equally in one flex strip, with zero basis and no horizontal strip scrolling.
Regular windows anchor to the shared outer layer above the strip. Each keyed
app stays under one stable parent across modes; focusing a visible compact pane
preserves neighbor order and collapsed state. Minimize/close redistributes the
remaining divisions. Narrow cards adapt their title, control grid and content
layouts to the panel width. Vertical app-body scrolling remains available.
Existing browser-check source covers two non-overlapping compact apps and node
preservation, but was not run. Acceptance: N panels share the available width
equally, without hidden offscreen panels or duplicate instances; drafts and
independent window actions remain intact. Runtime/backend unchanged.
No build, npm or tests executed under the standing user restriction.

### Compact titlebar density — 2026-10-11

Owner: OS Surface. Compact headers use a single 40px row instead of a 76px
stack. Controls are 28px with 6px gaps; close gets additional separation.
Below 260px, close remains visible and secondary actions use the existing
accessible dropdown component. One typed action list feeds buttons and menu,
preserving reducer authority and equal pane geometry. Full app title is
available on hover. Existing browser-check source follows either control mode.
Acceptance: shorter header with distinct controls and all actions reachable.
No build, npm or tests executed under the standing user restriction.

### Upper app follows available compact geometry — 2026-10-11

Owner: OS Surface. Regular and compact windows now use one direct grid rather
than absolute regular positioning inside a nested compact strip. The main app
spans all columns in the upper track; compact apps occupy equal lower columns.
Both window layer and Central stage use the existing --compact-track token,
so collapsing/expanding reallocates height without independent measurements.
No compact panels reserves zero lower space. App-body container queries use
actual panel width in either mode. Stable keyed instances/reducer are retained.
Existing browser-check source covers a new upper app, no overlap and height
growth/restoration on compact collapse/expand, but was not executed.
Acceptance: upper app fits the available track, expands when the lower track
shrinks/disappears, and retains content and controls. Backend unchanged.
No build, npm or tests executed under the standing user restriction.

### Running-app identification — 2026-10-11

Owner: OS Surface. Window headers and dock use one icon primitive resolving
existing navigation/favorite/project metadata with a generic unknown-app fallback.
Dock exposes active-window aria-current, descriptive state tooltip and a distinct
minimized marker while preserving readable labels and restore actions. No new
window or service state. Acceptance: recognizable icons agree across surfaces;
minimized/active indications follow the shared reducer. Backend unchanged.
No build, npm or tests executed under the standing user restriction.

### Dock label density follows available width — 2026-10-11

Owner: OS Surface. Dock measures label font metrics, icon/padding widths and
row gaps against available width. When labels would overflow, all tasks switch
to 44px icon buttons; labels return when space permits. Calculation uses natural
dimensions independent of the hidden-label mode to avoid oscillation.
ResizeObserver, window resize and font readiness refresh density; cleanup guards
late font callbacks. Window count/title changes also remeasure. Accessible names,
full title/state tooltips and active/minimized indicators remain intact.
Acceptance: crowded dock shows icons, wider/less crowded dock restores names.
No build, npm or tests executed under the standing user restriction.

### Narrow Central uses vertical capacity — 2026-10-11

Owner: OS Surface, continuation of the shared Central composition. The former
width-only panel selection left tall, narrow areas with one oversized summary.
Container queries now retain tabs below 680px of available height and stack
Projects, Favorites and Activity above that threshold, reusing the same nodes.
All summary items remain accessible in this tall mode; bounded cards can scroll
internally when necessary while the main page remains within its work area.
Lower Space/device summaries appear when vertical capacity permits; very narrow
layouts reserve additional height for their stacked arrangement. Aura modes use
the existing chips when width permits and the existing selector otherwise.
Compact-window reservations and sidebar width still determine the single named
container; no viewport observer, alternate page or duplicate product state added.
Acceptance: tall narrow Central does not hide Apps/Activity merely because of
width, and shorter compact work areas retain reachable panel selection.
Only source/diff review performed. Visual verification remains pending.
No build, npm or tests executed under the standing user restriction.

### Web Central account and Spaces binding — 2026-10-12

Owner: OS composition/Surface, explicit backend-alignment request under the
Surface functional plan. Existing public ordax.identity-session/1,
ordax.identity-actions/1 and ordax.spaces/1 adapters now feed one React context
for the sidebar, greeting and account/Spaces windows. Same-origin auth/session,
auth/logout and account/spaces remain owned by the existing gateway; no new
authentication service, credential cache, device transport or access grants.
Identity refresh is coalesced and runs on focus/visibility/online. Subject
changes reset/abort the old catalog, and the session workspace key clears local
drafts/windows while unchanged-subject refresh preserves mounted apps.
Spaces is read-only; Web still lacks the selected-Space context port.

The approved responsive geometry, landscape, themes, compact/minimized windows,
shared sidebar and adaptive dock remain intact. Demo account/Pro/quota,
projects/activity and online-device records no longer represent this page.
Their cards/destinations remain, showing unavailable transport/service state.
Favorites remain client launcher shortcuts, not an installed-app assertion.
Account commands are guarded against concurrent submission and stale UI writes.

Source input graph and provenance include the reused adapters/contracts and
new composition/context. Regression source covers authentication gating,
request coalescing, logout, subject replacement/late response and disposal.
Acceptance: one verified session drives the UI; unavailable origin does not
invent user data; old-subject catalog cannot survive account replacement.
Static diff/source review only; no build, npm, tests or browser validation ran.
A standalone Vite/static host without the same-origin gateway remains
unavailable. No deployment, production activation or authenticated E2E claim.

### Web Central explicit Space selection — 2026-10-12

Owner: OS Surface/composition; requested continuation of backend alignment under
the Surface functional plan. Reuses ordax.space-selection/1,
ordax.space-selection-store/1 and createSpaceSelectionRuntime, the same domain
service composed by Native. The existing Web selection adapter now supplies
a validated session-only record; no localStorage, credentials, second catalog,
backend endpoint, sync or new authority. The unavailable adapter stays for hosts
that have no configured selection composition.

The canonical service now owns subject-change catalog reset instead of the
previous composition-side reset, removing duplicate responsibility. Only an
explicitly clicked active Space in the authenticated catalog can be selected.
Catalog refresh hides unavailable context until revalidation, while preserving
a valid same-account selection in memory. Removal/archiving clears the record;
logout/account replacement clears it permanently. A new page/composition starts
unselected. Disposal releases the canonical service's subscriptions.

Central shows the selected Space in the existing lower summary. The Spaces
window uses the same theme/row geometry, accessible pressed buttons, disabled
archived entries, and a clear-selection control. Other app instances/windows,
compact geometry, sidebar and dock remain unchanged; this choice does not
activate files/device access or inference and is not a grant.

Risk: stale/unauthorized context and accidental selection during refresh.
Acceptance: explicit selection only; subject/catalog revalidation; no mutation
requests; no inherited context after logout, account replacement or disposal.
Regression source now covers these cases plus temporary catalog failure and
session-only lifecycle. Static source/diff review only: no tests, build, npm,
typecheck or browser validation executed under the standing user restriction.
Authenticated gateway/deployment/E2E remains a separate pending proof.

### Web Central canonical appearance preferences — 2026-10-12

Owner: OS preferences domain + Web composition/Surface, continuation of the
requested backend alignment. Reuses ordax.preference-store/1,
ordax.preference-runtime/1 and existing appearance.theme semantics/validators
from system/services/preferences/catalog.mjs. A portable observable binding
delegates recovery and updates to this catalog and persistence to the Web adapter;
Native's Surface reducer continues to use the same canonical definitions.
No new preference ID, palette, backend, account sync, entitlement or grant.

The mounted preferences provider survives subject workspace remounts because
these preferences are local to this browser, not credentials/account data.
Central/Desktop wallpaper and Appearance controls consume that one port.
Theme is applied before paint, also setting the browser control color scheme.
The previous direct browser-storage/theme state has been removed from Central,
and redundant theme callbacks through app windows have been removed. Switching
Central/Desktop remains session presentation state without another persisted
preference key. No legacy-key migration introduced in this pre-user increment.

Storage denial, corrupt option values or failed writes retain a safe session
choice; Appearance reports session-only persistence after a failed save.
Unchanged/unknown preferences do not write; invalid known values are rejected.
Disposal clears subscriptions and prevents later writes. The existing build
input graph records the adapter/domain binding, and provenance covers the UI.
Regression source covers persistence/reload, denied access, invalid/corrupt
values, failed writes, no-op updates and disposal. React review checked stable
external snapshots, centralized DOM effect cleanup, hook order and accessible
theme control. No build, npm, typecheck, tests or browser executed.

Acceptance: one catalog/store binding drives both existing presentations;
reload restores valid saved appearance; storage errors never break theme
selection or claim cloud synchronization. UI/viewport and authenticated E2E
proof remain pending. Existing shared window nodes/drafts are preserved during
theme changes; no desktop/window geometry or CSS palette changed.

### Web Central canonical connectivity — 2026-10-12

Owner: OS Web adapter + composition/Surface. Explicit continuation of backend
alignment; no first-party app source or platform/Runtime authority changes.
Contracts: existing ordax.surface-host/1, identity-session/actions,
Spaces catalog and ordax.space-selection/1. Browser connectivity remains an
adapter hint, never a probe or proof of gateway/device/inference availability.

The Web host keeps a stable snapshot until connectivity/capabilities change,
notifies only changes and removes subscriptions/events on disposal. Undefined
browser connectivity maps to the contract's unknown state. React consumes this
existing port with useSyncExternalStore, without a shadow connectivity store.
Offline account commands are disabled and guarded again at activation.
Identity remains the last known session and the UI explicitly warns about
staleness. Composition skips offline focus/visibility reads, uses catalog reset
to abort/invalidate Spaces, and lets the shared selection domain revalidate its
session-only record on reconnect. The in-flight refresh remains deduplicated;
a connectivity revision schedules a fresh read after an overlapping reconnect.
Only reads are replayed, never sign-in/sign-out or other commands.

Risk: online hints may be inaccurate and an identity read already in flight
may finish after disconnect. Canonical session sequencing still validates that
read, the UI continues to show offline, and composition cannot start Spaces
while offline. Existing Spaces ordinals suppress responses after reset.
Reconnection waits for an existing identity read to settle; this increment does
not add deadlines or replace the gateway's authentication lifecycle.

Acceptance: offline refresh performs no network reads; disconnect invalidates
catalog/selection, late catalog bytes do not restore context, reconnect
revalidates the same subject/Space, and disposal prevents new event work.
Regression source covers these transitions, overlapping reconnection,
unknown connectivity, stable snapshots and subscription cleanup. Included in
existing CI, not run locally. React review covered stable external snapshots,
hook order, readable offline status, guarded actions and existing cleanup.
No approved CSS geometry/theme, shared app nodes or window reducer changed.
No build, npm, typecheck, tests or browser executed. Authenticated E2E and
production activation remain pending.

### Web account bounded read lifecycle — 2026-10-12

Owner: existing OS Web identity/Spaces adapters and Web composition, continuing
the requested backend alignment. Reuses ordax.identity-session/1,
ordax.identity-actions/1 and Spaces/selection contracts. No new backend,
provider coupling, credentials store, authorization, domain snapshot or route.
The earlier connectivity increment's wait-for-old-read limitation is superseded
by adapter cancellation and a shared bounded GET transport.

system/adapters/web/json-read.mjs owns only same-origin GET plumbing: no-store,
redirect:error, JSON parsing, supersession, abort cleanup and a single 10-second
deadline covering headers/body. Identity/Spaces still validate their own
responses and own state/ordinals. A bounded read settles on cancellation even
when an injected/noncooperative fetch or JSON body does not settle; attached
handlers consume late results/errors. This is not a command transport or retry
service. Bodies from fetches already cancelled are not parsed.

The identity adapter's cancelRefresh extension belongs to its concrete lifecycle,
not the provider-neutral session contract. Composition calls it on offline;
the refresh ordinal advances before abort so cancellation preserves the last
known snapshot. Actual request timeout/failure remains unavailable, not
signed-out. Spaces reset/disposal use this same transport while retaining their
own invalidation rules. Overlapping reconnects continue through the existing
deduplicated read loop. No account command is retried or timed out by this helper.

Identity and command snapshots preserve reference identity on semantic no-ops.
Disposed session/action adapters reject new work or ignore refresh/subscription
as appropriate; disposal cannot leave a new command active. An account command
already sent to the gateway is not claimed to be undone by browser disposal.

Risk: the 10-second read deadline may expose slow gateways as unavailable/error;
the user can request a new read, and reconnect/focus use the existing lifecycle.
No automatic authenticated state is inferred from cancellation or network hints.
Source regression cases cover stalled headers/body, supersession, denied HTTP,
unsupported paths, cleanup, unchanged identity, disposed commands, offline
cancellation, fresh reconnect and suppression of late identity bodies.
Existing CI includes these sources; no local build/npm/test/typecheck/browser run.

Acceptance: account/Spaces read promises cannot keep UI refresh pending beyond
the deadline; offline/disposal release them promptly, no old identity/catalog
bytes replace a newer session, and post-disposal commands cause no network work.
Preserve approved frontend geometry, themes, sidebar/dock/compact app behavior
and canonical domain boundaries. Authenticated E2E remains pending.

### Web account local validation — 2026-10-12

The user authorized local tests, npm and build after the earlier source-only
increments. This validation supersedes their no-local-execution status; it does
not change runtime contracts, Surface geometry or release authority.
Owner remains OS Surface/Web adapters; scope is the existing account/Spaces,
preferences, Store availability and shared-window lifecycle.

On source commit 73b409a78909061c58247947ed8ebf11049bb571, 64 Node regressions passed (zero failures/skips).
The Surface build includes TypeScript and passed. The structural verifier passed
34 reference files/assets and existing window/provenance/disabled-AI checks.
The local browser confirmed 390 x 844, 768 x 600 and 1366 x 768 document sizes
without page overflow, loaded hero assets in both themes, an upper maximized app
above a compact pane, equal-width compact panes, mobile menu minimization and
explicit dock restoration. Browser dev logs returned no error/warning entries
at the start and finish. Temporary windows, theme and viewport were restored.

Limits: this Vite origin does not host the authenticated account gateway.
Transport/unit fixtures exercise account changes, stalled reads, offline
cancellation and late results; they are not evidence of a live authenticated
gateway, device control, actual billing/storage or signed app installation.
The initial JavaScript chunk is 776.99 kB (220.94 kB gzip), a performance warning
to address through measured startup code splitting, without merely raising the
warning threshold. No production activation or release claim follows.

The Apps minimum verifier separately reports 20 targets, 13 unsigned package
candidates, seven blocked targets and zero verified public installations; it is
not a production catalog. Full commands/results and source SHA are recorded in
the existing [Central provenance evidence](evidence/web-central-reference-2026-10-11.json).

### Web startup catalog boundary — 2026-10-12

Owner: OS localization and Web composition. The previous eager import of the
full Surface translator loaded unrelated application dictionaries for four boot
messages. A shared data-only boot catalog now owns the same PT-BR/English IDs
and text. Full Surface localization spreads the catalog; the current pt-BR Web
composition reads its source messages directly with a TypeScript key union.
No translator, locale state, authority or second persistent store is added.
Regional localization behavior in Native remains with its existing service.
Web locale selection remains a separate pending capability.

Risk/acceptance: future boot messages must be added once to both locale maps
in this catalog. Regression checks require identical keys, identical full
translator output and existing source fallback, and prevent eager full-catalog
imports in the Web entry. Eighteen localization tests and seven builder tests
passed; TypeScript/build passed. The structural verifier caught a recorded
checksum using Windows line endings; its adapted digest was corrected to LF
without replacing the historical digest. Verification then passed.

Measured production build output fell from 776.99 to 533.40 kB initial JavaScript
(31.35%); gzip fell from 220.94 to 167.96 kB. CSS is byte-identical. This is bundle
size evidence, not a controlled loading-time benchmark. The >500 kB warning
remains visible. Browser reload rendered the same Central with no returned
error/warning logs. No additional install, dependency, provider or new app was
introduced. Existing source graph and CI paths discover the new catalog.

The user prefers grouped main updates to reduce repeated Vercel builds. All
validation here was local; no Vercel deployment was invoked. The existing
public-site ignored-build decision was inspected, not changed. The earlier automatic approval review usage-limit failure expired; local commit
and reconciliation with main then succeeded. This round uses one grouped source
push, without bypassing release or execution gates. Authenticated gateway E2E and production gates remain
pending. See the same Central provenance evidence above.

### Canonical Store window — 2026-10-12

Owner: OS Surface and structural Store, an explicitly requested continuation of
backend/frontend alignment. Central Loja now mounts the existing StoreExperience,
not a second Store. The same read-only catalog context is retained; unconfigured
Web still has no execution/install port. Demonstration remains explicit and
separate from host state. No new catalog API, device authority or grants.

Store styles were extracted from the former shell into the component's single
stylesheet, consumed by its existing renderer. Historical provenance remains
reversible. Store aliases use Surface tokens; grids and navigation use container
width so a compact pane does not inherit the width of the full browser.
The renderer/styles load on demand. Utility compilation registers that same
component, without copying the shell or bringing the Store into initial render.

A common window-content boundary isolates rendering errors from the rest of
the workspace. Typed resource-load errors deliberately offer an explicit page
reload with a draft-loss warning, because the browser caches failed module
imports; changing React.lazy alone did not recover in the controlled proof.
Other content errors may be reset within that single window. No command is
retried. Minimizing/compacting/view changes retain the existing mounted body.

Acceptance: official mode renders actual supplied catalog entries; unavailable
hosts do not invent installed apps or enabling actions. Search persists through
window modes. No document/pane horizontal overflow in responsive checks.
A failed Store resource leaves the sidebar/other windows available and can be
recovered after the resource returns through the explicit reload control.
Final merged validation is recorded in the existing Central provenance evidence.


Merged validation: 24 Node tests and eight Python tests passed after reconciling
main at b0bad62; six Store tests passed again after the final responsive fix.
TypeScript/build and the 34-file structural/provenance verifier passed. Final
initial JavaScript is 537.86 kB (169.81 kB gzip), with Store JavaScript 49.59 kB
and Store CSS 15.11 kB loaded separately. The >500 kB warning remains visible.
In two equal compact panes at 390 x 844, the Store's 112-pixel useful width has
no horizontal overflow or controls outside its bounds in Discover/Library.
The narrow section selector uses the same descriptors and navigation handler.
A controlled HTTP 503 resource fixture verified isolation, usable Settings,
and recovery after explicit warned page reload. The fixture server/tab were
closed and the user viewport/theme restored; main-page logs returned no errors
or warnings. Authenticated gateway/catalog, signed installation, native/device
execution and production activation remain outside this local proof.


### Destination menu focus — 2026-10-12

Owner: OS Surface; bounded continuation of the requested Web integration and
robustness work. This structural accessibility correction is an exception to
individual-app polishing; it does not change Apps ownership, versions, package
eligibility, service contracts or activation gates.

The existing destination menu now consumes the shared Dialog primitive. Its
portal remains inside the workspace so the existing container geometry and
Surface tokens apply. Modal semantics, focus trapping, Escape/backdrop and close
controls belong to that one primitive; the custom overlay and global Escape
listener were removed. Search uses the existing navigation descriptors, trims
its query and announces an empty result. Central explicitly shows Home while
retaining mounted, minimized app bodies.

Selecting an app defers focus to the existing WindowLayer, which observes the
immutable active-window record, including explicit reopening of the same app.
Unrelated-window/context updates do not change this record or steal focus.
Closing without navigation returns to the Dialog trigger; if responsive resizing
removed it, the same navigation restores Home. No second window manager,
provider, backend, inference, auth state or command retry was introduced.

Risk: portaled geometry and keyboard focus require a live-browser proof.
Acceptance includes Tab/Shift-Tab containment, Escape/backdrop return, same-app
reopening, Home return, mobile clipping and retention of existing drafts.
Code validation: 36 existing workspace/account-session regressions and seven
residual-localization tests passed; TypeScript/build and verification of 34
reference files/assets passed. Manual React review checked stable hooks/refs,
active-window dependency identity, reuse of Dialog cleanup and shared tokens.
Initial JavaScript is 538.76 kB (170.05 kB gzip); the >500 kB warning remains.
The browser-control tool timed out even for a basic runtime probe, so no live
keyboard/visual proof or screenshot was captured in this increment. This is
not authenticated gateway, device-control, install or production validation.

Local preview recovery: Vite restarted in a hidden process; its startup log
reported ready and HTTP GET / returned 200 on 127.0.0.1:4201. This is server
availability evidence, not the pending live keyboard/visual or gateway proof.


#### Completed navigation browser proof — 2026-10-12

This local proof supersedes the pending browser attempt above. Owner remains
OS Surface and the same shared Dialog/WindowLayer; no contracts, dependencies,
services or authority changed. The native search label focuses its input when
tapped in its padding. Search and close have 44-pixel touch height; the close
button has a 44 x 44 target, keeping the existing glyph and Surface tokens.

Observed at 390 x 480, 390 x 600, 390 x 844 and 1366 x 480: document stayed within
the viewport and menu controls stayed inside their panel. Tab/Shift-Tab remained
in the menu; Escape, close and backdrop restored the trigger. Resizing to remove
the overflow trigger then closing returned focus to Home. Empty search announced
its result, reopening cleared the query, and backdrop did not open an app.
Selecting/reopening Aura focused the canonical pane; its unsent local draft
survived the return to Central, minimization and dock restore. Central's focus
on the restore control follows the existing window policy.

Temporary Aura and its unsent validation draft were closed; original dark theme,
Central and default viewport were restored. Browser error/warning logs returned
no entries. Screenshot: ordax-navigation-mobile-20261012.jpg, stored as a local
visualization artifact (390 x 600), not a published CI artifact.
Final TypeScript/build and verification of 34 reference files/assets passed.
Initial JavaScript: 538.76 kB (170.06 kB gzip); CSS: 79.17 kB. The >500 kB warning
remains. Authenticated gateway/catalog, inference, device execution, signed
installation and production activation are not proven by these local UI checks.


### Canonical Web accessibility — 2026-10-12

Owner: OS Surface, continuing the explicitly requested Web integration. This
bounded shared-capability increment does not polish an individual App or change
Apps cutover, package, grants, install or production gates. Dependencies remain
ordax.preference-runtime/1, ordax.preference-store/1 and the existing definition
catalog/Web adapter. No new IDs, providers, transport, database or storage keys.

Settings renders the three existing accessibility descriptors and options.
The provider consumes the same snapshot, applies shared DOM attributes before
paint and restores previous attributes/color scheme on cleanup. Typography and
line heights use rem equivalents with identical standard-scale sizes. Existing
contrast tokens are aliased only for opt-in high contrast; the normal palette
and approved layout remain unchanged. Reduced-motion policy was moved from the
Native-only stylesheet to shared tokens; host reduction also wins over the
explicit standard setting. Labels/selects remain associated and have described
help. Narrow rows stack by window container width, including Theme/Visualization.

Risk: larger text must not clip window controls or create horizontal overflow;
shared token policy affects all Surface consumers. Acceptance: choices persist
through the existing store, apply immediately, remain reversible, and survive
reload. App content may scroll vertically; workspace stays within the viewport.
No claim of universal accessibility certification or a Native hardware proof.

Validation: 15 existing Node preference/runtime tests and seven Python Web-builder
checks passed. TypeScript/build and the 34-file provenance verifier passed.
Mobile 390 x 844/480, high contrast in light/dark, 125% root typography (20px)
and reduced transitions (0s) were observed. Reload retained choices. A compact
pair initially overflowed Settings; stacking all narrow settings rows corrected
it: body clientWidth and scrollWidth both 144px, with controls inside the panel.
Original standard accessibility values, dark theme, Central and default viewport
were restored; temporary windows were closed. No browser error/warning logs.
Local screenshot: ordax-accessibility-mobile-20261012.jpg. Initial JavaScript
539.52 kB (170.34 gzip), CSS 81.04 kB; the >500 kB warning is not suppressed.
Authenticated gateway, account sync, inference/device and release gates remain
separate. Existing provenance evidence records source adaptations and local proof.


### Lazy compact actions — 2026-10-12

Owner: OS Surface. Requested Web continuation, bounded performance/reliability
work on the shared window presentation rather than individual-app polishing.
Existing React lazy/Suspense, shared DropdownMenu and desktopReducer are reused;
no dependency, service, app identity, contract, grant or storage is introduced.
CompactActions is extracted once from WindowLayer and consumes its existing
control descriptors, open-menu ID and dispatch. It owns no window state.
A stable lazy type prevents app-body remounts and avoids an eager dropdown import.

Risk: loading or failure must not strand a narrow compact window without
controls. Suspense and a boundary scoped to that menu retain an explicit Expand
button; Close always remains outside the optional resource. Expanding returns
the same app to its previous noncompact mode and reveals existing controls.
Resource rejection remains cached by the browser; no automatic retry/reload or
claim that changing window mode re-downloads a failed module. App draft/content
and the single window manager remain mounted throughout.

Acceptance and observed proof: production fixture requested no compact-actions
asset on startup, then one HTTP 200 on first compact mode. Two equal mobile panes
retained the same menu, Escape returned focus after closing, minimizing/restoring
retained the unsent draft. A separate origin returned HTTP 503 for that one asset:
two apps remained usable, Expand restored the same Aura to maximized, and its
unsent draft survived minimize/restore. Only one failed asset request occurred.
No backend commands were sent. Fixture was loopback-only, served the generated
bundle and was stopped after checking its process identity. Both temporary tabs
closed; original Central/dark theme/default viewport restored with no windows
or returned warning/error logs on the user origin. Screenshot:
ordax-compact-lazy-mobile-20261012.jpg, an external local visualization artifact.

19 existing Node workspace regressions, seven Python builder checks,
TypeScript/build and the 34-file provenance/window verifier passed. Before:
539.52 kB initial JavaScript (170.34 gzip). After: 482.31 kB (151.17 gzip), a 10.60%
initial-size reduction; CSS remained index-yPkoIz1_.css, 81.04 kB. Compact actions
are 58.48 kB (19.27 gzip) on demand. No chunk threshold override; the >500 kB
warning no longer appeared. Total code size and loading time were not claimed
to improve by that percentage. Authenticated gateway/catalog, device/inference,
signed delivery and production activation remain independent gates.


### Single mobile compact pane — 2026-10-12

Owner: OS Surface. Explicit requested responsive UX revision; supersedes earlier
mobile equal-tiling acceptance, preserving desktop tiles and service boundaries.
Selection is session presentation state in the same desktopReducer, not a second
window manager or persisted account setting. CSS uses the existing 760px mobile
breakpoint. Grid columns derive from canonical window data through CSS variables;
mobile shows only the selected compact pane, while larger screens show all panes.
Only the selected header renders the native switcher when multiple apps exist.
Hidden app bodies remain mounted; changing a pane never sends a backend command.

The reducer remembers compact selection while a regular app opens above it;
closing that upper app returns focus to the visible selected compact pane.
Minimize/close/restore reconcile selection to available windows. Focus within a
pane is respected so clicking an input or native selector does not lose focus to
its wrapper. Compact-body padding/cards are simplified; grids respond to actual
pane width. Mobile actions use shared overflow menu and separate Close, both with
44px targets. Collapsing the strip remains independent of selection.

Risk and acceptance: no inaccessible hidden pane, orphaned selection, lost draft,
focus theft or horizontal clipping; resize must reveal desktop tiles without
remounting content. New four behavior tests cover selection across upper-window
lifecycle, minimize/close/restore, collapsed switching and explicit dock recovery.
Together with 19 existing workspace regressions and seven builder checks: 30
passed. TypeScript/build and the 34-file provenance verifier passed.

Observed mobile 390 x 844: one 326px compact pane, one switcher for three apps;
upper Projects and selected lower app split available height. Closing Projects
returned focus to Aura. Unsent draft survived switching, minimization, dock
restore and resizing. At 320 x 568 with 125% text, Settings body clientWidth and
scrollWidth both 239px, controls stayed inside, and visible actions measured
44 x 44px. Applications also fit at 320px: two adaptive tile columns, no overflow.
At desktop 1366 x 768 three panes measured 378px each; switcher hidden. A collapsed
mobile pane measured 48px and allowed selection before expansion. Apps unavailable
from host remain explicit; this does not implement their backend.

Original standard text scale/dark theme and default viewport restored; all
validation windows closed and browser error/warning logs empty. Screenshot:
ordax-compact-single-mobile-20261012.jpg, local visualization artifact outside Git.
Initial JS 483.08 kB (151.32 gzip), CSS 82.46 kB; advanced menu remains a separate
58.48 kB chunk. No threshold override, new dependency or production activation.


### Footer mode selector removal — 2026-10-12

Owner: OS Surface; explicit removal of the lower Aura mode selector. Only its
footer markup, unused styling and reserved responsive grid tracks were removed;
other controls, state and service contracts remain. Existing browser-smoke check
now asserts footer absence rather than dereferencing a removed node. Historical
provenance retained with adapted digests. Risk/acceptance: no empty reserved row
or page overflow. TypeScript and 34-file structural verification passed. Live
390 x 600 and 1366 x 768 both had matching client/scroll dimensions, no footer or
selector, and no browser error/warning entries; viewport restored. No full build
repeated for this small removal, no backend operation or production activation.


### Canonical favorite shortcuts — 2026-10-12

Owner: OS Surface/preferences, explicit UI integration continuation rather than
individual App polishing. The existing preference-runtime/1 and preference-store/1
are retained. New scalar ID surface.favorite-shortcuts belongs to the preference
catalog; bounded IDs/names are defined once in home-shortcuts.mjs. They describe
presentation targets, not installed app identities, registry receipts or grants.
Validation rejects unknown/duplicate/nonstring/oversized choices, preserves an
intentional empty selection and normalizes order. No new storage key or domain.

Home and Apps share FavoriteShortcutsPanel, consuming the same observed snapshot.
The former local addedApps/hidden selection is removed. Editing uses native labeled
checkboxes in the shared Dialog, saves on change, reports persistence outcome and
returns focus to the actual opener. A latest-snapshot mutation prevents sequential
edits from losing earlier changes. Empty selection offers Add; all future targets
already present remain eligible as shortcuts with host availability explicit.
The existing account-sync allowlist is unchanged and excludes this local preference.
Native recognizes the catalog entry; no separate Native launcher/editor is added.

Risk/acceptance: consistent cross-panel edits, persistence and empty-list recovery,
no false install/sync success, safe failed-storage fallback, accessible narrow editor
and keyboard/focus retention. Four new behavior tests exercise storage roundtrip,
empty selection, two subscribers under save failure, validation/order/recovery.
35 Node tests (preferences, first-run and sync included) and seven builder checks
passed; eight sync tests repeated with an explicit local-shortcut assertion, not
additional unique coverage. Final TypeScript/build and 34-file provenance checks
passed. Initial JS 484.97 kB (151.88 gzip), CSS 81.59 kB; no chunk threshold override.

Browser: removing Terminal in Home also removed it from Apps; reload retained it.
Empty selection survived reload and retained an Add action. Escape/Conclude returned
to Edit/Add respectively. At 390 x 600 the 530.5px dialog fit, with 48px rows and
internal list scroll. At 390 x 844 all seven choices fit (398px client/scroll height);
Space toggled the focused checkbox. Original choices, dark theme, Central and default
viewport restored; temporary Apps window closed. Screenshot:
ordax-shared-favorites-mobile-20261012.jpg, local artifact outside repository.

During source hot replacement the console exposed duplicate React roots/context
errors. Web composition now owns its root explicitly and unmounts it before disposing
consumed ports, without caching a second root or concealing errors. After clean reload,
a real composition update kept one workspace root, saved choices and no new errors.
Historical error logs remain recorded; they were not cleared to claim a clean run.
This concerns developer HMR; normal window/view transitions still retain app bodies.
No inference, external command, installation or production activation was validated.

## USB color profile in Web — 2026-10-12

Owner: OrdaX OS Surface; scoped visual increment explicitly requested by the
user under PLANO-FUNCIONAL-SURFACE-E-APPS.md. Web Settings exposes Claro, Escuro
and OrdaX USB in one labeled native select with 44px touch height. The USB profile
uses the existing Midnight Native semantic palette; aliases in the Web stylesheet
reference tokens.css directly, without another palette or copied hex colors.
The Web layout, illustrations, window lifecycle and compact behavior are retained.

Dependencies: the existing preference catalog/runtime/store and Native tokens.
The portable appearance.theme contract remains light/dark, default light.
surface.web-palette is an independent Web presentation preference with standard/native
values, not an execution mode or a copy of the appearance state. USB rendering
resolves to dark while retaining the user's portable light/dark choice; selecting
Claro or Escuro returns to the standard Web palette. Native's renderer ignores
this Web choice. No new storage key, sync allowlist, grants or hardware adapter.

Risks: CSS specificity, contrast and corrupt/blocked browser persistence.
Acceptance: three selectable profiles, persistence on reload, equivalent computed
Web/Native semantic colors, intact standard themes, high contrast and narrow-screen
controls. Verified with 44 Node and 24 Python tests, TypeScript/build/reference
verification and browser at 390x844; six computed color pairs match Native. The
new profile remains local to the browser; no cloud continuity or physical USB boot
is claimed by these presentation checks.

## Shared color profiles and Native desktop — 2026-10-12

Owner: OrdaX OS Surface, under PLANO-FUNCIONAL-SURFACE-E-APPS.md; explicitly
requested USB integration. Shared profiles replace the Web-only color selector
foundation above. color-palette.mjs owns surface.color-palette, derived scheme
and three choices. The old module and ID have no runtime wrapper, redirect or
second authority. Existing appearance.theme values/default are unchanged.

The standard palette was moved out of the Web renderer into color-palettes.css;
USB tokens stay in tokens.css. Both Web/Native compositions include these sources.
Native's semantic aliases use standard colors for Claro/Escuro, and the original
Midnight palette for OrdaX USB. Theme previews use the same tokens. Web layout,
wallpapers and window behavior are preserved; no native service is replaced with
a Web implementation.

Native now has a dock toggle and desktop shortcuts alongside its existing Home.
The existing Surface reducer owns the session presentation and window state.
Switching views neither serializes a new workspace schema nor remounts apps;
Home still minimizes through the original action. All app shortcuts use the same
catalog, capability checks and activation path. Labels use the existing pt-BR/
en-US catalog. Ports for files, accounts, network, energy and installed components
are unchanged. No new dependency, grant, API endpoint or hardware authority.

Acceptance: equivalent standard colors across renderers; three selectable profiles;
existing native preference endpoint/atomic store; session-only view switching with
window state intact; responsive desktop controls; unchanged Web layout/build.
Verified: 56 Node and 44 Python tests, including the eight Native persistence tests
on Ubuntu/WSL; TypeScript/build/34 reference assets; browser theme/reload/window
behavior and 390x844 viewport. The local Native preview consumes canonical UI with
browser preference persistence and unavailable host capabilities. Source readiness
and this visual preview do not constitute a signed USB release or physical boot.

## Shared settings style and sidebar policy — 2026-10-12

Owner: OrdaX OS Surface, linked to the functional Surface plan; explicit user
request to reuse USB Settings styling in Web and add a Native profile shortcut.
Web imports settings.css and the canonical Settings message catalog. Its existing
appearance and accessibility ports remain authoritative; no duplicate store,
palette, grants, account runtime or device execution. Host-only Native sections
are not advertised as implemented Web features. Settings loads on demand and uses
the existing window resource boundary. The sidebar entry replaces its footer
shortcut and opens the existing Configurações window.

workspace/presentation.mjs owns the default sidebar policy used by both renderers.
Desktop keeps an icon rail collapsed; expansion requests cannot override that
policy and the expansion control is absent in that presentation. Returning to Central uses automatic responsive sizing and allows manual expansion. No
presentation/sidebar state is added to workspace-store/2. Native's profile
shortcut lives in the sidebar footer, targets account/overview through catalog
availability and normal launch, and replaces header/rail duplicates. Icon names
use localized native browser tooltips without a parallel label registry.
It does not access the operational profile registry or bypass identity capability.

Risks: layout specificity, real app-width breakpoints, and focus during view
changes. Acceptance: intact windows, no horizontal overflow at 390x844, compact
settings adaptation, persistent existing preferences, fixed 64px desktop rail and usable
Central expansion/profile shortcut. Verified with 49 Node and 36 Python tests,
TypeScript/build/reference verification and local Web/Native browser flows.
Authenticated account, device execution, physical boot and signed release remain
outside the local visual preview's evidence.

## Shared sidebar geometry and immediate hints — 2026-10-12

Owner: OS Surface, explicit user request for one Web/USB sidebar structure.
sidebar-layout.mjs/css defines brand, home, navigation, account and auxiliary
slots once. Tokens own 192/64px rail widths, 36px brand and 40px navigation.
Native removes the top header and uses the sidebar brand as its existing launcher.
Native and React retain their canonical window managers and capability-bound apps.

sidebar-account.mjs shares escaped account markup and a validated Identity
projection. Native subscribes to its existing session/host/localization ports;
React consumes its existing context. Logout or lost capability removes stale
public identity. Storage has an explicit unavailable state, with no invented plan
or usage. Notifications move the original Native control into the common slot;
Space switcher and power remain bound to their existing Native owners.

Sidebar reaches the footer; app/nav tracks remain adjacent and never overlap.
Navigation is opaque, borderless and uses app surface colors. Presentation toggle
is on the right. Collapsed brand is centered; immediate hints are shared through
sidebar-hints.mjs/css, with keyboard/Escape and complete cleanup. Navigation
capacity measures button pitch and row gaps, preserving a launcher for overflow.
Desktop stays collapsed; Central can expand. No new domain, grants or persistence.

Risks: CSS inheritance, capability/session changes, focus, viewport and teardown.
Acceptance: no duplicated header/profile owner, consistent slots/card/geometry,
no horizontal page overflow, safe text, recovered shortcuts after resize, existing
launcher and account destinations, preserved app/window state. 69 Node + 40 Python
tests passed, with TypeScript/build/reference verification and local Web/Native
browser flows. Pointer behavior is unit-tested; connected browser does not expose
pointer movement. Local Native preview does not prove hardware execution, physical
USB boot or signed release.


## Contextual presentation toggle — 2026-10-12

Owner: OS Surface, following the explicit shared Web/USB navigation request.
The intermediate Web width no longer overrides the canonical sidebar token.
The existing right-hand toggle retains its anchor and control geometry; monitor
means Desktop destination and grid means Central destination. Both presenters
consume the existing presentation policy, without another mode flag or store.
Native localization updates the same button; its SVG changes only when the
destination changes. The current desktop rail, profile, notifications and native
auxiliary owners remain intact. Risk is limited to presentation feedback and
responsive geometry; no authority, application lifecycle or device change.
Acceptance: correct destination in either mode, stable control position and
canonical expanded/collapsed widths. Automated regression checks cover invalid
views, immutable destination metadata, localization and redundant SVG updates.


## Surface gate reconciliation — 2026-10-12

Owner: OrdaX OS Surface. User-requested continuation of the shared Web/Native
sidebar, following the five failed Foundation/Surface test cases on main
9a84bbd1a6ae93141126acb19ed802df7214b96a. Scope is the verification layer;
no product layout, preference storage, identity, grants or device authority changes.

The existing [PR #1713](https://github.com/ordaxsystems/ordax-os/pull/1713)
browser proof is reused, without reverting the newer generated public-site fixture
or copying obsolete rail assertions. Real Native shell markup is rendered in both
complete locales to verify each pinned launch destination, its accessible name,
the sidebar launcher and exactly one profile targeting Account overview.
Source checks continue to enforce adapter/import boundaries and the current
color-palette owner, whose appearance dependency remains canonical. Motion
reduction is checked in shared tokens and the Native entrypoint loads that owner.

The Chromium proof physically navigates through shared Settings, verifies
light/dark/USB palette selection and persistence, waits for the closing dialog
layer to unmount, and verifies compact action hit targets. Desktop retains equal
tiles; mobile retains one selected pane with access to other mounted apps.
No reduced coverage, skipped controls, artificial timeouts or preference mutation
is used to make theme switching pass. The isolated profile reset between cases
remains test setup, as in the existing proof.

Local acceptance: 39 Node tests and 44 Python Surface/identity tests passed;
34 reference assets/files and the Native shared-shell browser proof passed.
Web Chromium passed 1440x900, 1024x768, 820x650, 760x650, 390x844,
320x568 and 844x390, including compact lifecycle, draft retention, reserved
workspace geometry and no horizontal document overflow. Existing hosts respond
HTTP 200. These are source and browser proofs, not physical USB boot, cloud
permissions, production service activation or release evidence.

Risk: stale UI-template assertions could hide genuine missing controls, so
launcher checks have moved to rendered output rather than matching template
implementation. The broader Foundation run and remote CI are tracked separately;
prior passing checks from other branch heads do not certify the current main.

Concurrent main reconciliation: d4061166b86c6601dbf75f47ba2c5981d0586804
integrated App SDK changes and the existing browser proof during this increment.
Both [Foundation](https://github.com/ordaxsystems/ordax-os/actions/runs/38339460878)
and [Surface Web](https://github.com/ordaxsystems/ordax-os/actions/runs/38339460894)
passed on that base. No second browser proof or product implementation is added;
this increment contributes actual rendered-launcher tests and owner/load checks.
The existing Ctrl/Meta+K handler assertions from the incoming commit are retained.
The broad local Windows discovery run was stopped after platform-specific receipt
test errors; it is not claimed as passing and does not replace canonical Linux CI.

The subsequent 0562491 base also includes Assistant remove-first Gate A from
PR #1717 and signed activation retry hardening from PR #1718. Both are preserved.
The rendered launcher tests follow the current five pinned destinations and
require no Assistant launch control during the migration gap. No removed source,
installation claim or parallel Assistant is restored by this increment.

## Shared notification center — 2026-10-13

User-requested Surface UX increment, tracked by the existing functional Surface plan.
Owner: `system/surface/ui/notification-center-controls.mjs`; presentation CSS is
`notification-center.css`, loaded by both compositions. React only mounts/disposes
the same renderer. No parallel notification service, account store or event authority.

Contracts/dependencies: `ordax.notifications/3`, `ordax.notification-store/3`,
`ordax.app-activation/1`, canonical preference/localization ports and regional
formatting. Native keeps `createNotificationsRuntime`, device store and the
existing update-watcher bridge. Account login alone is not a notification feed.
The current operational-realtime contract still marks Web/mobile delivery as future
adapter work. Web passes explicit null ports, displays unavailability, hides zero counters
and inactive controls, disables mutations and creates no fabricated entries, Native store copy, polling or endpoint.
The local USB visual preview likewise has no updater/Native grants; it shows the
same unavailable presentation, not production device events.

UX: all/unread filters with counts; explicit per-item and bulk read; clear only read;
dismissal; Do Not Disturb preserves history and suppresses the attention badge.
Opening the center does not consume unread history. Destination activation delegates
to the existing port; a rejected activation keeps the notification unread and reports
an error. Keyed rows keep focus during live updates and restore it after removal.
Native panel anchors next to the sidebar bell, adapts to viewport and scrolls the list;
Web uses the same window lifecycle, responsive content and compact presentation.
Subscriptions, observers and localization are disposed by their mounting owners.

Risk/acceptance: localized plain-text rendering, no HTML interpretation or implicit
execution; no backend availability claims without an adapter; shared theme tokens;
keyboard and narrow viewport access; no read-state mutation merely from opening.
Automated evidence uses the real notification runtime with an isolated fixture
producer (never product demo data), tests existing persistence/update bridge,
and checks Web's unavailable state and compact window in the browser. This does
not prove remote push, two-device sync, physical USB boot or release activation.

Local verification: 31 Node behavior/localization tests and 57 Python Surface,
notification and builder checks passed; module boundaries and reference integrity
passed. Isolated Native browser proof passed 1280×800, 390×844, 320×568 and
844×390, including unread preservation, action failure, focus recovery,
destination delegation, teardown and notification panel bounds/overflow.


## Meridian visual study — 2026-10-13

**Current visual reference for this experimental proposal:**
[Meridian Visual System — Visual Freeze](design/MERIDIAN-VISUAL-SYSTEM.md).
The proposal's direction is frozen; these dated study/audit entries record its
history, not parallel active design specifications. Production identity/themes,
contracts, architecture and release authority remain as defined above. Visual
Freeze does not authorise integration, a default-theme change or merge.


**Status: isolated visual proposal, not a product cutover or release.** Explicit
user-requested exception to the current implementation sequence: this increment
explores a complete future USB Central/Desktop experience, exclusively frontend,
on `codex/meridian-design-lab`, based on `9fec127`. No main modification, merge,
production activation or change to existing theme contracts is authorised by
this experiment. Validation/builds are assigned to another chat by the user.

Owner: Surface presentation, `system/surface/experiments/meridian/`. Preview
composition and run recipe: `tools/meridian-preview/`. No Apps/Runtime/Platform
ownership is transferred. Identity, Memory, Intelligence routing, permissions,
notification services, Store authority, pairing and device execution stay with
their existing owners. The production notification center remains unchanged.

The proposal, Meridian, uses Argila and Grafite materials scoped beneath its
opted-in root. It introduces an editorial Central organised around the active
Space: Day, Work and Ecosystem perspectives, an embedded intention composer,
continuity, agenda, professional profiles and a catalogue of more than apps.
Details and action reviews appear in contextual side panels, becoming sheets on
narrow screens. The Desktop shares identity, Space, launcher, search and settings;
window examples demonstrate maximise/minimise/floating/compact states with a
reserved compact region and one visible compact app on narrow screens.

Future concepts represented: a phone as a selected peripheral, reviewable context
sources, session preparation, Space-specific module discovery and professional
communities. Each is a presentation study with a reason (continuity, explicit
scope or discoverability), not evidence of operational support.

SSOT and dependencies: canonical Inter/brand resources and the existing
`workspace/presentation.mjs` switch policy are reused. Existing Claro/Escuro/USB
palettes, preference values, persistence and live adapters are not modified.
Experiment tokens, navigation catalogue, read-only context selectors and injected
presentation source each have a single owner. Fictional records live in `demo/`;
only the preview entry point imports that source. Its session dispatch cannot
invoke backend ports, persist data, grant access, install anything or send a
message. Native/browser production compositions do not mount these fixtures.
The local host serves only an explicit visual-resource allowlist on loopback.

Implemented exploration: Space selection/creation, project examples, profile
selection, simulated Store additions per Space, search/filter, notes drafts,
message drafts, notifications read state, quick settings and guest/login/signup
review screens. No credentials are collected. Connected, guest, offline, empty,
loading and error scenarios are selectable manually and clearly presented as
examples. Original vector art and glyphs were authored locally; no third-party
application code or new runtime package is incorporated.

Risks and acceptance: mocks must never be auto-selected by a production host;
visual window state must later be mapped to the canonical window lifecycle, not
promoted as a second runtime; future integrations need public owner contracts.
The reviewer should inspect material contrast, keyboard/focus, narrow viewport,
compact resizing, same-Space context, all scenario states and theme preservation.
Production localisation, real identity/services and release validation remain
separate work after visual approval. Portuguese editorial copy is scoped to this
study; it is not a new canonical localisation authority.

Evidence this increment: local module syntax parsing and presentation captures
only. No unit suites, E2E, build, Foundation/Surface CI, USB image or physical boot
validation was run, per the user's explicit instruction. No production readiness
claim follows from the mock preview.


## Meridian technical audit — 2026-10-13

Owner and scope remain the isolated Surface presentation study above. The follow-up
requested by the user audited baseline 69a8937 on codex/meridian-design-lab.
Safe corrections preserve unsent preview forms by Space/form/conversation, restore
keyboard focus after dialogs, name controls at responsive breakpoints, and keep
the study marker visible at 320 px. No production palette, domain contract or
backend adapter changes. The preview still discards session data on refresh.

Evidence: [technical report](evidence/meridian-audit-2026-10-13/relatorio.md),
[196-item UI/UX backlog](evidence/meridian-audit-2026-10-13/inventario.md) and
[complete flows](evidence/meridian-audit-2026-10-13/fluxos.md).
The focused Chromium proof reuses tools/browser-proof/chromium.mjs and is wired
into the existing Surface candidate workflow. It passed 155 assertions. Canonical
Web builds/typecheck, repeatability, Native and first-run proofs passed locally.
Foundation failed on this Windows environment, and the canonical Web browser smoke
timed out; the report retains those failures. This is not a full green CI verdict.

The MVP scope stays with MVP.md. The inventory describes missing presentation and
integration work; it neither reduces the integrated MVP nor grants release/device
authority. Domain-like fixtures and the window examples must be projected from the
canonical owners before any product integration; their demo dispatch is not a port.


## Meridian Round 2 — 2026-10-13

Owner: isolated Surface presentation. Continues from audit-corrected `25e0f57`
on `codex/meridian-design-lab`; the original study and audit evidence above
remain historical. This increment expands operating journeys instead of
promoting fixtures into canonical services. It does not change the active
product identity, production themes, main, ownership or release gates.

Central now exposes USB/session/network/storage and deferred-update context.
Shared presentation storyboards cover optional-account first use, lock/power,
update/recovery, Intelligence proposal review, catalogue lifecycle, Space impact,
settings, file references, device pairing examples and communication states.
Store/Profile detail routes use one visual lifecycle, and the old mock dispatch
install/profile/Space-creation operations are removed. Drafts and window examples
are retained per identity/Space within the current page session.

Fixtures are injected only by the preview composition. The renderer performs no
network, credential collection, filesystem mutation, install or device action.
The Portable v2 illustration uses ESP + DATA per the machine-readable contract,
not the transitional three-partition wording from historical text. It is neither
physical-media evidence nor a claim about installed capacity.

Evidence and handoff: [Round 2 coverage, owners, risks and captures](evidence/meridian-round2/coverage.md).
The focused preview check passed 23 assertions and module syntax parsing passed;
no full audit, canonical build/CI, Foundation or physical proof ran in this round.
The earlier browser regression assertions are preserved and their Space routes
adapted, but their full matrix requires independent rerun. The controller still
reconstructs DOM; real lifecycle integration, complete accessibility review and
canonical-contract projection remain required. Meridian is not ready for merge.

## Meridian Round 2 independent audit — 2026-10-13

The independent audit of 4dffe52 is classified **C: approved for Round 3 visual**,
not integration readiness. Objective fixes cover context, approval, drafts,
lifecycle, focus, contrast and the preview host's connection queue. The final
expanded matrix passed 392 checks, covering 180 screens, 29 confirmation barriers
and 64 geometry samples. The original Meridian smoke passed 155 checks and Round 2
passed 23 again after the host correction. Earlier failed executions are preserved,
including the diagnostic that captured refused module requests. Canonical Foundation
and Web-browser failures from the earlier audit remain unresolved.

See the [independent report](evidence/meridian-round2-audit-2026-10-13/relatorio.md),
[196-item comparison](evidence/meridian-round2-audit-2026-10-13/inventario.md) and
[14 revised flows](evidence/meridian-round2-audit-2026-10-13/fluxos.md). Previous
evidence is preserved. Main, production palettes, contracts, adapters and release
gates are unchanged; zero items are classified ready for adapter integration.

## Meridian Round 3 — 2026-10-13

Continues from audit-preserving `43cf7ba` on `codex/meridian-design-lab`.
Desktop removes only its topbar and reserved grid row, retaining wallpaper,
sidebar, objects and windows. Central keeps its topbar. One taskbar renderer
exposes pinned/open/active/minimized apps, search and progressive system details.
Intelligence is on demand. Central and System share continuity notices derived
from the existing audited identity/Space namespace, not another state store.

The [Round 3 report](evidence/meridian-round3/coverage.md) records 27 focused UI
checks, 16 captures, seven combined conditions and remaining limitations.
No backend, production palette, adapter, release gate, physical USB or main change.
Round 2 classification remains C pending independent audit. Not ready for merge.

## Meridian Round 3 independent audit — 2026-10-13

The [final independent audit](evidence/meridian-round3-audit-2026-10-13/relatorio.md)
covers actual HEAD db7b4a1, including navigation, maximization and Home follow-ups
after the initial Round 3 delivery. Objective corrections in 2b609ed preserve
Desktop navigation, destination focus, restore naming and visible foreground
context. Classification **C: approved for further visual refinement**, not merge
or integration.

Final independent proof: 287 checks; existing journey matrix: 392 checks/180
screens/29 confirmation barriers/64 geometries. Existing smokes passed 155, 23,
27 and 21 checks. Historical failures and harness diagnostics remain separate;
canonical Foundation/Web-browser gates remain unresolved. Main, palettes,
contracts and adapters remain unchanged. See also the [sidebar inventory](evidence/meridian-round3-audit-2026-10-13/sidebar.md).

## Meridian Round 4 independent audit — 2026-10-13

The [44-item final audit](evidence/meridian-round4-audit-2026-10-13/relatorio.md) reviews actual HEAD ebd58cd and preserves the 771cb98 → 11bee9e → 8d48d01 → ebd58cd chain and prior audits. Five objective fixes cover competing tooltip titles, Escape, detached dock observation in lock/stage, active app visibility after viewport resize, and native touch inertia overriding keyboard scroll. No domain, adapter, contract, canonical palette or main change.

Classification **C: approved for freezing the visual direction and measured final refinement**. Freeze Meridian materials, shell composition and orientation; stop further shell redesign rounds. The isolated architecture preserves existing owners/foreground SSOT, but preview repaint/fixtures remain prototype limits. Integration maturity remains insufficient: canonical Foundation/Web gates and physical/platform acceptance are unresolved. See the report for stage-specific gates, failures, hashes and captures; no release or merge approval.
