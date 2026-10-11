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
windows receive half the height after the shared header/footer and mobile safe
area are deducted. Collapsing the carousel leaves only its accessible control
row; minimizing or closing the last compact window releases the whole primary
pane. The existing immersive mode remains a full-viewport option.

Geometry is owned by two CSS Grid tracks in `workspace/styles.css`. The layout
state is derived from the existing window reducer and carousel flag; there is
no second window manager or persisted geometry copy. Every AppWindow keeps its
key and parent across compact, restored and minimized modes, preserving mounted
React state. Pages and app content scroll independently. Normal/maximized
windows stay within the primary track, and drag/resize measure that same pane.

Dependencies: existing workspace reducer, ResizeObserver, shared appearance
tokens and browser viewport/safe-area support. Risk: short viewports, narrow
carousel capacity, absolute grid positioning and dialog transitions. Acceptance:
strict compilation and reversible reference integrity; real Chromium proof at
320, 390, 700, 844, 1024 and 1440 px, including short-height resizing, collapse,
last-window minimization/closure, drag bounds and mounted text/filter retention.
No App, Runtime, Intelligence, Identity or device-execution authority changes.
