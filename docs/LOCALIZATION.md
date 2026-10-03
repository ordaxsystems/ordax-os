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
(`ordax.localization/2`) driven directly by the persisted `regional.locale`
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

## Locale profile, text direction and pseudo-locales

`ordax.localization/2` adds an explicit `ordax.locale-profile/1` to the
localization port. The profile normalizes the active locale and carries document
direction as `ltr` or `rtl`. The shared Surface applies both `lang` and `dir`
from that profile during the same render lifecycle; direction is not inferred by
individual screens or CSS fragments.

Direction resolution is deterministic. An explicit BCP 47 script subtag wins over
language defaults, so a locale such as `az-Arab` is RTL while `az-Latn` is LTR.
Locale remains presentation metadata only and cannot alter action identity,
permissions or authority.

Two pseudo-locales exist only for engineering verification:

- `en-XA` — expanded LTR copy for truncation, wrapping and layout stress;
- `ar-XB` — RTL profile for bidirectional layout and document-direction stress.

They are not public product languages, cannot be persisted as user preferences and
must never appear in release/public locale selectors. The deterministic pseudo
transform preserves interpolation placeholders exactly. The machine-readable policy
is `docs/contracts/localization.json`.

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
