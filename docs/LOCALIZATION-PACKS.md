# OrdaX localization and language-pack architecture

## Product rule

Localization is component-scoped. The operating system owns the user's preferred system locale and the fallback policy; each app, service, Creator surface or public-site artifact owns the messages it renders.

PT-BR remains the source/default locale for the current MVP. en-US is a launch locale. Additional locales do not need to appear in every component at the same time, and adding a locale to one app must never imply that the complete Surface supports that locale.

The machine-readable policy is `docs/contracts/localization-packs.json`.

## Three separate contracts

OrdaX deliberately separates localization metadata, translation content and release authority.

### Component localization metadata

`prototype-ordax.component-localization/1` describes what one component supports:

- component/target id;
- source locale;
- bundled locales;
- optional locales that may be installed later;
- whether a per-app locale override is allowed;
- pack policy.

Current first-party apps use the component-scoped policy, bundle `pt-BR` + `en-US`, and inherit the system locale unless an explicit compatible app override is selected.

### Translation content pack

`prototype-ordax.localization-pack/1` is the message payload contract. It contains only component-owned translation data:

- `componentId`;
- `componentVersion`;
- `packVersion`;
- `locale`;
- `sourceLocale`;
- `kind` (`bundled` or `external`);
- message-id keyed text.

The content contract validates message-key parity and interpolation-placeholder parity. It does not grant installation authority and it is not an updater.

### Signed release descriptor

`prototype-ordax.localization-pack-release/1` is the distribution envelope for an external pack. It is separate from the message payload and binds a release to:

- target kind and target id;
- exact component version;
- locale;
- independent pack version;
- SHA-256 of the target message contract;
- SHA-256 and exact byte size of the pack artifact;
- bounded non-empty publisher identity;
- bounded non-empty signature metadata.

Whitespace-only publisher or signature values are invalid. The descriptor is structurally forbidden from declaring permissions, capabilities, requested capabilities, an entrypoint or an executable payload. Installing a translation therefore cannot mint filesystem, network, microphone, camera or other application authority.

External release matching is fail-closed: the receiving component must carry an explicit localization `packPolicy`, and only `component-scoped` policy may match an external localization release. A `bundled-only` component cannot accept one even if unrelated release metadata appears valid.

Structural descriptor validation is not cryptographic signature verification. Signature/provenance verification remains the responsibility of the authorized OrdaX release/update path before activation.

## Bundled vs optional locales

A bundled locale ships with the owning component and is available offline immediately. For the current public MVP baseline, first-party apps bundle complete `pt-BR` and `en-US` catalogs.

An optional locale must be declared by the component before an installed external pack can make it available. A downloaded pack for an undeclared locale is not activated merely because its schema is valid.

Example:

```text
Surface        pt-BR en-US
Files          pt-BR en-US
Notes          pt-BR en-US + optional zh-Hans
3D Print app   pt-BR en-US + optional zh-Hans ja-JP
Creator        pt-BR en-US
```

A component with `bundled-only` pack policy cannot declare optional installable locales and cannot match an external localization release.

## Locale resolution and per-app overrides

Resolution is deterministic and uses complete catalogs, never a partially mixed translation:

1. if the component allows app override and the requested app locale has an exact or compatible available match, use it;
2. otherwise use an exact or compatible system locale when available;
3. otherwise use the component source locale.

Only bundled locales plus optional locales that are both declared **and installed** participate in availability.

A compatible but non-exact language match is explicitly reported as degraded. For example, a request for `pt-PT` may resolve to available `pt-BR`; that remains an app-override or system match according to its source, but it is not reported as an exact locale match.

If a user selected an optional app locale and later removes that pack, the app falls back to the current compatible system locale before falling back to its source locale. Missing translation resources are an availability/degraded-localization state, not an app-health or boot-health verdict.

Example:

```text
System locale  = en-US
Notes override = zh-Hans
zh-Hans pack   = installed
Result         = Notes uses zh-Hans

zh-Hans pack   = removed
Result         = Notes uses en-US, then pt-BR only if en-US is unavailable
```

## Component and version isolation

A language pack belongs to one component version. It cannot silently override unrelated apps. This keeps failure domains aligned with OrdaX modularity:

- an app translation defect cannot break boot;
- a Creator translation update cannot replace Surface strings;
- the public site remains independent from the product Web/Surface runtime;
- a new app can support a locale before the rest of the system does;
- translation corrections can be released without forcing a boot-critical Base A/B update.

The message-contract hash provides an additional compatibility boundary for external releases. A pack release is compatible only when its target, declared optional locale, explicit component-scoped policy, component version and expected message-contract hash all match.

## Independent update model

App code and translation data have separate versions.

Example:

```text
notes component       20.4.0
notes pt-BR pack       3.1.0 (bundled)
notes en-US pack       3.1.0 (bundled)
notes zh-Hans pack     1.0.0 (external)
```

A spelling or terminology correction can publish `notes zh-Hans 1.0.1` without publishing Notes 20.4.1. If Notes changes its message contract or component version, an older incompatible external release is not activated.

## Update authority and activation

Language-pack distribution uses the authorized OrdaX update path. The Store/catalog may discover or present a pack, but it is not a second updater and cannot mint installation authority.

External activation must follow these invariants:

```text
authorized catalog/release path
 -> download immutable artifact to inactive staging
 -> verify exact size + content hash + signature/provenance
 -> validate translation-content schema and message parity
 -> verify target + locale + component version + message-contract hash
 -> atomically activate resource-pack pointer
 -> retain previous known-good pack for rollback
```

A failed activation preserves the currently working pack. Rolling back translation data never rolls back user data and does not require rolling back the app or boot-critical Base when their contracts remain compatible.

## Security boundaries

External language packs never gain authority through localization metadata. They cannot:

- change executable code;
- request permissions or capabilities;
- add an entrypoint;
- execute scripts;
- alter another component's catalog;
- replace the source locale through an external source-locale install;
- bypass message-id/placeholder parity;
- bypass the authorized update/release trust path.

The content pack contains text resources. The release descriptor contains integrity/provenance metadata. Neither is an application permission manifest.

## Product boundaries

The shared Surface, Creator and public site are separate localization owners. They may consume the same localization policy/contracts, but the public site must not import the Surface runtime and Creator must not depend on Surface rendering for its safety prompts.

Translations belong to product owners, never platform forks:

```text
message identity/catalog
 -> component localization metadata
 -> locale resolution
 -> platform adapter only where platform formatting differs
```

Locale and keyboard layout remain separate concerns. Choosing English does not silently change a Brazilian physical keyboard, and adding another app locale does not invent an unproven keyboard layout. Keyboard support remains governed by `docs/contracts/keyboard-layout.json`.

## Quality gates

Every publicly supported pack must prove:

- valid locale and semantic versions;
- exact component ownership/version binding;
- exact message-key parity with its source contract;
- placeholder parity;
- no empty message strings;
- deterministic whole-catalog fallback;
- compatible non-exact matches are marked degraded;
- optional locale is declared by its component;
- external release matching requires explicit component-scoped policy;
- release descriptor is authority-free;
- content and release hashes are structurally valid;
- rendered accessibility/status/error copy stays under the owning localization boundary.

Cryptographic signature verification is an update-path gate, not a function of the pure localization contract module.

## Current migration

The existing Surface catalogs are already split by functional owner. First-party app definitions now project their localization metadata through the shared component-localization contract rather than maintaining a second validator inside the app contract.

Creator and `public-site` remain separate localization owners. They may adopt the same content/release schemas without importing Surface runtime code.
