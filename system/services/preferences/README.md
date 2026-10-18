# Shared Preferences

`system/services/preferences/` owns user-facing preference semantics that are shared across OrdaX execution modes.

Preferences are distinct from runtime configuration, secrets and privileged host policy:

- runtime configuration controls product/release behavior and authority;
- preferences express user choices such as appearance;
- secrets remain behind secure platform storage;
- adapters may persist or synchronize a preference, but they do not redefine its meaning.

The first concrete preference is `appearance.theme` with `dark` and `light` values. The shared service validates values and exposes an immutable snapshot; the Surface renders and applies it.

Persistence is supplied through the platform-neutral `ordax.preference-store/1` contract. Web currently implements that port with browser-local storage and an in-memory fallback when storage is unavailable. Shared preference/service/app code does not access browser storage directly.

Local persistence does **not** imply account sync, cloud backup or secret storage. Cross-device continuity remains a separate service/capability milestone.

Unknown preference IDs are ignored by mutation helpers, while invalid values for known preferences fail closed. New preference semantics require an explicit owner and stable ID.

The Web composition now uses runtime.mjs as a portable observable binding for
the same catalog through ordax.preference-runtime/1. It recovers validated
defaults, persists changed values only via ordax.preference-store/1, and reports
saved/session-only status without inventing cloud continuity. Native's Surface
reducer remains a consumer of the same catalog. Runtime bindings do not define
new preference semantics or import browser storage.

### Persistence confirmation

The existing `ordax.preference-store/1` port keeps a synchronous `load()`
and accepts either a boolean or a Promise of boolean from `save(snapshot)`.
Web localStorage reports a synchronous result. Native retains the validated
session snapshot immediately but returns a Promise that settles **true only
after the same-origin host acknowledges its atomic POST**; a failed HTTP
response or transport error settles false and does not block later writes.
The portable preference runtime exposes `not-written`, `pending`,
`saved` or `session-only`. Multiple pending writes never let an earlier
acknowledgment confirm the latest edit, and teardown ignores late results.
Neither a queued write nor an in-memory choice proves device durability,
cloud sync or account backup. The native Surface reducer continues to use
the canonical store without creating a separate persistence owner.


## Surface favorite shortcuts

`home-shortcuts.mjs` owns the bounded presentation targets and
`surface.favorite-shortcuts` preference. Its scalar value is a canonical ordered
comma-separated selection of known shortcut IDs; empty is an intentional empty
selection. Unknown IDs, duplicates, nonstrings and oversized records are rejected;
corrupt persisted values recover through the existing catalog without overwriting
other preferences. Names have one metadata source; icons remain a UI mapping.
These are Surface shortcut IDs, never installed-app identities or grants.

The Web Home and Apps window use one renderer/editor, the existing preference
runtime and Web store. No second storage key or local copy is maintained by UI.
Changes are browser-local with explicit session-only fallback. The existing account
sync allowlist excludes this preference; no cloud sync is implied. Native's catalog
recognizes the value, but this increment does not add a Native launcher editor.

## Shared color profiles

color-palette.mjs owns surface.color-palette (standard/native), shared options
Claro/Escuro/OrdaX USB and their projection to a color scheme. This presentation
axis preserves the portable appearance.theme light/dark contract. USB resolves
to dark while preserving that brightness record; Claro/Escuro select standard
colors and requested brightness. Web and Native use the same semantics and
their existing preference-store/1 adapters, without another theme store.

The standard palette lives once in surface/ui/color-palettes.css; the original
USB palette lives once in surface/ui/tokens.css. The shared stylesheet maps
semantic variables in both renderers. Native Settings miniatures consume these
same colors. Operational state colors and high contrast remain canonical.
The sync allowlist excludes the palette choice; no account sync is implied.
The former Web-only palette module and preference ID were removed rather than
retained as alternate consumers. Unknown previous preference IDs are ignored by
the existing record recovery and disappear on the next canonical store write.
