# OrdaX localization

Status: **ACTIVE MVP POLICY**

OrdaX separates system language, application language and installable language resources. A locale being recognized by the OS does not imply that every product surface or every app is complete in that locale.

## MVP language set

The public Native/USB MVP Surface selectors expose:

- `pt-BR` — Portuguese (Brazil), source/default language;
- `en-US` — English.

The system still recognizes retained `es-ES`, `de-DE` and `fr-FR` compatibility/OOBE state, but those locales remain hidden from the public Surface selector until complete Surface coverage reaches launch quality.

## Component-owned localization

Every first-party app declares a localization contract. The system locale is the default for apps, but an app may expose an explicit per-app locale override. An app is not required to support every locale that the Surface supports, and an app may support additional locales that the Surface does not yet expose.

Example:

```text
Surface locale = en-US
Files locale   = en-US (inherits system)
Notes locale   = en-US (inherits system)
Example app    = zh-Hans (explicit app override, optional pack installed)
```

This is intentional. Adding Mandarin to one app must not falsely advertise the entire OrdaX Surface as Mandarin-complete.

Each app declares:

- source locale;
- locales bundled with that app version;
- optional locales that may be installed later;
- whether the user may override the app locale independently.

Current first-party MVP apps bundle `pt-BR` and `en-US`. PT-BR remains the guaranteed source fallback.

## Language packs

Optional translations are resource-only language packs under `ordax.localization-pack/1`. They are not applications, services or executable plugins.

A pack binds to:

- target kind and target id;
- canonical locale;
- independent semantic version;
- SHA-256 of the message contract expected by the target;
- SHA-256 and exact size of the pack bytes;
- publisher and signature.

A language pack cannot request permissions, capabilities, an entrypoint or executable payload. Installing a translation can therefore never grant filesystem, network, microphone, camera or other authority.

The message-contract hash is the compatibility boundary. A translation correction can update independently when message ids/placeholders are unchanged. If an app update changes its message contract, an older incompatible pack is not activated.

## Selection and fallback

Locale resolution is deterministic:

1. use a compatible explicit app override when present;
2. otherwise use the compatible system locale;
3. otherwise use the app source locale.

If a user selected an optional app locale and later removes that pack, the app first falls back to the current system locale when supported. It does not render a partially translated mixture. Source fallback is the final safe state.

## Updates

Language packs are designed to travel through the authorized OrdaX update/catalog trust path without becoming a second updater.

Activation order:

```text
authorized catalog
 -> download to inactive staging
 -> verify size + content hash + signature
 -> verify target + locale + message-contract hash
 -> atomically activate resource pack
 -> preserve previous known-good pack for rollback
```

A failed language-pack update preserves the working app and previous translation. Rolling back a translation does not require rolling back the app, Surface or boot-critical Base when their contracts are still compatible.

This allows later delivery of:

- a new locale for one app;
- a new locale for several apps;
- spelling/terminology corrections only;
- accessibility-copy corrections;
- a future full Surface locale after complete coverage is proven.

## Product boundaries

The shared Surface, public site and Creator are separate artifacts. They may share the same policy and pack schema, but each keeps its own localization owner and coverage gate. The public site must not import the Surface runtime, and Creator must not depend on the Surface to render its safety prompts.

Translations belong to product owners, never platform forks:

```text
message identity/catalog
 -> component localization contract
 -> locale resolution
 -> Web/Mobile/Desktop/USB/Native adapter only where platform formatting differs
```

Do not copy screens per language. Dynamic state must be translated from structured semantic state rather than concatenated source-language strings.

Locale and keyboard layout stay separate. Choosing English does not silently change a Brazilian physical keyboard, and choosing another language does not invent an unproven keyboard layout. Physical keyboard support remains governed by `docs/contracts/keyboard-layout.json`.

Machine-readable policy: `docs/contracts/localization-packs.json`.
