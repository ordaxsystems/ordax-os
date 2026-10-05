# OrdaX localization and language-pack architecture

## Product rule

Localization is component-scoped. The operating system owns the user's preferred system locale; each app, service, Creator surface or public-site artifact owns the messages it renders and its supported locale set.

PT-BR remains the source/default locale for the current MVP. en-US is a launch locale. Additional locales are not required to appear in every component at the same time.

A component may also allow an explicit per-app locale override. For example, the Surface may remain `en-US` while Notes uses an installed `zh-Hans` pack. Files can continue inheriting `en-US` without claiming Mandarin support. A missing translation pack must not block the app, boot, or the Surface.

## Why packs are per component

A language pack belongs to exactly one component version. It is not a global bag of translations and cannot silently override unrelated apps. This keeps failure domains aligned with OrdaX modularity:

- an app translation defect cannot break boot;
- a Creator translation update cannot replace Surface strings;
- the public site remains independent from the product Web/Surface runtime;
- a new app can support a locale before the rest of the system does;
- translation corrections can be released without forcing a base OS A/B update.

## Content pack identity

Translation content uses `prototype-ordax.localization-pack/1` and declares:

- `componentId` — the component that owns the rendered messages;
- `componentVersion` — the exact compatible component version;
- `packVersion` — independent semantic version for translation fixes;
- `locale` — validated locale identifier;
- `sourceLocale` — canonical source locale for parity checks;
- `kind` — `bundled` or `external`;
- `messages` — message-id keyed text owned only by that component.

`componentVersion` compatibility is strict by default. A pack built for an older component is never assumed compatible with a newer component merely because message IDs happen to overlap.

The content contract verifies message-id and placeholder parity. It deliberately does not carry install authority, signatures or executable metadata.

## Signed delivery envelope

An independently delivered external pack is accompanied by `prototype-ordax.localization-pack-delivery/1`. The delivery envelope binds the resource to:

- `componentId` and exact `componentVersion`;
- `packVersion` and locale;
- SHA-256 of the expected message contract;
- SHA-256 and exact size of the delivered bytes;
- publisher identity and signature.

The delivery envelope is resource-only. It rejects authority-bearing fields such as permissions, capabilities, entrypoints or executable payload declarations. Installing a translation therefore cannot grant filesystem, network, microphone, camera or other app authority.

A delivery is compatible only when its component identity/version, declared optional locale and message-contract hash match the receiving component contract. Signature verification and authorized-catalog provenance remain responsibilities of the release/update trust path; the localization contract does not create a second updater.

## Bundled vs external packs

### Bundled

A bundled pack ships inside the component artifact and is available offline immediately. Stable/MVP first-party components should bundle the launch locales they publicly promise.

For the current MVP, a component advertised as fully bilingual must bundle complete `pt-BR` and `en-US` catalogs.

### External

An external pack is an independently published resource delivered through the authorized update/catalog path. It may add a declared optional locale or correct translations without replacing the app itself.

External packs are never allowed to:

- change executable code;
- request new capabilities or permissions;
- declare an entrypoint;
- mutate another component's catalog;
- replace the source locale as an external pack;
- bypass the component version, message-id, placeholder or message-contract-hash boundary.

## Locale resolution

Resolution is deterministic and per component:

1. if the component allows it, use a compatible explicit app override that is actually available;
2. otherwise use a compatible system locale that is actually available;
3. otherwise fall back to the component's declared source locale.

A compatible language match may be used within the component's available locales. Optional locales become available only when they are both declared by the component and present in the installed optional-locale set.

If a user selected an optional app locale and later removes that pack, the component first falls back to the current system locale when supported, then to its source locale. It does not render a partially translated mixture.

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

A correction such as a mistranslated button can publish `notes zh-Hans 1.0.1` without publishing Notes 20.4.1. If Notes changes its message contract or component version, an older incompatible delivery is not activated; the component falls back safely until a compatible pack exists.

## Update transaction requirements

Language-pack activation must use the same professional update principles as other independent OrdaX components:

- discover only through an authorized catalog/update owner;
- download immutable bytes to inactive staging;
- validate content schema, owner, locale, component version, exact message-key parity and placeholders;
- validate delivery size, content SHA-256, signature/provenance and message-contract SHA-256;
- activate atomically only after all validation succeeds;
- retain the previous known-good pack for rollback;
- failed activation leaves the previously active pack untouched;
- pack rollback never rolls back user data or the owning app when its contract is still compatible;
- pack failure never makes a boot-critical component unhealthy.

## Locale independence across apps

There is deliberately no invariant saying every installed app must expose every system locale.

A first-party launch promise may define a required baseline such as `pt-BR` + `en-US`, while an app may later declare and install additional optional locales. For example:

```text
Surface        pt-BR en-US
Files          pt-BR en-US
Notes          pt-BR en-US zh-Hans
3D Print app   pt-BR en-US zh-Hans ja-JP
Creator        pt-BR en-US
```

The locale UI may distinguish between:

- **System language** — preferred locale used by every component that supports it;
- **App language** — optional explicit override when the component allows it;
- **Available for this app** — bundled locales plus declared optional packs currently installed;
- **More language packs** — verified packs available through the authorized component update catalog.

The UI must never imply that choosing a system language guarantees translation coverage in an app that has not published that locale.

## Adding Mandarin later

Mandarin support should be represented with an explicit Chinese locale such as `zh-Hans` (Simplified Chinese) and, when needed, `zh-Hant` (Traditional Chinese), instead of an ambiguous `zh` product label.

Adding it later does not require rebuilding the boot-critical base. The release sequence is:

1. declare the optional locale in the owning component contract;
2. translate the component's canonical message contract;
3. run key/placeholder and rendered-copy audits;
4. publish content plus a signed delivery envelope bound to the component version and message-contract hash;
5. add the immutable artifact to the authorized update catalog;
6. download, stage, validate and activate atomically;
7. let that component render Chinese immediately while unsupported components continue their own fallback.

## Security and quality gates

Every publicly supported pack must prove:

- exact message-key parity with its source pack;
- placeholder parity;
- no empty strings;
- valid locale and semantic versions;
- exact component ownership/version binding;
- deterministic app-override/system/source fallback;
- declared optional-locale membership for external additions;
- delivery content hash, size and message-contract-hash binding;
- no executable payload or authority-bearing fields;
- no remote code, fonts, scripts or style injection through localization data;
- rendered accessibility labels and user-facing status/error strings use the same localization owner.

Machine translation may assist authoring, but a pack becomes a product-supported locale only after the same automated and product-review gates as any other release artifact.

## Canonical owners

The existing Surface catalogs remain the Surface localization owner. Component pack contracts wrap component-owned messages rather than rewriting working copy.

The current implementation owners are:

- content/parity contract: `system/contracts/localization-pack.mjs`;
- signed delivery envelope: `system/contracts/localization-pack-delivery.mjs`;
- per-component locale resolution: `system/services/i18n/component-locale.mjs`;
- machine-readable policy: `docs/contracts/localization-packs.json`;
- app-distribution linkage: `docs/contracts/app-distribution.json`.

Creator and `public-site` remain separate localization owners and must not import the Surface runtime merely to obtain translations.
