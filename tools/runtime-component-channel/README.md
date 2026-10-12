# OrdaX Runtime Component Channel

This tool owns the host-neutral signed boundary used to stage independently packaged OrdaX runtime components.

It is deliberately separate from the whole-OS release trust domain. Runtime component trust uses:

```text
prototype-ordax.runtime-component-trust/1
prototype-ordax.runtime-component-release/1
prototype-ordax.runtime-component-envelope/1
```

The package payload remains `prototype-ordax.runtime-component-package/1`.

## Security boundary

- Ed25519 and PKCS#8 use only the Go standard library.
- Private keys must live outside the repository and are never printed or packaged.
- CI may generate an ephemeral key only to prove the protocol.
- A signed envelope does not activate a component directly.
- Staging verifies the envelope, package SHA-256/size, embedded package-manifest digest, component identity/version/source commit, ZIP entry safety and every packaged file hash.
- Slots are materialized as read-only immutable directories.
- Staging does not change the active component, Component Manager state, or the Surface.
- Promotion remains blocked until the Native runtime can load a pending slot, observe runtime health, and atomically promote `current/previous`.
- Uninstall is an explicit activation-state transition. It requires the exact current identity and revision, rejects a pending candidate, re-verifies the signed current slot, then removes all installed activation references. The same atomic `activation-state.json` now records `user_removed:true`; a later source lookup must not reactivate a bundled fallback. The marker survives reboot/refresh and stays set through a pending reinstall, clearing only after verified health and promotion. This is an owner state, **not** a Store preference or an independent inventory.
- Uninstall never deletes App Data, documents, Memory, Projects or other user state. User-data deletion is a separate product action owned by the relevant data owner.
- An immutable verified slot may remain as a local package cache after uninstall. Cache garbage collection is separate from installation state and must never make an app appear installed.
- When an externally sourced component such as `notes` or `studio` has no current activation, resolution reports it as absent. Only platform-owned components may resolve `current=nil` as a real bundled fallback.

## Commands

```text
ordax-runtime-component-channel generate-key \
  --private-key <external>/runtime-component-private.pem \
  --trust <review>/runtime-component-trust.json \
  --key-id runtime-components-prototype-1

ordax-runtime-component-channel derive-trust \
  --private-key <external>/runtime-component-private.pem \
  --out <review>/runtime-component-trust.json \
  --key-id runtime-components-prototype-1

ordax-runtime-component-channel sign \
  --release runtime-component-release.json \
  --private-key <external>/runtime-component-private.pem \
  --trust runtime-component-trust.json \
  --key-id runtime-components-prototype-1 \
  --out runtime-component-envelope.json

ordax-runtime-component-channel verify-envelope \
  --envelope runtime-component-envelope.json \
  --trust runtime-component-trust.json

ordax-runtime-component-channel stage \
  --envelope runtime-component-envelope.json \
  --trust runtime-component-trust.json \
  --package internet.zip \
  --root /var/lib/ordax/components
```

The canonical component trust anchor is still unresolved until the explicit operator ceremony in `docs/COMPONENT-TRUST-CEREMONY.md` completes. The machine-readable policy is `docs/contracts/runtime-component-trust-policy.json`.

The fixed first key id is `ordax-runtime-components-v1`. Only the reviewed public anchor may eventually be pinned at `system/trust/runtime-components-ed25519.json`; the matching private key stays outside Git and outside the device.

Do not reuse or silently alias the whole-OS release key as component trust. Public-anchor pinning alone does not authorize publication or production activation.


## Signed release/2 compatibility inspection (read-only)

A staged immutable release/2 slot now exposes its **actual signature-bound** compatibility
descriptor through the **same** runtime component channel:

```text
ordax-runtime-component-channel inspect-slot-compatibility-v2 \
  --slot <verified-slot-directory> \
  --trust <reviewed-public-trust-file>
```

The output schema is `ordax.verified-slot-compatibility/1`, containing the exact
`componentId`, version, source commit and `ordax.component-compatibility/1` descriptor
whose bytes are bound by SHA-256 to the signed release. The `trustSHA256` field fingerprints the **caller-supplied trust file**, allowing diagnostic consumers to reject mixed anchors; it is not proof that this anchor is the canonical system key. The JavaScript `preflightServiceUpgradeInspections` only validates read-only report shape, requires the same trust file fingerprint across candidate/current/active reports, and delegates compatibility to the existing evaluator. Raw JSON from an untrusted caller can be forged and **must never authorize activation**. This command **reuses**
`verifySlotV2WithTrustBytes` and `validateCompatibilityBytes`, checking the signed
envelope and every slot file. It does not maintain its own parser, app allowlist
or installed-state database.

