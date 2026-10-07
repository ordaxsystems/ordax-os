# OrdaX localization

Status: **ACTIVE MVP POLICY**

OrdaX must separate three things that are often incorrectly called “language
support”:

1. locale accepted and persisted by the system;
2. first-use/OOBE translation;
3. complete Surface/application translation.

## MVP language set

The public Native/USB MVP selectors expose:

- `pt-BR` — Portuguese (Brazil), source/default language;
- `en-US` — English.

The system still recognizes and can read persisted `es-ES`, `de-DE` and `fr-FR`
state, and their existing OOBE translations remain in source as retained
compatibility/future rollout assets. They are intentionally hidden from the public
MVP selectors until their shared Surface/application coverage reaches the same
launch standard. This avoids advertising a language based only on OOBE translation.

## Expansion order

1. keep PT-BR and English complete across the shared Surface and first-party apps;
2. complete Spanish;
3. complete German;
4. complete French;
5. add further languages only when the shared i18n owner can keep them tested.

This order is about engineering sequence, not the importance of a language or
its speakers. PT-BR remains fully supported as the source language throughout.

## Current implementation status

The shared Surface owns a provider-neutral localization runtime
(`ordax.localization/2`) driven directly by the persisted `regional.locale`
preference. Locale metadata is represented by `ordax.locale-profile/1`, so locale,
language, script, region and writing direction come from one canonical profile
instead of being inferred independently by UI surfaces. PT-BR remains the source
catalog. The shared desktop shell, launcher, window chrome, workspace labels,
connectivity copy, first-party app titles and fallback panel metadata have explicit
English catalog entries.

`en-US` is now a complete Surface locale for the public MVP. Files covers
navigation, search, locale-aware sorting, listing, selection, deep create/copy/move/
rename/project/import/export flows, Recents, recoverable Trash, preview and Files → Notes
presentation through the same owner. Projects, Settings, System, Account, Notes and Internet cover
their primary and deep first-party journeys in English. The Native local-session lock,
Home continuation/pending cards, power controls, global update accelerator, desktop clock,
boot screen, network/battery trays and quick panels, and Notification Center also consume
the shared owner. First-party async feedback that must survive repaint stores semantic
message identity instead of already-rendered Portuguese text. First-party update
notifications likewise persist bounded semantic presentation identity so stored history
can rerender when the locale changes; generic producer text remains untouched by design.
Spanish, German and French remain recognized compatibility locales and retain their
translated OOBE catalogs, but are not offered by the public MVP selectors until their
shared Surface catalogs are complete enough for launch.

```text
SURFACE_LOCALIZATION_OWNER=PASS_SOURCE
SURFACE_SOURCE_LOCALE=pt-BR
SURFACE_SHARED_SHELL_EN_US=PASS_SOURCE
FILES_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
FILES_FORMS_SORT_EXPORT_PREVIEW_EN_US=PASS_SOURCE
SETTINGS_SYSTEM_NAV_EN_US=PASS_SOURCE
SYSTEM_OVERVIEW_SUMMARY_EN_US=PASS_SOURCE
SETTINGS_NOTIFICATIONS_EN_US=PASS_SOURCE
SETTINGS_SECURITY_EN_US=PASS_SOURCE
LOCAL_SESSION_LOCK_EN_US=PASS_SOURCE
ACCOUNT_EN_US=PASS_SOURCE
PROJECTS_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
NOTES_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
INTERNET_PRIMARY_JOURNEY_EN_US=PASS_SOURCE
NETWORK_TRAY_QUICK_PANEL_EN_US=PASS_SOURCE
BATTERY_TRAY_QUICK_PANEL_EN_US=PASS_SOURCE
NOTIFICATION_CENTER_EN_US=PASS_SOURCE
FIRST_PARTY_UPDATE_NOTIFICATION_HISTORY_EN_US=PASS_SOURCE
FILES_DEEP_EN_US=PASS_SOURCE
FILES_SEMANTIC_OPERATIONAL_MESSAGES=PASS_SOURCE
SETTINGS_DEEP_EN_US=PASS_SOURCE
NOTES_DEEP_EN_US=PASS_SOURCE
INTERNET_DEEP_EN_US=PASS_SOURCE
SHELL_DEEP_EN_US=PASS_SOURCE
MVP_PUBLIC_LOCALES=pt-BR,en-US
RETAINED_COMPATIBLE_LOCALES=es-ES,de-DE,fr-FR
SURFACE_COMPLETE_LOCALES=pt-BR,en-US
SURFACE_EN_US_APP_CONTROLS=PASS_SOURCE
SURFACE_ES_ES=HIDDEN_MIGRATING
SURFACE_DE_DE=HIDDEN_MIGRATING
SURFACE_FR_FR=HIDDEN_MIGRATING
```

