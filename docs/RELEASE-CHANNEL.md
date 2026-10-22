# Release Channel

Status: CANONICAL FOR PROTOTYPE

## Goal

This channel is the delivery authority for the **Stable/MVP** distribution. Owner/Development may continue to use the Git-first path, but that mechanism is internal and is not the end-user update contract. The machine-readable separation lives in `docs/contracts/distribution-profiles.json`.

`main` remains source authority, while an OrdaX device consumes prebuilt immutable releases without needing a compiler, source checkout, Codex or a full Git client in the pre-release bootstrap.

Repository CI owns build/sign/publication. The device consumes a compact signed release envelope and immutable artifacts over HTTPS.

## Dual transport rollout: Development + public OrdaX (2026-10-22)

**Decision:** retain the existing Supervisor as the sole runtime transaction,
health, known-good and rollback owner. Delivery *methods* are not alternative
update engines. Their canonical selection policy is
`docs/contracts/distribution-profiles.json#update_delivery_selection`.
The side-effect-free resolver at
`system/services/update/transport-selection.mjs` provides a fail-closed
routing boundary for clients; it is not yet wired to the live Supervisor.

| Profile | Current enabled method | Future gated alternative |
| --- | --- | --- |
| Owner/Development USB | `git-main` via the existing `ordax-pull` | `official-signed-release-channel`, for real tests of signed releases on Development hardware |
| Public Stable/MVP USB | `official-signed-release-channel` (signed and exact-commit) | `signed-exact-git`, Git object acquisition pinned to a *previously authenticated* official release; **never** unreviewed `main` |

A public Git option is **not** an authorization to run Development's
`ordax-pull` verbatim on consumer devices. It must validate the signed
release envelope first, bind the exact candidate commit, acquire only objects
for that immutable source identity and pass through the existing signed
candidate / health / rollback owners. Consumers must never need a Git client
to boot or update through the standard channel.

### Effective transport status (increment 2)

The current Supervisor emits `updateTransport` in the existing native
`ordax.update-status/1` snapshot, using the *actual validated runtime
distribution profile*: `git-main` for Development, or
`official-signed-release-channel` for Stable. The shared validator treats
the missing field from an older image as `unavailable`; unknown methods
fail validation. System → Updates displays this as a read-only localized fact
and omits it for older snapshots. This does not switch transport, approve an
update, sign a release or change Base/ESP/boot behavior.

### Incremental delivery / acceptance gates

1. **Policy and tests (current PR):** express enabled and gated routes in the
   distribution SSOT, ship a pure, fail-closed resolver and regression tests.
   Neither a UI toggle nor runtime transport switch is enabled in this stage.
2. **Development signed-release testing:** add a verified-release handoff to
   the same Supervisor transaction owner. Prove signed envelope, exact
   source commit, non-destructive staging, health and offline rollback in
   disposable fixtures. Enable an explicit signed-release Dev selection only
   after this evidence, without breaking Git-first default.
3. **Public signed-Git acquisition:** design optional Git object fetch around
   the *signed* immutable release source identity; maintain the existing
   signed-release fallback only on an explicit new transaction, never silently
   after trust failure. No operational Git prerequisite for public boot.
4. **User consent and notifications:** use the shared Surface and native
   update-status owner. Public default: notify before download/install;
   allow defer/download preference and require notice before reboot. Security
   and release authenticity cannot be overridden by UI choice. Development
   default remains fast Git-first.
5. **Mode switching and migration:** persist a validated device preference
   outside immutable releases; switch only while no update transaction is
   active, with no base-slot/EFI writes. Support disabling public Git and
   removing it after a separately validated signed-release migration. Always
   preserve userdata, local offline known-good boot and existing A/B gates.
6. **Promotion:** run unit, integration, release signing, interruption, health,
   rollback and QEMU tests; then separately prove USB Dev and Stable physical
   recovery. A CI green check does not authorize Creator writes or public
   release promotion.

