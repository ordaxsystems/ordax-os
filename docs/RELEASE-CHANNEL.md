# Release Channel

Status: CANONICAL FOR PROTOTYPE

## Goal

This channel is the delivery authority for the **Stable/MVP** distribution. Owner/Development may continue to use the Git-first path, but that mechanism is internal and is not the end-user update contract. The machine-readable separation lives in `docs/contracts/distribution-profiles.json`.

`main` remains source authority, while an OrdaX device consumes prebuilt immutable releases without needing a compiler, source checkout, Codex or a full Git client in the pre-release bootstrap.

Repository CI owns build/sign/publication. The device consumes a compact signed release envelope and immutable artifacts over HTTPS.

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