## Architecture

Translations belong to shared product owners, never platform forks:

```text
shared message identity/catalog
 -> locale profile and locale selection
 -> Surface/apps/services
 -> Web/Mobile/Desktop/USB/Native adapters only where platform formatting differs
```

Do not copy screens per language. Dynamic state such as Wi-Fi status must be
translated as structured pieces rather than concatenated Portuguese strings.

Locale and keyboard layout stay separate. Choosing English does not silently
change a Brazilian physical keyboard, and choosing German/French does not
invent an unproven XKB layout. Physical keyboard support remains governed by
`docs/contracts/keyboard-layout.json`.

## Direction and RTL

Writing direction is part of the canonical locale profile. Surfaces consume the
profile and synchronize both document `lang` and `dir`; they do not maintain a
second hardcoded list of RTL languages. Explicit script subtags take precedence
over a language default, so a locale such as `az-Arab-AZ` is RTL while
`az-Latn-AZ` is LTR.

Layout CSS must use logical properties for directional spacing, borders and
alignment wherever direction matters (`inline-start`, `inline-end`, `text-align:
start`, and equivalent logical declarations). Direction changes presentation only:
they never change action ids, permissions, capabilities or update authority.

## Engineering pseudo-locales

`en-XA` and `ar-XB` are engineering-only pseudo-locales used to expose clipping,
expansion, bidi and direction defects before a real locale is launched. They are
not public selector options, are not persisted as user product preferences and are
not release-catalog locales.

Pseudo-localization is deterministic, expands visible copy, preserves interpolation
placeholder identity exactly and isolates RTL test output. The canonical machine-
readable rules live in `docs/contracts/localization.json`.

## Locale-aware formatting

`system/services/i18n/formatting.mjs` is the shared formatting owner for new and
migrated surfaces. It consumes `ordax.localization/2` directly and resolves the
active locale/profile at call time, so locale changes do not create a second cached
locale state. Each options bag is snapshotted for the call instead of becoming
shared mutable formatter state.

The foundation covers date/time, numbers, percentages, currencies, units, lists,
relative time, plural selection and localized display names through the platform
`Intl` primitives. Generic number formatting is decimal-only: percent, currency and
unit semantics must use their explicit helpers, and conflicting semantic options are
rejected rather than silently ignored. Currency, unit and relative-time meaning is
never inferred from the locale.

Identifiers such as currency/unit/display-name type must be strings; the formatter
does not stringify arbitrary objects. List item text is validated but preserved
verbatim rather than trimmed or rewritten. Date formatting accepts an explicit
`Date` object or finite epoch-millisecond number, avoiding coercions such as
`null -> epoch` or implementation-dependent free-form date parsing.

Formatting is presentation only and never changes message IDs, action IDs,
permissions, capabilities or authority.

Existing surfaces may still contain local `Intl` calls while they are migrated.
Migration should happen opportunistically when those surfaces are changed, rather
than creating a broad risky rewrite solely for formatting consolidation.

## Component-scoped app locales

The system locale is the default for first-party apps, but localization availability is component-scoped. A component may declare optional locales and may allow an explicit per-app locale override without advertising that locale as complete for the whole Surface.

Locale selection for an app is deterministic: compatible explicit app override, then compatible system locale, then that component's source locale. Only bundled locales and optional locales that are both declared and installed participate. If an optional override disappears, the app falls back to the system locale before source rather than rendering a partial mixture.

Translation content and release authority are separate contracts. `prototype-ordax.localization-pack/1` contains the component-owned message catalog; `prototype-ordax.localization-pack-release/1` is an authority-free signed release descriptor used by the authorized update path. A language-pack release cannot declare permissions, capabilities, an entrypoint or executable payload.

Detailed language-pack architecture and security rules: `docs/LOCALIZATION-PACKS.md`. Machine-readable policies: `docs/contracts/localization.json` and `docs/contracts/localization-packs.json`.
