# Windows Desktop — signed Store catalog transport

The existing Surface reads GET /__ordax/native/store-catalog as
ordax.verified-app-store-catalog/1 with authority:none. The installed Windows
Native host owns this transport; there is no second Store service or application
catalog in the Desktop host.

## Windows Store lifecycle through the canonical Go owner

The installed Native host accepts POST /__ordax/native/store-lifecycle,
reusing the existing private `ordax.app-lifecycle-plan/2` contract. The browser
request is a proposal, not authority. Every operation requires exact loopback
origin, bounded application/json, an external first-party app from the generated
package policy, a locally reverified signed catalog and matching source commit,
sequence and digest under the same cross-process watermark lock.

### Install / update: signed candidate to pending-health only

The installed Native process can separately configure the optional
`ORDAX_DESKTOP_STORE_ARTIFACT_BASE_ORIGIN`. A missing or invalid origin
prevents install and update before any Go mutation. Only components in the
generated Native external probation scope currently qualify. No renderer or
request can select an origin, artifact URL, version or signature.

The Windows transport derives the four artifact URLs from the signed
`{name,sha256,size}` identities, using the same deterministic
`sha256/<2>/<64-digit-sha256>` layout as the Linux producer. It rejects
redirects, foreign final URLs, compression, wrong length and hash, and enforces
the existing 32 MiB per-artifact maximum. Cached artifacts are rehashed on
each read; per-digest files are atomically published without overwriting
another writer and without an additional inventory database.

Within the same watermark lock, Go `status` must match the expected current
revision and signed release identity. The **existing installed Go tool** then
runs `verify-envelope-v2`, `stage-v2`, `verify-slot-v2`,
`arm-pending --expected-revision` and another `status` readback. Native
responds `accepted` only after a durable `pending_health=unknown` generation
with exact component/version/source commit. This is **not** an installed healthy
app: the independent Supervisor retains health, promotion, rollback, cleanup
and activation authority. No automatic healthy verdict, direct activation,
App Data mutation or artifact purge is implemented by this transport.

### Remove: signed Go uninstall and durable tombstone

The existing watermark lock is held across the Go `uninstall-state` call;
the installed, public-trust-pinned Go tool validates the exact component,
version, source commit, expected revision and signed slot compatibility.
Its own graph/activation locks and safety policy refuse dependent consumers,
pending activations and stateful releases without quiescence proof. Only after
a canonical uninstall receipt **and** a separate Go `status` readback proving
the durable user-removed tombstone does Native respond with
`ordax.app-lifecycle-request-result/1 state=accepted`. Any failure returns
an unavailable response without exposing a simulated success, deleting App
Data or creating a second installed-state database. Native does not acquire
network bytes during removal. The installed verifier and public anchor remain
owned by Electron, not the checked-out OS or HTTP client.

These are **Windows transport and offline Go-contract regressions**, not
a production signed publication or a device-level install/remove E2E.
Production trust pinning and publication remain disabled by canonical policy;
tests inject Go verification fixtures only. The Store must remain unavailable
until the real signed producer, release handoff, health and activation gates
have independent, verifiable evidence.

- One public trust source: system/adapters/desktop/pinned-component-trust.mjs.
  It validates both current OS policy and the immutable public anchor shipped by
  the Electron installer; neither the HTTP client nor an ordax-pull checkout can
  change the trusted signer/verifier.
- The installed host can optionally acquire the fixed
  `catalog-envelope.json` over HTTPS from
  `ORDAX_DESKTOP_STORE_CATALOG_BASE_ORIGIN`, configured in the **Native
  process environment**, never in a Store request or Surface UI. With no
  configured origin, the existing offline signed-envelope flow is unchanged.
  No production origin is currently configured by this repository.
- The byte transport rejects redirects, non-200 responses, unexpected
  content encoding, wrong final URL, mismatched Content-Length, query, fragment,
  credentials, ambiguous path segments and envelopes over 4 MiB. Requests
  carry no credentials, cookies, version selection or trust anchor. Remote
  bytes are passed to the **existing installed** Go
  `runtime-component-channel verify-store-catalog` command; the host
  never implements Ed25519 signing or verification.
- The remote envelope is written to a private temporary file, cryptographically
  verified, and promoted atomically under the **same watermark lock** as local
  reads, with envelope before watermark. Failed transport, invalid signatures,
  replay and equivocation cannot overwrite the last-known-good envelope.
  An offline read still re-verifies that signed local envelope; network success
  never creates install, activation, health or rollback authority.
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
  authority is exposed by the **catalog GET** route. Strict loopback, GET,
  exact URL, no-store. The separate lifecycle POST delegates removal only
  to the canonical Go owner under the same persisted watermark lock.
- The canonical public anchor is **not pinned yet**; publication is explicitly
  disabled in docs/contracts/runtime-component-trust-policy.json. The current
  expected result is a schema-valid unavailable snapshot with empty entries.
  Ready candidates require operator ceremony and a separately authorized signed
  publication. This change does not promote the public Store or the USB.

Tests reuse the existing Windows verified-slot fixture and the established
Windows Desktop Dev CI instead of introducing a parallel signing pipeline.
The injected Go helper responses and publication gates in tests are **fixtures**,
not real signing keys or proof that production publication is enabled.
The Linux Native transport continues to use its existing HTTPS acquisition
owner; this Windows reader does not duplicate an installer or catalog authority.
