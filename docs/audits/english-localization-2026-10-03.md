# English localization audit — 2026-10-03

Status: **SOURCE FIX IN REVIEW**

Scope: Native/USB MVP Surface and first-party product journeys for the public locale `en-US`.

This audit intentionally does not equate OOBE translation with product-wide language support. The public Native/USB MVP contract remains `pt-BR` + `en-US`; `es-ES`, `de-DE` and `fr-FR` remain retained OOBE compatibility locales until their shared Surface/application coverage is complete.

## Method

The audit reviewed the current shared localization owner, deep first-party localization gates, raw Portuguese copy outside catalogs, runtime-generated/persisted messages, newly integrated Studio surfaces, First Run registration copy, update notification presentation, Local Memory review controls and user-visible Intelligence prompts.

The review distinguished:

- canonical PT-BR source catalogs and compatibility fallback copy, which are allowed;
- first-party runtime renderers that bypass the localization owner, which are not allowed for a Surface-complete locale;
- persisted semantic presentation identities that intentionally retain source fallback copy but rerender through the current locale;
- public website/legal readiness pages, which are outside the Native/USB Surface locale contract and remain a separate web-localization scope.

## Real gaps found

### 1. ORDAX Studio workspace runtime

The newly integrated Studio workspace rendered Portuguese state/metric/security copy directly from `system/apps/studio/ui/workspace-controls.mjs`.

Correction:

- add a dedicated Studio source/en-US catalog;
- consume the shared Surface localization owner instead of owning locale state;
- rerender on locale changes;
- fail closed on unknown message ids;
- gate both catalog completeness and absence of raw renderer copy.

### 2. First Run account/legal registration block

The First Run registration block was added after the older OOBE catalog and contained direct `textContent` for Privacy/Terms plus legal/registration strings absent from the translated table.

Correction:

- move registration/legal copy to semantic message ids;
- parameterize canonical document version/effective date;
- cover every locale recognized by the OOBE (`pt-BR`, `en-US`, `es-ES`, `de-DE`, `fr-FR`) so retained compatibility is not regressed;
- fail closed on unknown ids or missing template parameters.

### 3. User-visible Intelligence responses

Notes document summaries and System explanations used Portuguese default prompts even when the Surface locale was `en-US`. Controls were translated, but generated answers could still be Portuguese.

Correction:

- make the client-action prompt/context copy complete for `pt-BR` and `en-US`;
- use an explicit locale when supplied;
- otherwise resolve the canonical Surface document language already synchronized by the localization owner;
- retain PT-BR for headless/non-Surface clients and unsupported locales;
- test English Notes context/prompt and English System diagnosis prompt.

## Reviewed paths that do not require a fix

- System/Updates deep UI uses semantic localization ids; legacy PT-BR presentation helpers are not used by its localized renderer.
- Update notifications persist a semantic `presentation.id` and rerender title/message through the current localization owner; stored PT-BR fallback text remains compatibility data only.
- Local Memory review controls receive all product copy from Account localization and are recreated when Account repaints for a locale change.
- First-party manifests may retain PT-BR source metadata where the Surface maps it through `app.*` message ids before presentation; Studio fallback panel copy already has explicit PT-BR/en-US entries.
- Existing Files, Settings, Notes, Internet, Account, System, Home, power, boot, network/battery and notification localization regression gates remain authoritative and were not weakened.

## Web scope

Public account/legal readiness pages under `sites/public/` are currently PT-BR-oriented. They are not advertised by `docs/LOCALIZATION.md` as part of the Native/USB `SURFACE_COMPLETE_LOCALES` contract. They must be handled as a separate portal localization rollout before claiming the public website itself is fully bilingual.

## Release consequence

These fixes modify `system/`. Therefore any earlier canonical v4 candidate created before this audit must not be treated as the final current-product candidate. After this change is merged and CI is green, the canonical System/Surface/Local-AI artifacts and signing request must be regenerated from one exact new source commit before signing or physical USB proof.

## Acceptance

Source acceptance requires:

- Studio PT-BR/en-US catalog parity and live locale response;
- no raw Studio Portuguese product copy in the workspace renderer;
- semantic First Run registration/legal copy with complete OOBE locale coverage;
- English Notes/System Intelligence prompts when Surface language is `en-US`;
- existing localization/deep-flow/Foundation gates green;
- no weakening of fallback/security/release/USB boundaries.

Physical acceptance remains separate: final USB smoke must still verify truncation, font rendering, layout width, OOBE transitions and runtime locale switching on the supported notebook/display.
