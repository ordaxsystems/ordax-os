# Native Intelligence service boundary — 2026-10-14

Status: **source-only, not host-composed, not remotely reachable**.

This slice follows the merged Web remote adapter (`ordax-os#1765`) and the merged Platform trusted Relay binding (`ordax-platform#153`). It closes the next internal ownership gap without claiming a deployed transport.

## Decision

Remote/system callers must never bypass the final Native Intelligence composition and call Local AI, `llama.cpp`, a provider, Memory or the model router directly.

The Native consumer path currently composes in this order:

```text
createIntelligenceRuntime(local AI + canonical model router)
  -> Application Intelligence awareness/context
  -> selected-Space Profile content context when available
  -> identity-bound Memory for the selected Space when available
  -> selectedSpaceIntelligence
```

`selectedSpaceIntelligence` is therefore the port a Native host bridge must receive. The service boundary must not construct a second Intelligence runtime or repeat those wrappers.

## Implemented source boundary

`system/services/intelligence/native-service.mjs` accepts three already-owned ports:

- final consumer `ordax.intelligence/1` port;
- `ordax.identity-session/1`;
- `ordax.space-selection/1`.

It validates a narrow host-callable request envelope, requires the request subject and Space to match the current Native state exactly, delegates the canonical request to the supplied final Intelligence port, revalidates the canonical response, then reads identity/Space again before returning the result.

If identity or Space changes while inference is pending, the result is discarded. There is no silent retarget or replay.

## Context support in this slice

Supported source semantics:

```text
signed-in identity + no selected Space
  -> context { subjectId, spaceId: null, projectId: null }

signed-in identity + selected Space
  -> context { subjectId, spaceId: selectedSpace.id, projectId: null }
```

Project-bound remote inference is intentionally rejected. Native Memory currently authorizes selected-Space context with `projectId=null`, and the Native composition does not expose a canonical current-project selection owner that can validate a remote project binding. The Web/Platform envelopes may represent Space+Project for future compatibility, but the device must fail closed until that owner exists.

This is not a reason to create a second project selector or infer a project from UI text, recent files, Work state or model output.

## Security / ownership fences

The service boundary:

- does not call `fetch()`;
- has no endpoint discovery or network socket;
- has no provider or provider credentials;
- does not import Local AI or the model router;
- does not read/write Memory directly;
- does not issue grants or execute tools;
- does not trust provider/model/client/device/grant fields in the request;
- uses exact request/context fields at the host boundary and delegates request semantics to the canonical Intelligence validator;
- revalidates `ordax.intelligence-response/1` and therefore preserves `authority=none`.

## Background Runtime is not the transport host

The existing `ordax.background-runtime/1` foundation owns leases, budgets, checkpoints, cancellation and recovery for bounded background work. Its contract currently states `source-foundation-runtime-disabled-for-public-autonomy`, with production store/scheduler/auto-resume disabled.

Remote Intelligence does not require enabling autonomous background execution. This slice does not change Background Runtime rollout flags or use it as a substitute transport.

## Runtime packaging audit

The current Stable Surface runtime packages Python + WebKitGTK/Cage and does not package Node. The privileged `ordax_browser_host` already has a host-to-JavaScript and JavaScript-to-host bridge used by component probation, while the canonical Intelligence runtime currently lives in the Native JavaScript composition.

Therefore the next transport slice should first reuse that existing WebKit bridge pattern rather than adding Node or porting Intelligence semantics to Python. A browser-host bridge may transport bounded messages, but it must call the service boundary above and must not implement model/provider/Memory logic itself.

## Explicitly not implemented here

- no import/wiring from `system/composition/native/main.mjs`;
- no `ordax_browser_host` command/message handler;
- no Unix socket or loopback HTTP endpoint;
- no Product/Runtime action;
- no public network route;
- no project context;
- no cancellation claim across process boundaries;
- no deployed/credentialed E2E;
- no physical Stable proof.

Tests fail if this source-only service is already referenced by the current Native composition or browser host.

## Next gates

1. compose exactly one `createNativeIntelligenceService` instance with `selectedSpaceIntelligence`, the current Identity port and Space-selection port;
2. transport calls through a bounded private host IPC using the existing WebKit host↔JS mechanism and per-request nonce/correlation;
3. keep the socket/IPC private and fail closed when the Surface/service runtime is unavailable;
4. do not advertise `intelligence.respond` in Platform/Product until the device-local bridge is proven;
5. define cancellation/unknown-outcome behavior before allowing retries;
6. connect the Runtime/Product transport to this device-local bridge using the existing Relay/grant/queue/idempotency/audit owners;
7. run credentialed E2E and only then compose the Web remote adapter as available.

The target remains one Intelligence owner, one model router and one Memory owner throughout the path.
