# Product Modes

Status: CANONICAL FOR PROTOTYPE

## One product, five execution modes

OrdaX is one product with one identity, one Surface, one application model and shared synchronized state.

```text
OrdaX Web
   -> OrdaX Mobile (Android / iPhone)
   -> OrdaX Desktop
   -> OrdaX USB
   -> OrdaX Native
```

These are capability targets, not separate products or forks.

## MVP availability

The architecture remains prepared for all five modes, but **public MVP availability is USB-only**.

```text
MVP available:          OrdaX USB
Coming soon:            Web, Mobile, sync/continuity
Future product surface: Desktop experience
Post-MVP foundation:    OrdaX Native (internal SSD/NVMe/HDD)
```

Native installation source/contracts/proofs remain preserved. Stable/MVP must not expose its installer capability, target discovery token, destructive internal-disk write or installation CTA.

### 1. OrdaX Web

Runs in a browser with the smallest native capability envelope. It is the zero-install entry point and must use the real shared Surface and app source.

### 2. OrdaX Mobile

Runs as a normally installed Android or iOS application and uses the same OrdaX account, shared application model and design system.

Mobile is not a reduced Desktop port. It is its own first-class capability target: stronger than Web for notifications, camera/media, secure device storage, biometrics and offline use, but intentionally without raw-disk, boot-media or arbitrary privileged-host authority.

Android- and iOS-specific behavior must remain behind the mobile capability adapter. The product Surface and app logic must not fork into separate Android/iPhone implementations unless a platform rule makes a thin native bridge unavoidable.

### 3. OrdaX Desktop

A normally installed desktop application for Windows first, with other host platforms allowed later. It is the intermediate tier between browser/mobile access and the bootable operating system.

It provides capabilities a browser cannot safely or reliably provide, including controlled local filesystem access, native notifications, background tasks where allowed, local application integration, signed automatic updates and the privileged Creator capability for preparing OrdaX USB media.

OrdaX Desktop is not the OrdaX operating system and must never own raw host hardware by default. Privileged operations require a narrow, explicit capability boundary and separate user authorization.

### 4. OrdaX USB

Boots the real OrdaX operating system from removable media. It owns the machine while booted and therefore has substantially broader capabilities than Web, Mobile or Desktop.

### Runtime mode identity

USB and Native Disk deliberately share the same signed `system.tar`, Surface source and Native adapter. Their execution mode is **not** inferred from bus type, filesystem layout or the presence of an installer helper.

The bootstrap carries one explicit, hash-pinned marker:

```text
/ordax/bootstrap/config/product-mode
```

Allowed values are exactly:

```text
usb
native-disk
```

The bootstrap exports that value as `ORDAX_PRODUCT_MODE`; guardian, supervisor and Surface preserve it. In the **Stable/MVP profile**, Native installation capability is forced unavailable even while its technical foundation remains present. A future post-MVP promotion may explicitly activate that capability after separate product/hardware gates.

The future installer writes `native-disk` into the target bootstrap as part of installation materialization. This remains configuration of one product mode, not a code or release fork.

### 5. OrdaX Native — post-MVP

Installs the OrdaX operating system to internal SSD/NVMe/HDD. It is preserved as a future deployment mode and is **not an MVP user-facing capability**.

## One account across all devices

The user has one OrdaX identity, not one account per device or product mode.

```text
one OrdaX account
  -> Web session
  -> Android phone/tablet
  -> iPhone/iPad
  -> Windows Desktop
  -> OrdaX USB
  -> OrdaX Native
```

When cross-device services are implemented, signing in on another supported device may restore the safe synchronized portion of the user's environment according to account entitlements and device capability.

For the MVP, Web, Mobile and synchronization are not active product promises; they may be shown only as **Coming soon / Em breve**. Account architecture stays ready for them without inventing billing or device limits now.

See `docs/ACCOUNT-SYNC-AND-PLANS.md`.

## Single-source Surface

