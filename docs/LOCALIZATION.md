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

The shared Surface now owns a provider-neutral localization runtime
(`ordax.localization/1`) driven directly by the persisted `regional.locale`
preference. PT-BR remains the source catalog. The shared desktop shell, launcher,
window chrome, workspace labels, connectivity copy, first-party app titles and
fallback panel metadata have explicit English catalog entries.

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

## Localization QA locales

OrdaX uses two engineering-only pseudo-locales to test localization quality
without advertising unfinished languages:

- `en-XA` expands and accents source copy to expose fixed-width layout,
  truncation and wrapping assumptions;
- `ar-XB` uses the same deterministic pseudo-localization path with RTL
  direction to exercise bidirectional document presentation.

These identifiers are **not** public selector options, launch-complete Surface
locales or distributable language packs. They exist only in automated QA.

Pseudo-localization preserves interpolation placeholders exactly. Surface
document direction is derived from canonical BCP 47 locale metadata through the
shared locale-profile owner; the UI does not contain locale-specific
`if (locale === ...)` direction branches. The Surface restores the host
document's original `lang` and `dir` attributes when unmounted.

The localization gates must fail if a pseudo-localized Surface message loses or
changes a placeholder, if the expansion pass stops increasing message length,
if the RTL pseudo-locale is not resolved as `dir="rtl"`, or if either QA
pseudo-locale becomes publicly selectable by accident.

## Architecture

Translations belong to shared product owners, never platform forks:

```text
shared message identity/catalog
 -> locale selection
 -> Surface/apps/services
 -> Web/Mobile/Desktop/USB/Native adapters only where platform formatting differs
```

Do not copy screens per language. Dynamic state such as Wi-Fi status must be
translated as structured pieces rather than concatenated Portuguese strings.

Locale and keyboard layout stay separate. Choosing English does not silently
change a Brazilian physical keyboard, and choosing German/French does not
invent an unproven XKB layout. Physical keyboard support remains governed by
`docs/contracts/keyboard-layout.json`.
