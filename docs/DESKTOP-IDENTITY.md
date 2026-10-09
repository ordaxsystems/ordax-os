# OrdaX Desktop Identity

The OrdaX shared Surface identity uses two materials: **Basalto** (dark) and **Calcário** (light). The 2026-10-09 product refresh replaces the earlier graphite/glacial landing direction with warm neutral canvases, restrained green accents and an original open-frame mark. This is implemented in the shared source, not a second desktop shell.

This is a product identity contract, not a screenshot contract. Implementations preserve the visual language while remaining functional, responsive, accessible, offline-capable and shared across supported hosts.

## Canonical visual language

- warm charcoal Basalto and limestone Calcário canvases, with solid application surfaces;
- pale mineral text in dark mode and deep neutral ink in light mode;
- a restrained green accent for actions, navigation and focus;
- thin structural rules, moderate corner radii and quiet shadows;
- Inter as the canonical product type family, with compact, legible controls;
- an open orthogonal frame as the brand signature, shared by the header, loading screen and desktop artwork;
- fixed primary-app rail on desktop and a compact responsive equivalent on narrow surfaces;
- bottom area/status strip for workspace identity, running applications, update state and connectivity.

The composition favors content over decoration: no neon glow, orbital motifs or blurred shell panels. The desktop artwork is a local scalable vector rather than a baked screenshot. Application headings remain sized for working interfaces. Semantic colors and geometry are authoritative in the tokens, not duplicated in documentation or app palettes.

The original monochrome symbol is `system/surface/ui/brand/ordax-symbol.svg`; it is repository-authored, has no external references and is rendered through a CSS mask. The same asset works in both themes and is included by the offline source graph. No new third-party artwork, dependency or font is introduced.

## Shared design-system ownership

`system/surface/ui/tokens.css` is the single source of visual policy for semantic color, typography, spacing, radii, shadows, focus and motion. Surface and first-party application styles consume those semantic tokens instead of defining a separate palette per application.

`system/surface/ui/identity.css` is the shared component/composition layer for this identity. It may map existing components onto the semantic tokens while older component CSS is migrated, but it must not become a second token source.

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

Owner: OrdaX OS Surface. Dependencies: existing appearance/runtime/store contracts, local Inter and local SVG; no new public execution contract. Scope: shared Web/Native composition, loading screen, shell, Settings previews and tokens consumed by first-party views. Risks: contrast, CSS specificity, narrow layout and offline asset resolution.

Acceptance requires visual/contrast regressions, existing preference/localization tests, source-graph and deterministic bundle verification, and real Chromium shell/composition smoke. Web inspection covers desktop and narrow breakpoints and both materials. Source publication is a reviewable candidate, not production activation, a signed release or proof of USB/mobile hardware operation. A visual refresh does not require a kernel rebuild or USB rewrite.
