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

## Notebook independence and OrdaX Edge Runtime

A professional OrdaX operation must not require the user's notebook or Desktop app to remain
powered on.

The notebook may configure, observe or temporarily host development tooling, but production
continuity uses one of three topologies:

```text
1. cloud-authoritative
   client -> OrdaX Cloud -> operational domain

2. device-native
   client -> OrdaX Cloud -> Action Gateway -> agent/connector on the device

3. dedicated edge
   client -> OrdaX Cloud -> Action Gateway -> OrdaX Edge Runtime -> LAN device
```

`OrdaX Edge Runtime` is an infrastructure role, not a sixth user-facing product mode. It reuses
the Device Agent capability model and can run on a low-power always-on host, compatible NAS/server,
or directly on equipment that can safely host it. A normal Desktop/USB/Native client may host an
edge runtime for development or convenience, but professional availability cannot depend on that
client remaining open.

The Edge Runtime is responsible only for narrow local integration:

- maintain an outbound authenticated connection to the OrdaX service when remote access is enabled;
- expose versioned device capabilities;
- keep bounded durable local state needed for reconnect/reconciliation;
- bridge supported LAN/USB/serial/vendor APIs through narrow adapters;
- publish telemetry/events;
- execute only explicitly granted, typed and non-expired actions;
- produce receipts and audit data.

It does not own Account, Space membership, billing, global business policy or unrestricted host
administration.

### Power and network failure

Software cannot keep an unpowered printer, router or Edge host online. If site power is lost, the
OrdaX Cloud may preserve canonical orders/jobs and other clients with independent connectivity may
remain online, but local equipment is unavailable until power returns.

For installations that need higher availability, power continuity is a hardware concern: UPS/nobreak,
device-native battery/power-loss recovery and redundant connectivity can be added when appropriate.
OrdaX may monitor those capabilities later but must not claim software alone solves loss of power.

After a disconnect, stale or dangerous device actions are not blindly replayed. They must respect
expiry, idempotency, current device revision and domain-specific reconciliation before execution.

### 3D-print example

When a printer can accept a complete job into its own durable storage, OrdaX should prefer that mode:
the job continues inside the printer and the notebook can be shut down. Telemetry/control may come
from the printer's own connector or from an Edge Runtime.

For printers that require a host to stream/control the job, the required host should be an always-on
Edge Runtime rather than the user's notebook. If that Edge host loses power, continuity depends on
the printer's own power-loss-recovery capability.

### Delivery / marketplace example

A future OrdaX delivery/ordering service follows the cloud-authoritative topology. Orders are accepted
and stored by the OrdaX service, not by one merchant notebook. The owner can receive the same queue on
Web, phone, tablet or another authorized terminal.

A store Edge Runtime is optional and is used only when local integrations are needed, such as kitchen
printers, displays, POS, scales or other equipment. Turning off the merchant notebook does not stop
the ordering service.

If the store internet connection is lost, the cloud may continue receiving online orders, but the
store cannot receive them over that failed link until connectivity returns; an authorized phone on
cellular data may remain usable independently.

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