**Security boundary:** `trustScope: caller-supplied-public-anchor` is deliberately
not equivalent to a production-pinned anchor. `authority: none` and
`activationStatus: not-evaluated` mean the result does **not** activate,
promote, grant, mark health, or assert that the inspected slot is current or
pending. A trusted Native owner must select the exact slot from the canonical
activation state, pin trust from the OrdaX OS trust policy, and bind the
report to the same active revision before using its descriptor with
`preflightServiceUpgrade`. The compatibility evaluator is source-only:
it cannot verify Ed25519 or decide state authority by reading its JSON input.

### Canonical activation-state readback (no second SSOT)

The same binary can inspect **the exact current or pending signed slot referenced
by** the existing `activation-state.json`, without mutating that file:

```text
ordax-runtime-component-channel inspect-activation-compatibility-v2 \
  --root <canonical-component-root> \
  --component <component-id> \
  --target current \
  --expected-revision <activation-state-revision> \
  --trust <public-component-trust-file>
```

This returns `ordax.activation-slot-compatibility-snapshot/1`: it binds
the selected `current` or `pending` identity, component ID, revision,
health status and signature-verified release/2 compatibility descriptor.
It reads the canonical activation state again after verifying the signed slot
and rejects a changed state. Missing, removed, stale, or malformed state
fails closed; stage-only slots cannot masquerade as installed.

The JavaScript `preflightServiceUpgradeWithActivationSnapshots` checks a
**current** snapshot, a separately signature-verified **staged (unarmed)**
candidate, active consumer snapshots, and the expected activation revision,
then delegates to the existing `evaluateComponentUpgrade` logic. This is
**diagnostic and not the transactional activation gate**: even a verified
snapshot becomes stale after a later state change, and an untrusted caller
may forge JSON. The Native owner must supply these reports from trusted
verification, use the system-pinned trust key and revalidate the precise
revision/identity under the existing mutation lock before `arm-pending`.
Do not send a "compatible" diagnostic as an activation grant or edit the
activation state from JavaScript.

### Activation writer integrity and revision CAS

The original `arm-pending` writer now performs its **final full signature and
slot identity verification while holding the existing activation lock**,
immediately before updating `activation-state.json`. Its earlier verification
is only used to identify the canonical component/slot. This closes the
unlocked verify-to-write interval without another writer, lock, database,
or new signing authority.

Trusted Native orchestration may pass `--expected-revision <N>` (including
`0` for an uninstalled first revision) to prevent arming a candidate based
on a stale `current` state. The original optionless command remains available
for existing development callers and backward-compatible tests; it **does not**
prove semantic compatibility. Revision checks do not substitute for the
complete active-consumer contract evaluation.

These guards were tested for first installation, stale revision, exact
revision accepted, attempted concurrent writer lock, and rejection of
different pending identities. The activation and health/promotion/rollback
state machine and release/1 format were not replaced.

### Rollback and persistent state compatibility

The same original `rollback-state` writer now checks the **signed
compatibility descriptors of the current and previous release/2 slots**
inside the activation-state mutation lock, before replacing `current`.
Restoring older code is denied if its declared readable state-version
range excludes the current release's write version or its state owner
has changed. A stateful release/2 without a previous signed version
cannot silently downgrade to an undocumented bundled state format.

An unchanged stateless release/2 rollback remains supported. Release/1 to
release/1 behavior is preserved without inventing a compatibility sidecar
for that legacy format; cross-schema rollback without explicit evidence
is refused. The guard does not modify stored data, invent a migration
implementation, or certify that an application truly migrates data
correctly: actual storage copy-on-write and end-to-end recovery are
still required before public component-slot updates are enabled.

**Remaining blocker:** `arm-pending` does not yet consume a verified
compatibility verdict across all active consumers. A correct fail-closed
integration must run before any activation-state mutation and invalidate
stale current/revision snapshots; until then, production component activation
remains disabled. The existing release/1 compatibility semantics are unchanged.

## Read-only Native slot exposure

The Native Surface host may expose verified slot bytes only through the runtime-component verifier.

The bounded read allowlist is intentionally explicit:

- `internet`
- `notes`
- `studio`

For externally sourced first-party apps such as Notes and Studio, `current` with no activation resolves as `ABSENT`; it is not treated as a bundled fallback.

Expanding the read allowlist does not expand mutation authority. The Native pending-health mutation path keeps its own narrower allowlist and must not inherit read permissions automatically.

This boundary is what allows trusted composition code to read package-owned metadata such as `system/apps/<app-id>/ai/manifest.json` from an exact verified slot identity without introducing generic filesystem access.