**No fake feature:** the current stage does **not** make either gated method
operational, does not enable public Git polling and does not replace the
canonical Base update mechanism. Defaults and operational paths are unchanged.

## Owner/Development signed-v4 opt-in preview (non-activating)

`system/services/update/owner-signed-preview.sh` is a **manual test entry
point**, not a second update engine, firmware writer or a public update route.
It calls the existing `bootstrap/release-acquisition` agent and pinned trust
anchor to inspect a signed channel and optionally materialize/verify an **exact
v4** candidate in an explicit isolated test directory.

For a Dev checkout with an already provisioned, provenance-verified release
agent (the script refuses to build or fetch an absent agent automatically):

```sh
ORDAX_DISTRIBUTION_PROFILE=owner-development \
  sh system/services/update/owner-signed-preview.sh inspect

# Explicit, isolated testing only: never use /ordax, /workspace/ordax,
# the active /state tree or any production/current release root.
mkdir -p /mnt/disposable/owner-signed-preview
ORDAX_DISTRIBUTION_PROFILE=owner-development \
ORDAX_OWNER_SIGNED_STAGE_ROOT=/mnt/disposable/owner-signed-preview \
  sh system/services/update/owner-signed-preview.sh stage <exact-signed-40hex-sha>
```

### Native portable activation inspection (read-only; no new update owner)

The canonical `ordax-portable-state inspect <state-root> <portable-root>`
command returns `ordax.portable-state-inspection/1` JSON with exact validated
`current`, `knownGood`, optional `candidate` and `rejected` identities,
plus a read-only phase: `idle`, `armed`, `orphan-advisory`, or
`commit-interrupted`. `attempt` is `0` or `1` only for an armed
transaction; otherwise it is `null`.

This is an **observation**, not a new authority: the native helper checks the
shape of materialized release directories and durable activation state.
It does **not** verify Ed25519 signatures or authorize the Dev USB to boot a
release. The canonical Go release agent must authenticate each exact
candidate; `prepare`, `select-boot` and Supervisor cold-health ownership
remain separate. Inconsistent or malformed state fails closed (exit 4),
without rewriting, cleaning or repairing any on-disk slot. This provides a
reusable diagnostic gate for future Dev boot-profile handoff while keeping
Git-first the only active Dev method.

### Owner signed portable state audit (disposable only; no boot switch)

