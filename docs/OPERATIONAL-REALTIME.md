# OrdaX Operational Realtime and Device Actions

Status: **PRE-MVP CONTRACT FOUNDATION — RUNTIME POST-MVP**

## Why this exists

Account synchronization and live operations solve different problems.

```text
Account / Spaces / preferences / portable state
        -> OrdaX Sync

Orders / production queues / telemetry / live status
        -> OrdaX Operational Realtime

Commands to a physical device
        -> OrdaX Action Gateway
        -> authorized Device Agent capability
        -> device adapter
```

Do not use account sync as a command queue, and do not use notifications as a source of truth.

## Operational events

An operational domain owns canonical state. The event stream distributes changes so Web,
Mobile, Desktop, USB and Native can update quickly.

Each published event is bound to:

- one account and one Space;
- a stable aggregate id and revision;
- a server-authoritative sequence;
- a versioned domain and event type;
- a bounded source identity and payload.

Client wall-clock time is never the global conflict/order authority. A client reconnects
using the last server sequence and must reconcile canonical state when a gap cannot be
replayed.

Examples:

```text
business.orders
  order.created
  order.state-changed

business.production
  production.queue-changed

fabrication.jobs
  print.started
  print.progress
  print.failed
  print.completed

device.telemetry
  printer.temperature
  printer.connectivity
```

## Device actions

Remote control is a different boundary from event observation.

A phone or Web client may request an action, but the request itself grants no authority.
The server-side Action Gateway must bind the request to a real account/Space/project/device
grant and an exact Device Agent capability.

```text
client intent
 -> authenticated OrdaX session
 -> account + Space membership
 -> entitlement/policy
 -> explicit device capability grant
 -> idempotency + expiry + stale-state checks
 -> Action Gateway
 -> Device Agent
 -> narrow device adapter
 -> structured receipt + audit
```

No product path may turn this into a generic shell, raw-disk API, release-key access or
implicit administrator session.

The existing Device Agent v1 grant includes project scope. The first action contract
therefore keeps `projectId` required. If future printer-farm operations need Space-only
device grants, version the authorization contract explicitly instead of inventing a fake
project.

## Notifications

Notifications are presentation.

An operational event such as `print.failed` or `order.state-changed` may later produce
a local notification, Web notification or Android/iOS push. The notification does not own
the order, print job, device state or action authority.

A push payload must never be treated as a trusted command.

## Pizzaria

The first useful live domains are:

- orders;
- production queue;
- order status;
- alerts that need human attention.

A future phone can show the same Space state as the desktop without periodically copying
files between devices.

## Impressão 3D

The first useful live domains are:

- production jobs;
- printer connectivity;
- progress/remaining estimate;
- material/profile metadata;
- faults and completion.

Future typed capabilities may include pause/cancel after explicit authorization. Slicer,
CAD, farm management and direct printer protocols stay outside this foundation and may
arrive as apps, Skills, Connectors or Device Agent adapters.

## Web and Mobile

OrdaX Web and OrdaX Mobile consume the same operational contracts. They do not receive
separate databases or business rules.

```text
shared services/contracts
    +-> Web adapter
    +-> Mobile adapter
    +-> Desktop adapter
    +-> Native adapter
```

Mobile packaging technology remains replaceable. PWA/installed Web may be used for early
validation; Android APK and iOS packaging add secure storage, push, biometrics, background
lifecycle and platform integrations without forking the product.

## MVP boundary

This document deliberately does **not** add a realtime backend, APK or remote printer
runtime to the first USB gate.

Before the first USB we freeze the contracts so later implementation can arrive by normal
OrdaX updates without redesigning identity, Spaces or Device Agent authority.

Machine-readable owner: `docs/contracts/operational-realtime.json`.