The same source files implement the visual shell, apps, settings, design tokens and shared interaction behavior for every supported mode where that UI is applicable.

```text
system/surface/      # one visual source
system/apps/         # one app source
system/services/     # shared service/domain logic
system/adapters/     # environment capabilities only
```

Target adapters:

```text
system/adapters/web/
system/adapters/mobile/
system/adapters/desktop/
system/adapters/native/
```

`mobile` owns Android/iOS capability differences; `native` is shared by USB and internal OrdaX installations wherever the capability is genuinely the same.

Forbidden architecture includes separate application trees such as `apps-android/`, `apps-ios/`, `apps-desktop/` or independent Surface forks. Thin native bridges are allowed only for genuine platform APIs.

## Capability adapters

Differences between execution environments live only behind capability interfaces. Examples include filesystem access, networking details, camera/media, biometrics, native notifications, background tasks, installer/update operations, raw removable-device access and boot-media creation.

The UI consumes capability contracts, not platform-specific APIs directly.

## Mobile security boundary

Mobile clients must use platform secure storage for device-bound credentials/tokens where appropriate and must never receive release signing keys, device-private keys from another installation, raw disk authority or arbitrary privileged-command capabilities.

Biometric authentication may gate local access to a session or secret, but it does not replace the canonical account/authentication model.

## Desktop security boundary

The Desktop application separates its unprivileged UI/runtime from privileged host operations. The privileged helper exposes explicit operations rather than arbitrary command execution. Raw disk access is reserved for removable-media creation/recovery and fails closed on ambiguous device identity.

## Update model

All modes evolve from versioned source, but installation mechanics differ:

```text
Web       -> deployment refresh
Mobile    -> signed/store application update
Desktop   -> signed application update
USB       -> verified OrdaX release activation
Native    -> verified OrdaX release activation
```

Client application updates and OrdaX OS releases are distinct delivery channels even when both originate from the same repository commit.

## Synchronization model

Safe, meaningful user state follows the user's OrdaX identity across modes. Examples include appearance, preferences, workspace metadata, app-state metadata and user-selected cloud content.

Device-local secrets never synchronize. Examples include private device keys, machine identity secrets, hardware drivers, raw disk state and ephemeral caches.

Sync must be offline-tolerant, server-authorized, encrypted in transit and have an explicit conflict-resolution model before production promotion.

## Operational realtime and remote device actions

All product modes share one operational domain model in addition to account synchronization.

```text
portable account/user state -> OrdaX Sync
live orders/jobs/telemetry -> OrdaX Operational Realtime
device mutation intent -> OrdaX Action Gateway -> Device Agent
```

Web and Mobile do not get separate order databases, printer queues or authorization rules.
They consume the same versioned events and action contracts as Desktop/Native according to
their capability envelope.

The public MVP remains USB-only. The source contract exists now so Web/PWA and a future
Android APK can be added after the MVP without redesigning Account, Spaces or Device Agent.
There is currently **no released OrdaX APK and no public remote-device runtime**.

See `docs/OPERATIONAL-REALTIME.md`.

## Plans and future monetization

Pricing, billing, commercial tier names and device-count limits are intentionally undefined at MVP stage.

The entitlement architecture remains prepared for future value-bearing services such as synchronization capacity, cloud storage, backup/restore, cross-device continuity, collaboration, premium compute and support. The product direction is to monetize ecosystem value, not to charge arbitrarily for a second device.

Device registration is a security/session boundary first. No current commercial device limit is defined, and no client-claimed entitlement is authoritative.


## Promotion path

A user can gain capability without changing product identity:

```text
OrdaX Web / Mobile
  -> sign in and restore synchronized environment
  -> optionally install OrdaX Desktop
  -> optionally create OrdaX USB inside Desktop
  -> boot OrdaX USB
  -> restore synchronized environment
  -> optionally install OrdaX Native on SSD/HD
```

The goal is continuity of identity, Surface, apps and safe synchronized user state across every tier while keeping each environment's authority boundary explicit.
