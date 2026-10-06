# Native OrdaX Capability Adapter

Native implementation of OrdaX capability contracts for USB and SSD/HD modes.

This adapter bridges shared product code to OrdaX services and hardware-facing capabilities. It does not own duplicated screens, visual tokens or app forks.

Kernel/driver-specific details stay below the capability boundary and must not leak into shared Surface components.

## Shared bounded JSON transport

`bounded-json-transport.mjs` owns the reusable browser-to-Native HTTP mechanics used by typed Native state adapters. It exists so each capability does not reimplement timeout, abort, byte-bounded streaming, UTF-8/JSON decoding and same-origin request policy.

The transport is intentionally infrastructure-only:

- endpoints must remain under the same-origin `/__ordax/native/` boundary;
- protocol-relative, external, fragment-bearing and non-Native paths are rejected;
- requests use `cache: "no-store"` and `credentials: "same-origin"`;
- only bounded serialized request bodies are accepted;
- responses are read as bounded streams before fatal UTF-8 decoding and JSON parsing;
- GET/POST are the only methods exposed by this state-transport primitive;
- timeout uses `AbortController` and a finite validated duration.

Domain adapters continue to own their schemas, partition identity, CAS semantics and response validation. Personal OrdaX and Automation therefore share transport mechanics without sharing or merging their persisted state. Future Work Coordination Native state must reuse this transport rather than introduce a third copy.

This helper does not create a host route, storage owner, permission or remote egress capability by itself.

## Diagnostic export

`diagnostic-export.mjs` implements the narrow `ordax.diagnostic-export/1` port on top of the existing bounded Native `file-space` capability. It writes only an already validated diagnostic JSON document into the logical `/Downloads` user directory through `importFile()`.

The adapter deliberately does not use an anchor/download handoff as proof of persistence. It returns `saved` only after the Native file-space port returns a listing that confirms the same destination directory, file name, regular-file kind and UTF-8 byte size. Host write failures, duplicate/no-clobber rejection or an inconsistent confirmation are allowed to fail upward so the shared diagnostic export service can return the stable non-secret `export-failed` result.

The adapter does not create a new host endpoint, bypass the user-space root, overwrite existing files or introduce remote transport. Surface wiring and the explicit user action that invokes this port remain separate responsibilities.

## Native installation capability

The product capability `creator.native-install` belongs only to the OrdaX USB mode for the MVP. Declaring the capability in the product contract does not mean that destructive host support is already implemented.

The adapter must eventually provide a narrow, read-only target-discovery boundary to the shared Creator Core:

```text
native host block-device metadata
 -> stable target identity
 -> source-boot-media classification
 -> Creator Core confirmation fingerprint
 -> exact target-bound install plan
```

The shared Surface must never receive raw block-device handles or arbitrary command execution. Until the adapter can enumerate and revalidate the exact target and the apply gate is authorized, the installation action remains unavailable/fail-closed.

### Read-only installer target port

`system/adapters/native/native-install-targets.mjs` implements the neutral `ordax.native-install-targets-port/1` contract only when the host session reports `productMode=usb` and the private signed-helper broker is available.

The Surface receives model, transport, capacity, safety flags and the opaque confirmation fingerprint only. Stable device IDs, WWIDs, serial numbers, raw block-device paths and source-boot paths remain below the adapter boundary.

This port has no write/apply method. Its presence is not proof that Native installation APPLY is implemented or authorized.
