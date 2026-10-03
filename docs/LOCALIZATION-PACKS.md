# OrdaX localization and language-pack architecture

## Product rule

Localization is component-scoped. The operating system owns the user's preferred locale and fallback policy; each app, service, Creator surface or public-site artifact owns the messages it renders.

PT-BR remains the source/default locale for the current MVP. en-US is a launch locale. Additional locales are not required to appear in every component at the same time.

Example: if the system preference is `zh-Hans` and Notes ships a verified `zh-Hans` pack while Files only ships `pt-BR` and `en-US`, Notes renders in Simplified Chinese and Files falls back to its own source/default locale. The absence of a Chinese pack in Files must not block Notes, boot, or the Surface.

## Why packs are per component

A language pack belongs to exactly one component version. It is not a global bag of translations and cannot silently override unrelated apps. This keeps failure domains aligned with OrdaX modularity:

- an app translation defect cannot break boot;
- a Creator translation update cannot replace Surface strings;
- the public site remains independent from the product Web/Surface runtime;
- a new app can support a locale before the rest of the system does;
- translation corrections can be released without forcing a base OS A/B update.

## Pack identity

Every pack uses `ordax.localization-pack/1` and declares:

- `componentId` — the component that owns the rendered messages;
- `componentVersion` — the exact compatible component version;
- `packVersion` — independent semantic version for translation fixes;
- `locale` — BCP-47-style locale supported by the OrdaX validator;
- `sourceLocale` — canonical source locale for parity checks;
- `kind` — `bundled` or `external`;
- `messages` — message-id keyed text owned only by that component.

`componentVersion` compatibility is strict by default. A pack built for an older component is never assumed compatible with a newer component merely because message IDs happen to overlap.

## Bundled vs external packs

### Bundled

A bundled pack ships inside the component artifact and is available offline immediately. Stable/MVP first-party components should bundle the launch locales they publicly promise.

For the current MVP, a component advertised as fully bilingual must bundle complete `pt-BR` and `en-US` catalogs.

### External

An external pack is an independently published signed/update-catalog artifact. It may add a locale or correct translations without replacing the app itself.

External packs are never allowed to:

- change executable code;
- request new capabilities;
- alter app permissions;
- mutate another component's catalog;
- replace the source locale;
- bypass the component's message-id or placeholder contract.

The update authority must validate provenance, integrity, component compatibility and catalog parity before activation.

## Locale resolution

Resolution is per component:

1. use the user's requested locale when that exact locale is available;
2. otherwise try a compatible language match supplied by that component;
3. otherwise fall back to the component's declared source locale.

A component must remain usable even when it does not support the system-selected locale. Missing packs are a localization availability state, not an application failure.

## Independent update model

App code and translation data have separate versions.

Example:

```text
notes component       20.4.0
notes pt-BR pack       3.1.0 (bundled)
notes en-US pack       3.1.0 (bundled)
notes zh-Hans pack     1.0.0 (external)
```

A correction such as a mistranslated button can publish `notes zh-Hans 1.0.1` without publishing Notes 20.4.1. If Notes changes its message contract and becomes 20.5.0, compatible packs for 20.5.0 must be published or the component falls back safely until they exist.

## Update transaction requirements

Language-pack activation must use the same professional update principles as other independent OrdaX components:

- immutable versioned artifact;
- cryptographic integrity/provenance owned by the release pipeline;
- staged download before activation;
- validate schema, owner, locale, component version, exact message-key parity and placeholders;
- atomic activation pointer;
- retain known-good pack for rollback;
- failed pack activation leaves the previously active pack untouched;
- pack rollback never rolls back user data or the owning app;
- pack failure never makes a boot-critical component unhealthy.

## Locale independence across apps

There is deliberately no invariant saying every installed app must expose every system locale.

A first-party launch promise may define a required baseline such as `pt-BR` + `en-US`, but optional/add-on apps can publish a superset. For example:

```text
Surface        pt-BR en-US
Files          pt-BR en-US
Notes          pt-BR en-US zh-Hans
3D Print app   pt-BR en-US zh-Hans ja-JP
Creator        pt-BR en-US
```

The locale selector may distinguish between:

- **System language** — preferred locale used by every component that supports it;
- **Available for this app** — locales currently installed for the active app;
- **More language packs** — verified packs available from the component update catalog.

The UI must never imply that choosing a system language guarantees translation coverage in an app that has not published that locale.

## Adding Mandarin later

Mandarin support should be represented with an explicit Chinese locale such as `zh-Hans` (Simplified Chinese) and, when needed, `zh-Hant` (Traditional Chinese), instead of an ambiguous `zh` product label.

Adding it later does not require rebuilding the boot-critical base. The release sequence is:

1. translate one component's canonical message contract;
2. run key/placeholder and rendered-copy audits;
3. publish a pack bound to that component version;
4. add it to the signed component update catalog;
5. download/stage/validate/activate atomically;
6. let that component begin rendering Chinese immediately while unsupported components continue their own fallback.

## Security and quality gates

Every publicly supported pack must prove:

- exact message-key parity with its source pack;
- placeholder parity;
- no empty strings;
- valid locale and semantic versions;
- exact component ownership/version binding;
- deterministic fallback;
- no executable payload;
- no remote code, fonts, scripts or style injection through localization data;
- rendered accessibility labels and user-facing status/error strings use the same localization owner.

Machine translation may assist authoring, but a pack becomes a product-supported locale only after the same automated and product-review gates as any other release artifact.

## Current migration

The existing Surface catalogs are already separated by functional owner and provide the foundation for component packs. Migration should preserve current message IDs and introduce pack manifests around them rather than rewriting working copy.

Creator and `public-site` are separate localization owners and must not import the Surface runtime merely to obtain translations.