The existing \`owner-signed-preview.sh\` now supports \`audit-state <exact-40hex-sha>\`
for a **previously staged** v4 release and a separately provisioned **disposable**
persistent-state fixture. It combines two existing and distinct authorities:
the canonical Go release agent performs \`verify-portable-v4-exact\` with the
pinned trust anchor and expected commit, then the existing native
\`ordax-portable-state inspect\` observes the fixture without writing.

\`\`\`sh
# Both directories must already exist, be canonical, distinct and isolated.
# State must be a dedicated owner-signed-state directory, never /state.
ORDAX_DISTRIBUTION_PROFILE=owner-development \
ORDAX_OWNER_SIGNED_STAGE_ROOT=/mnt/disposable/owner-signed-preview \
ORDAX_OWNER_SIGNED_STATE_ROOT=/mnt/disposable/owner-signed-state \
ORDAX_OWNER_SIGNED_STATE_HELPER=/mnt/disposable/ordax-portable-state \
  sh system/services/update/owner-signed-preview.sh audit-state <signed-40hex-sha>
\`\`\`

The native helper must be the real compiled \`bootstrap/initramfs/portable_state.c\`,
not a replacement verifier. Signature or SHA mismatch prevents native
inspection. Corrupt or inconsistent state is rejected by the native reader.
The audit only signs off on **candidate authenticity and observed fixture
shape**; it does not authenticate every historical slot through its JSON,
prove the Owner Git boot can enter Portable, arm or commit a transaction,
modify a live USB, start a VM, or authorize Stable release promotion. The
active Dev transport remains Git-first, with no runtime method selector.
This auditable boundary precedes a distinct disposable mixed-profile
QEMU boot and Supervisor cold-health/rollback proof.

### Native one-shot state handoff proof (development CI, no physical activation)

The real Go release-agent integration test at
`bootstrap/release-acquisition/owner_dev_portable_handoff_test.go`
exercises the **existing** `system/services/update/owner-signed-preview.sh`
and native `bootstrap/initramfs/portable_state.c` together in disposable
Linux directories. Two v4 envelopes are signed by the **same temporary
Ed25519 key** under CI; the real agent materializes and verifies their
exact artifacts in the preview staging root.

The native `ordax-portable-state` binary then proves two distinct outcomes
with isolated activation records (never the physical USB):

- **Unhealthy candidate:** `prepare` -> first `select-boot` (candidate)
  -> second `select-boot` (known-good), rejected SHA persisted, activation
  transaction removed, same rejected SHA cannot be armed again.
- **Healthy candidate:** `prepare` -> first `select-boot` -> no change
  to `current` until explicit `commit`; then `current` advances while
  `known-good` stays pinned for recovery.

The preflight itself must create **no** activation records and preserve the
live Dev Git checkout. This validates the *native state machine and signed
acquisition compatibility*, not a candidate running in an actual boot.
It does not add another writer or updater, allow users to select a new method,
promote public keys, or imply physical SSD/USB authorization. The remaining
gate is safe boot-profile handoff and Supervisor cold-health ownership with
real signed USB candidates, validated first on disposable QEMU media.

### Signed v4 bundle tests without a published HTTPS release

Until the official channel publishes the exact signed v4 release, Dev can use
the **same** acquisition agent with a previously obtained signed offline
bundle. This is not a second signing authority, update engine or downgrade:
the bundle must contain `release-envelope.json` and all artifacts named in
the signed manifest, and the Ed25519 key must match the pinned local trust.

```sh
# An explicit trusted offline source, independent of the online channel:
ORDAX_DISTRIBUTION_PROFILE=owner-development \
ORDAX_OWNER_SIGNED_BUNDLE_DIR=/mnt/disposable/signed-v4-input \
  sh system/services/update/owner-signed-preview.sh inspect-offline

# Staging output is isolated and disjoint from the signed input.
mkdir -p /mnt/disposable/owner-signed-preview
ORDAX_DISTRIBUTION_PROFILE=owner-development \
ORDAX_OWNER_SIGNED_BUNDLE_DIR=/mnt/disposable/signed-v4-input \
ORDAX_OWNER_SIGNED_STAGE_ROOT=/mnt/disposable/owner-signed-preview \
  sh system/services/update/owner-signed-preview.sh stage-offline <exact-signed-40hex-sha>
```

The established agent `verify-envelope` handles offline inspection. Offline
stage uses `materialize-portable-v4 --local-bundle` and then the *same*
`verify-portable-v4-exact` call as HTTPS staging. No HTTP fallback is allowed
when a local signature, artifact or commit check fails. Simultaneously
specifying online and offline delivery is rejected. There are no changes to
`current`, boot slots, Git checkout or the Supervisor's active transport.
Unverified local test keys must never authorize public/physical releases.

The inspect operation obtains only a signed release envelope. The stage
operation requires the exact expected commit, delegates all Ed25519 and
artifact-size/hash checks to the canonical Go agent, then invokes
`verify-portable-v4-exact` against the *same* isolated root. The wrapper
never calls `install`, `activate-exact`, `prepare`, `commit`, changes the
working Git tree, or touches boot slots. A failed materialize does not fall
back to Git or call the verifier. Offline staging, device activation, mode
selection and signed-agent provisioning remain separate blocked gates.
An absent agent must yield a visible error, not an implied successful test.

Acceptance still requires the canonical Supervisor to own any future
commit/health/rollback transaction and the selected delivery transport to
remain pinned for the whole transaction. In particular, **this preview is
not evidence that signed-release mode is operational on the Dev USB** and
must not flip `owner_signed_release_transport_implemented` in the SSOT.

## Source vs delivery

```text
GitHub main
 -> CI build graph
 -> exact source commit
 -> immutable release artifacts
 -> signed release envelope
 -> HTTPS publication
 -> OrdaX release acquisition agent
 -> signature/hash verification
 -> /ordax/releases/<commit>
 -> /ordax/current
