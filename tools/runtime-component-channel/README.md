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

### Forward-only candidate ordering

The existing `arm-pending` activation writer now compares the *signed*
candidate version against the exact `current` version **while holding the
same canonical activation-state lock**. Equal, older, and lower-precedence
prerelease candidates are rejected without any state mutation, whether or
not the caller supplies `--expected-revision`. There is no separate
downgrade route: recovery must use the explicit, state-safe rollback writer.
The Native Go comparison follows the semantic-version precedence of the
canonical JavaScript component-manifest contract, including numeric
prerelease identifiers and large numeric version components; test fixtures
verify both sides of the ordering.

This is an additional necessary guard, **not** an activation grant or a
replacement for signed active-consumer compatibility and pinned production
trust. `arm-pending` is still not enabled for public independent updates.

### Signed current consumer continuity on uninstall and rollback

Under the existing activation graph and component locks, `uninstall-current`
and `rollback-state` of a release/2 current slot inspect **all native signed
current release/2 peers**, using the same readout function as the canonical
active-slot catalog. For every mandatory contract requirement presently
satisfied by the outgoing provider, the writer proves that the replacement
slot or an alternate installed signed provider still offers a matching
contract ID and major range. If not, the change is rejected **before**
modifying `activation-state.json`. Optional requirements never block.
The scanner rejects corrupt current state, unknown release schemas, unsafe
root entries and unverified peer signatures rather than silently omitting
the affected consumer. A signed release/2 rollback destination is inspected
with its exact prior identity and supplied public trust.

This is a **real safety gate for the installed Native signed subset**, but
not a global permission to uninstall/rollback arbitrary OrdaX OS bundled
services: bundled consumers, production trust pinning, legacy release/1
consumers and external filesystem writers are not fully represented. The
release/1-to-release/1 development behavior is unchanged; that does not
confer production safety. The scanner shares the original graph lock,
source signatures and state SSOT; no shadow installed-app database.

### Compatibility must survive pending health and promotion

`arm-pending` checks signed state, provided interfaces, required provider
contracts and forward-only version ordering. A passing preflight at that
earlier step **cannot** be reused as an authorization to promote after
probation. `promote-state` now re-runs the *same signed release/2
local-compatibility validator* and forward-only version comparison between
the actual current and pending identities while holding the canonical
activation graph and component lock, immediately before switching current.
If either signed identity, current state owner or contract has changed, it
refuses to promote without changing revision, current or pending. Healthy
status alone is not a compatibility receipt.

This closes a local time-of-check/time-of-use gap for official Native
activation state, but does **not** verify bundled consumers, externally
modified filesystem state or a production-pinned trust anchor. The global
provider/consumer graph and verified recovery remain release blockers.

### Verificação Native do grafo na atualização para frente

Para um upgrade **release/2 → release/2** com `current` já instalado, o
writer `arm-pending` e a promoção `promote-state` consultam novamente todos
os **consumidores Native ativos e assinados** sob o bloqueio de grafo
canônico. A verificação usa a mesma função de continuidade de interfaces
aplicada à desinstalação e ao rollback, sem segundo catálogo e sem aceitar
um relatório de preflight como autorização. Um estado de outro componente
corrompido, uma assinatura inválida ou um consumidor sem leitura confiável
interrompe a operação **antes** de alterar a revisão ou o slot ativo.

A prova inclui regressões de corrupção antes de armar e depois da saúde
positiva, além de uma promoção legítima preservando um consumidor assinado.
A cobertura **continua incompleta para serviços `bundled`, releases/1,
primeira instalação sem `current`, confiança de produção e migração de dados**.
Nenhuma dessas provas liga a publicação de atualizações individuais ao usuário.

### Signed state-local compatibility before pending activation

When a `current` signed slot exists, the original `arm-pending` writer
now checks **both signed state compatibility sidecars under its existing
activation-state lock**, before recording the candidate as pending.
Release/2 upgrades must also **retain every signed interface previously offered**
by the `current` descriptor, including its contract ID and major version,
because bundled consumers do not yet have complete independent evidence.
Adding new interface contracts is allowed, but replacing/removing existing
majors is denied until a full signed consumer-compatibility transaction can
authorize the change.

The same signed descriptor also provides a conservative floor for
`requires`: a candidate cannot add a **new mandatory provider**, turn an
optional provider into a required one, or narrow the permitted major-version
range of a previously mandatory provider while the actual provider graph
remains unattested. Removing mandatory requirements, widening their ranges,
or adding optional dependencies is allowed by this local guard, but is
**not** a claim that those providers are installed or that an upgrade is
production-ready. The test fixtures sign both the before and after
descriptors and verify state immutability for rejected candidates.

Release/2 upgrades with the same state owner and write version are allowed
when the candidate declares the current version readable; stateless
upgrades remain allowed. Introducing a **new persistent state owner**
is temporarily stricter than the source evaluator: it is refused until the
Native rollback path can prove recovery of the previous stateless release.
Removing the owner, changing its ID or write version, or crossing
release/1 and release/2 formats is **rejected before any mutation**.
No migration plan is accepted until the Native owner can actually prove
and execute a versioned data migration with last-known-good restoration.

This is only the **local state** portion of that contract. The writer
does not yet have a complete locked inventory of all bundled and active
consumers, or a production-pinned trust anchor. A signed package
passing this gate **cannot** be considered safe for public deployment.
Release/1-to-release/1 behavior remains unchanged in its legacy
development protocol.

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

### Coverage of the real active graph (read-only)

The same Native runtime component channel exposes:

```text
ordax-runtime-component-channel inspect-active-compatibility-catalog-v2 \
  --root <canonical-component-root> \
  --trust <public-component-trust-file>
```

This command derives its result **only** from existing per-component
`activation-state.json` files. Each current release/2 slot must pass
signature and exact identity verification. Staged-only releases, cached
signed versions and explicitly uninstalled apps are not counted as active.
The reader and **every activation-state mutation through the official Native
writer** now acquire the same bounded graph lock at the canonical component
root before reading or writing. Mutations retain their original
per-component lock, always acquired after the graph lock. Therefore the
reader sees one internally coherent set of signed current slots across
cooperating Native writers rather than a mix of two activation revisions.
It also checks the root and state records again before returning, and
rejects unsafe entries, concurrent owners, corrupt state or mismatched trust.
An interrupted lock requires explicit recovery; there is no automatic
lock-breaking bypass.

The `ordax.active-slot-compatibility-catalog/1` report is always labeled
`authority: none`, `scope: signed-independent-current-slots-only`
and `completeForActivation: false`. It does **not** represent all
bundled OS services, unsigned components, independent staging operations
or a durable authorization after the lock is released. It must therefore
**never** be used alone to approve an
upgrade or to bypass missing active-consumer compatibility information.
The only authority for installed state remains the activation writer.

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
