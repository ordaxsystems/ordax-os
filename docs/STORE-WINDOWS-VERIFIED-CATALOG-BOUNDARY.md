# Windows Desktop — signed Store catalog transport

The existing Surface consumes only GET /__ordax/native/store-catalog as
ordax.verified-app-store-catalog/1 with authority:none. The installed Windows
Native host owns this transport; there is no second Store service or application
catalog in the Desktop host.

- One public trust source: system/adapters/desktop/pinned-component-trust.mjs.
  It validates both current OS policy and the immutable public anchor shipped by
  the Electron installer; neither the HTTP client nor an ordax-pull checkout can
  change the trusted signer/verifier.
- The signed envelope, if externally published into the Electron-selected
  userData/Store/catalog-envelope.json, is verified by the *existing* installed
  Go runtime-component-channel verify-store-catalog command. The host never
  implements Ed25519 signing/verification and never downloads an unsigned feed.
- The Windows adapter owns only a local monotonic sequence/digest watermark,
  stored atomically under userData/Store. An exclusive cross-process lock
  directory serializes compare-and-replace for overlapping installed Native
  hosts; an existing lock (including interrupted ownership) fails closed and
  requires explicit recovery, never automatic HTTP-triggered deletion.
  Lower sequence, same sequence with
  different digest, malformed watermark, symlinked input, invalid helper output,
  missing policy and root revocation all fail closed. Each request revalidates
  the public trust before exposing the snapshot.
- No install, update, remove, execution, grant, activation or publication
  authority is exposed on the route. Strict loopback, GET, exact URL, no-store.
- The canonical public anchor is **not pinned yet**; publication is explicitly
  disabled in docs/contracts/runtime-component-trust-policy.json. The current
  expected result is a schema-valid unavailable snapshot with empty entries.
  Ready candidates require operator ceremony and a separately authorized signed
  publication. This change does not promote the public Store or the USB.

Tests reuse the existing Windows verified-slot fixture and the established
Windows Desktop Dev CI instead of introducing a parallel signing pipeline.