```

Git owns what OrdaX is. Delivery only selects bytes for a particular source commit.

## Canonical bootstrap selector

The prototype seed now pins this source-controlled channel file:

```text
bootstrap/config/release-envelope-url
```

with exactly:

```text
https://github.com/ordaxsystems/ordax-os/releases/latest/download/release-envelope.json
```

GitHub documents `/releases/latest/download/<asset>` as a direct download form for an asset on the latest Release. The `latest` pointer is intentionally mutable as a **selector**, while the release identity and authenticated payload remain immutable after verification.

Runtime path:

```text
/ordax/bootstrap/config/release-envelope-url
```

The exact file bytes are SHA-256 bound in `docs/contracts/minimal-bootstrap.json`.

## Security model

HTTPS is mandatory transport but not the authenticity authority.

The device must carry a local Ed25519 public trust anchor at:

```text
/ordax/bootstrap/trust/release-ed25519.json
```

Expected schema:

```json
{
  "$schema": "prototype-ordax.release-trust/1",
  "key_id": "ordax-prototype-release-v1",
  "public_key_base64": "<32-byte Ed25519 public key>"
}
```

The corresponding private key must never be committed to Git, embedded in Creator/USB media, bundled in Desktop, or published as an artifact.

Current state:

```text
RELEASE_CHANNEL=RESOLVED
RELEASE_TRUST=PASS_CANONICAL_PUBLIC_ANCHOR_PINNED
PRIVATE_SIGNING_KEY_CUSTODY=CONTROLLED_PROTOTYPE_EXTERNAL_TO_REPOSITORY
CRYPTOGRAPHIC_RECOVERY_VERIFIED=YES
PHYSICAL_WRITE_ALLOWED=NO
```

The canonical trust gate is satisfied only by the pinned public anchor whose matching external private key passed the recorded recovery/signing proof. Placeholder or CI-ephemeral keys remain forbidden from satisfying this gate.

## Signed envelope

The release endpoint serves:

```json
{
  "$schema": "prototype-ordax.release-envelope/1",
  "payload": "<base64 exact manifest bytes>",
  "signature": "<base64 Ed25519 signature over exact payload bytes>",
  "key_id": "ordax-prototype-release-v1"
}
```

The signature is over the decoded payload bytes exactly as carried. No custom canonical-JSON signing algorithm is used.

## Signed manifest

Decoded payload schema:

```json
{
  "$schema": "prototype-ordax.release-manifest/1",
  "source_repository": "ordaxsystems/ordax-os",
  "source_commit": "<lowercase 40-hex>",
  "release_id": "<same source commit>",
  "created_from_ci_recipe": "release/native/1",
  "artifacts": [
    {
      "name": "system.tar",
      "role": "system",
      "url": "https://...",
      "sha256": "<lowercase 64-hex>",
      "size": 123
    }
  ]
}
```

The release agent rejects unknown fields, unsafe names, non-HTTPS artifact URLs, malformed commits/hashes, duplicate artifact names, repository mismatch, key-id mismatch, signature failure, size mismatch and SHA-256 mismatch.

## Release identity

Each prototype release is tied to exactly one lowercase 40-hex source commit and uses that commit as both `release_id` and directory identity:

```text
/ordax/releases/<source_commit>
```

Reusing the same release identity for different bytes is forbidden.

## Transactional materialization

```text
fetch signed envelope
 -> verify signature + manifest policy
 -> create /ordax/releases/.staging-<commit>-*
 -> download artifacts
 -> verify exact size + SHA-256
 -> fsync files/staging
 -> store exact signed manifest payload
 -> rename staging -> releases/<commit>
 -> fsync releases
 -> stop here for A/B materialize mode
 -> atomically replace current symlink only for install mode
 -> fsync /ordax
