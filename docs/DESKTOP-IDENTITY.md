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


## Canonical Web presentation — 2026-10-10

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


### Viewport-bounded Home and explicit demonstration — 2026-10-11

Owner: OrdaX OS Surface. Explicit user-requested refinement of Home using the
attached desktop composition and demonstration data. One React composition uses
the existing Surface tokens, app catalog, workspace favorites, local licensed
assets and shared Intelligence session. Its pane is the sizing container, so
compact expansion/collapse and short landscape views trigger the same layout.
No scroll owner exists on Home. Large panes show Aura, four recent projects,
six favorites, system activity and Spaces/devices. Smaller panes show fewer
project previews and four summary entries; complete details remain in the shared
accessible Dialog with its own scroll body, fixed header/close and restored focus.
Very short split panes prioritize the composer and summary entries.

The immutable homeDemo projection in the existing Web model owns all fixtures.
The requested demonstration is enabled with a visible label and an off switch;
turning it off removes all mock project/activity/device data together. Each
project detail states that no repository or file is associated. Progress and
online devices are illustrative; no account, sync, cloud task or authorization
is created. Real capabilities still use the existing unavailable states/ports.
Home quick actions reuse app opening and session draft events. Voice/attachments
remain accurately disconnected. Opening Studio from a mock project does not
register a project. Startup has no pre-opened app windows; explicit user opening
retains the existing maximize/compact/restore/close lifecycle and mounted state.

Dependencies: existing Radix Dialog/Menu, local assets, container queries,
Surface tokens and workspace/Intelligence reducers. The window coordinate stage
uses overflow:clip so focus cannot scroll its geometry. Collapsed compact controls
reserve the existing desktop dock height; page padding reserves it only when
that pane actually reaches the dock. Mobile retains its outside navigation.
No z-index override or duplicated geometry owner. No new package or service.
Risks: clipping at short pane heights, detail navigation/focus, unavailable-mode
reflow, touch targets, and startup assumptions in lifecycle checks. Acceptance:
strict build and reference restoration for LF/CRLF; fixture isolation; real
Chromium at desktop/tablet/mobile/landscape widths; no Home/document overflow,
all preview controls inside bounds, all four projects reachable in a single dialog, dialog focus
and dismissal, shared draft retained across split modes, busy/result geometry, eight direct views,
launcher/sidebar/mobile interaction and app lifecycle. Source/candidate evidence
is distinct from production activation or a verified connected service.
[Recorded local acceptance](evidence/web-home-viewport-2026-10-11.json): 64 direct
view/viewport combinations passed; the supplied desktop composition was also
checked at 1672×941.

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
Sidebar destinations adapt to available height without scrolling; omitted items
remain in Mais. The collapsed sidebar keeps icon actions accessible. No identity, service, app state or authority is copied.

Risks: short-height navigation, dropdown focus, mobile menu dismissal, expanded
workspace bounds and compact pane geometry. Acceptance: eight responsive viewports,
64 direct routes, foreground/full workspace opening, compact restoration, mobile
launcher/Menu/identity/notification reachability, safe-area offsets, no horizontal
overflow and original app draft/node retention. Home uses its available pane for progressive disclosure; composer and summary
controls remain reachable through the shared tablet/mobile shell.

### Full-height sidebar and floating dock — 2026-10-11

Owner: OS Surface; explicit user-requested layout revision. Desktop sidebar reaches
the viewport bottom, including account/notifications. The footer contains only the
centered app dock: no full-width background, blur or separator line. Only the dock
receives pointer input. Space selection/window arrangement remain accessible through Mais;
connection state is reported there without claiming a connected service. Workspace extends to the bottom behind the dock; content padding preserves
app control reachability without a reserved footer strip. No second window
manager or app state is introduced. Mobile retains the five-destination navigation.
Acceptance: sidebar bottom aligns with viewport, dock centers in usable width,
transparent/pointer-transparent footer, sidebar collapsed controls, notification
opening and mobile menus at desktop/short/tablet widths.

### Adaptive sidebar and icon-only account — 2026-10-11

Owner: OS Surface; explicit user-requested refinement. One navigation component
projects existing route destinations plus Studio/Notes/Ajustes shortcuts. It never
adds a second route catalog or duplicates Arquivos in a favorites section. The
desktop container measures available height and uses the CSS row-height token
to allocate visible destinations, keeping Ajustes when space permits and reserving
Mais. Omitted destinations remain launchable through the shared dropdown. Space
selection/window arrangement also live there. Resize restores visible items; the
sidebar itself has no scrolling owner. Mobile keeps a scrollable Menu sheet.

The fixed base contains only accessible notifications/profile icon buttons.
Identity menu retains Minha Conta/site navigation; environment preferences use
the existing Ajustes app. Mais opens after a completed touch tap so a native pan
starting on its trigger does not intercept Menu scrolling. Keyboard/mouse behavior
stays with the shared Radix component, using its public controlled/event props.
No clock, simulated identity or duplicated app state.
Risk: short-height/collapsed layout, focus during resize, dropdown selection and
mobile Menu nesting. Acceptance: exact union of visible/omitted destinations with
no duplicates; controls inside bounds/no sidebar scroll; two icon-only base buttons;
route/app opening from Mais; responsive resize/restoration; mobile Ajustes and
identity/notifications/launcher reachable, native pan/tap distinction, with preserved
app drafts and lifecycle.
