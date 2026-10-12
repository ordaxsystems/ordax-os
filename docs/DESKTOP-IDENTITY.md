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

`system/surface/ui/tokens.css` is the single source of visual policy for semantic color, typography, spacing, radii, shadows, focus and motion. Surface and first-party application styles consume those semantic tokens instead of defining a separate palette per application.

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