```

`current` changes only after every candidate byte has passed authentication and integrity checks, and only when the caller explicitly uses the bootstrap `install` mode.

The A/B base-update owner uses `materialize --expected-commit <checkout>`. That mode requires the signed source commit to match the running checkout exactly and ends after immutable release materialization; it must not change `/ordax/current`. The exact verified release envelope is persisted as `release-envelope.json` beside the signed payload in `release-manifest.json`. An existing release may be reused only when envelope, signed payload, artifact and extracted tree still match; divergence fails closed. The persisted envelope is the only envelope the later A/B staging owner may consume, so staging never needs a second network fetch of signing authority.

## Failure/offline behavior

```text
network unavailable before first release -> recovery
release endpoint unavailable before first release -> recovery
signature invalid -> reject candidate + recovery/current preserved
artifact invalid -> reject candidate + recovery/current preserved
known-good current exists -> boot it without requiring network
```

After the first verified release, network is an update dependency rather than a normal boot dependency.

## Publication target

GitHub Releases is the current prototype host. The protocol remains host-neutral because signed manifests carry ordinary HTTPS artifact URLs.

The next source-side step is to implement repository-owned signing/publication that:

- reads private signing material only from an external CI secret or similarly protected signer;
- derives/validates the corresponding public key identity;
- signs exact manifest bytes with standard Ed25519;
- publishes immutable assets for the exact source commit;
- publishes `release-envelope.json` under the GitHub Release;
- refuses publication when provenance, hashes, source commit or signing material are incomplete.

Publication must not be enabled by committing a private key.

## Product modes

```text
Web       -> deployment refresh from shared source commit
Desktop   -> signed desktop application update
USB       -> signed OrdaX release acquisition/activation
Native    -> signed OrdaX release acquisition/activation
```

The Desktop application updater is a separate trust/update concern and must not silently mutate removable media.

## Codex independence

```text
CODEX_REQUIRED_FOR_BUILD=NO
CODEX_REQUIRED_FOR_PUBLICATION=NO
CODEX_REQUIRED_FOR_DEVICE_UPDATE=NO
```

A running device consumes the release protocol, not an AI-specific transport.

## Promotion boundary

The acquisition agent, channel and generated artifacts remain candidates until signed publication, disposable acquisition/activation, virtual/physical boot, rollback and offline-known-good gates pass.

```text
PHYSICAL_ARTIFACT_AUTHORIZED=NO
```


## Stable runtime polling

The Stable/MVP runtime reuses the shared `system/supervisor`, but it does not poll Git.

The Stable profile has two explicit runtime layouts. The legacy-tree path keeps its existing exact activation transaction. The MVP Portable path is now **release-manifest/4** and never creates the legacy `/ordax/current` symlink:

```text
official HTTPS channel
 -> ordax-release-agent inspect
 -> verify signed envelope + trust + exact source_commit + manifest_schema
 -> ordax-release-agent materialize-portable-v4 --expected-commit
 -> ordax-release-agent verify-portable-v4-exact
 -> immutable .ordax/releases/<commit>
 -> content-addressed Surface runtime + Local AI runtime
 -> ordax-portable-state prepare
 -> reboot
 -> initramfs ordax-portable-state select-boot
 -> one candidate boot only
 -> Stable Surface cold-health
 -> commit current/known-good OR persist rejected + rollback
```

The supervisor selects the materializer/verifier from the **signed inspected manifest schema**. A pre-v4 current boot may still consume a valid v3 release during the compatibility window and may upgrade to v4. Once the running verified boot is v4, a remote v3 manifest is rejected as a schema downgrade; the channel must advance with v4. This preserves published v3 semantics without letting the public selector silently remove the Local AI artifact from a v4 installation.

`materialize-portable-v3/v4` and their exact verifiers remain **non-activating primitives**. Activation authority is the ext4 Portable state transaction plus the shared supervisor health policy. No Git is required for activation or rollback. The v4 disposable QEMU/UEFI path is proven in CI; physical Stable/MVP cold-health and rollback evidence remain separate later gates.
