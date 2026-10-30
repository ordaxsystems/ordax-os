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
cloud sync or account backup. The Native Surface reducer and portable Web runtime now use the same
`createPreferencePersistence` owner for the save/ACK status. Native Settings
displays `pending`, `saved` or `session-only` after an edit, obtained
from the Surface preferences port. The initial `not-written` state is
not displayed as a new durability confirmation. No extra store, sync
backend or runtime authority is introduced.


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


## Read-only physical USB reboot witness

The existing `ordax-mvp-smoke` collector supports an **optional**
non-sensitive light/dark witness of `appearance.theme`. It only calls the
same-origin Native GET endpoint and never modifies preferences, reboots the
computer, or writes to USB partitions. No other preference values, account
data or secrets are placed in evidence.

After selecting **Dark** in Native Settings and receiving `saved`
(meaning the host has confirmed the write), capture the first report on
the running OrdaX USB:

```sh
ordax-mvp-smoke collect --expected-theme dark --label before-reboot --output /var/lib/ordax/mvp-smoke/prefs-before.json
```

After an **operator-controlled reboot of the same USB and notebook**, collect
a second report, specifying the same expected cosmetic choice:

```sh
ordax-mvp-smoke collect --expected-theme dark --label after-reboot --output /var/lib/ordax/mvp-smoke/prefs-after.json
ordax-mvp-smoke reboot-compare --baseline /var/lib/ordax/mvp-smoke/prefs-before.json --after /var/lib/ordax/mvp-smoke/prefs-after.json --label preference-reboot
```

The new `reboot-compare` preserves the canonical source/runtime/health
checks but **requires different boot IDs** and the same recorded cosmetic
choice on both boots. Normal `compare` still requires the same boot, as
designed for the MVP tour. This witness does not attest the physical media,
bind reports cryptographically to a machine, verify unrelated preferences or
prove that a hardware reboot was actually performed. The operator must
record hardware/USB identity and visually verify the boot separately.
CI/QEMU simulations cannot replace the physical check.

The only preference value serialized is the harmless expected cosmetic choice,
`dark` or `light`; the Native GET body is never included in reports.

## Physical USB preference-continuity acceptance

This is a **manual, non-destructive** acceptance check, not a CI pass and not a
request to reimage a USB drive. Perform it only on a notebook actually booted
into OrdaX USB. Use the already-mounted canonical Native preferences service;
no substitute file, localStorage or external account is required.

1. In Settings, change a visible choice (for example, appearance). Confirm
   that the device status progresses from **pending** to **saved**. A change
   still marked **pending** or **session-only** is **not** a persistence pass.
2. Restart the Surface normally, without reformatting or removing the USB.
   Confirm the chosen value reappears. The initial **not-written** status after
   restart must not be misrepresented as proof of a fresh write.
3. Reboot the USB device normally and confirm the same choice persists. This
   is the physical continuity gate; a Chromium/QEMU run does not replace it.
4. If an ordinary storage failure is observed, do not force one or disconnect
   a mounted device to simulate it. Verify that **session-only** is reported
   and that the last previously confirmed value returns on the next boot.
   Recovery must not silently promote an unconfirmed choice.

Record device/USB model, exact source commit, distribution profile, boot mode,
preference ID, before/after value, the displayed write status, and the outcome
of Surface restart and full reboot. A missing real-device run remains
**UNVERIFIED**, never PASS. Do not log account tokens or unrelated user data.

The automated source test in `tests/test_native_preferences.py` also guards
that `/state/ordax/native-state` is bound to the host-visible
`/var/lib/ordax` **before** its loopback server starts, and that cleanup only
unmounts this state instead of erasing it.
