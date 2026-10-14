# Native Intelligence service boundary — 2026-10-14

Status: **device-local host composition implemented in source; remote Runtime/Platform routing, credentialed E2E and physical Stable/USB proof remain pending**.

This work follows the merged Web remote adapter (`ordax-os#1765`), the merged Platform trusted Relay binding (`ordax-platform#153`) and the merged Native service boundary (`ordax-os#1767`). It connects the existing final Native Intelligence consumer port to the existing privileged WebKit host without creating a second Intelligence runtime, model router, Memory owner, provider stack or action authority.

## Ownership decision

Remote/system callers must never bypass the final Native Intelligence composition and call Local AI, `llama.cpp`, a provider, Memory or the model router directly.

The canonical Native consumer path remains:

```text
createIntelligenceRuntime(local AI + canonical model router)
  -> Application Intelligence awareness/context
  -> selected-Space Profile content context when available
  -> identity-bound Memory for the selected Space when available
  -> selectedSpaceIntelligence
  -> createNativeIntelligenceService(...)
  -> privileged Native host bridge
```

`selectedSpaceIntelligence` remains the only Intelligence port supplied to the Native service boundary. The new host bridge does not reconstruct any wrapper or own provider/model selection.

## Device-local host composition

`system/composition/native/intelligence-host-bridge.mjs` creates exactly one `createNativeIntelligenceService` instance from:

- final consumer `ordax.intelligence/1` port (`selectedSpaceIntelligence`);
- `ordax.identity-session/1`;
- `ordax.space-selection/1`.

The module registers one private Surface event (`ordax-native-intelligence-request`) and returns results through the already-existing privileged `ordaxBrowser` WebKit message handler.

The bridge announces `intelligence.host.ready` only after the service listener is installed. The Python host opens the local IPC socket only after receiving that readiness message, so a local caller cannot race the initial Native composition and reach a half-created Intelligence service.

## Private IPC transport

`system/surface/runtime/native_intelligence_ipc.py` is transport-only:

- Unix domain socket only: `/run/ordax-surface/intelligence.sock`;
- socket mode `0600`;
- bounded newline-delimited JSON (`1 MiB` maximum message, covering canonical UTF-8 worst-case payloads);
- exact IPC envelope fields;
- strict UTF-8/JSON decoding;
- request/response correlation through the service `requestId`;
- no TCP/HTTP listener;
- no provider, endpoint, credential, model-router, Local AI or Memory logic.

`ordax_browser_host.py` adds the minimum host glue required to:

1. accept one bounded local IPC request;
2. generate a separate opaque per-call host nonce;
3. dispatch the service request into the privileged Surface WebView with `run_javascript`;
4. accept only the correlated `intelligence.host.result` receipt from the existing `ordaxBrowser` bridge;
5. return the correlated service response to the Unix-socket caller.

The host does not validate or reinterpret Intelligence semantics. Canonical request/context/authority checks remain in the JavaScript service and `ordax.intelligence/1` contracts.

## Unknown-outcome rule

If dispatch, service execution or the host bridge fails after a request has been accepted, the transport returns:

```text
outcome = unknown
error = unavailable
```

It does **not** claim that model execution did or did not start and it does **not** mark the request retry-safe. Automatic retry must remain disabled until the existing Runtime/Product/Platform idempotency and receipt owners are composed end-to-end.

Internal provider/model error text is not sent through the host IPC.

## Context support

Supported semantics remain:

```text
signed-in identity + no selected Space
  -> context { subjectId, spaceId: null, projectId: null }

signed-in identity + selected Space
  -> context { subjectId, spaceId: selectedSpace.id, projectId: null }
```

Project-bound remote inference remains intentionally rejected. Native still has no canonical selected-project owner for this path. The system must not infer a project from UI text, recent files, Work state or model output.

The service re-reads Identity and Space after inference. A result is discarded when either changes while inference is pending.

## Security / ownership fences

The composed path:

- keeps one `ordax.intelligence/1` owner;
- keeps one `ordax.model-router/1` owner;
- keeps one `ordax.memory/1` owner;
- preserves `authority=none` and `toolExecution=false`;
- does not add provider credentials to Surface or Python;
- does not add provider/model selection to Surface or Python;
- does not add Memory reads/writes to Surface or Python;
- does not add grants, tools or action execution to this transport;
- does not expose a public network route;
- does not reuse Background Runtime as a hidden transport owner.

## Background Runtime remains separate

The existing `ordax.background-runtime/1` foundation still owns leases, budgets, checkpoints, cancellation and recovery for bounded background work. Its public autonomy rollout remains disabled. Native Intelligence host composition does not enable autonomous background execution and does not make Background Runtime the model transport.

## Proof boundary

This slice must be described precisely:

- **implemented in source:** Native service + privileged JS host bridge + private Unix IPC;
- **CI proof:** dedicated JS/Python contract tests plus the existing Foundation/Intelligence/Surface/Release/USB/QEMU gates;
- **not yet proven:** real Runtime/Product invocation through the socket;
- **not yet advertised:** Platform/Product `intelligence.respond` capability;
- **not yet proven:** credentialed remote E2E;
- **not yet proven:** physical Stable/USB hardware run.

QEMU/CI evidence must not be represented as physical USB proof.

## Next gates

1. prove this host composition in CI without weakening Foundation, Surface, Release, USB or QEMU gates;
2. bind the existing Runtime/Product transport to the private device-local socket without creating another relay, target resolver, grant system, queue, idempotency store or audit owner;
3. reuse Platform Relay target/device/grant/queue/idempotency/audit owners and enable the Intelligence operation only when the device executor is actually present;
4. propagate `unknown` outcome conservatively and forbid automatic replay without canonical receipt/idempotency proof;
5. run credentialed end-to-end remote inference;
6. only after that proof, advertise the remote capability and compose the Web remote adapter as available;
7. keep physical Stable/USB validation as a separate release gate.

The target remains one Intelligence owner, one model router and one Memory owner throughout the complete path.
