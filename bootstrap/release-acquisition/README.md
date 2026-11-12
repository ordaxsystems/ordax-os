# Release Acquisition Bootstrap

Status: CLEAN-ROOM CANDIDATE — PHYSICAL USE NOT AUTHORIZED

This directory owns only the pre-release client required to acquire a verified OrdaX release after minimal network bring-up.

It does **not** own a full Git checkout, compiler, source build, SSH service, Remote Core or Control Plane.

## Runtime chain

```text
network ready
 -> fetch signed release envelope over HTTPS
 -> verify Ed25519 signature against local public trust anchor
 -> parse the exact signed manifest payload
 -> validate repository/commit/artifact policy
 -> fetch artifacts over HTTPS
 -> verify exact size + SHA-256
 -> fsync staging release
 -> atomically materialize /ordax/releases/<commit>
 -> optional activation boundary
 -> atomically switch /ordax/current only for install
```

A failed download, signature, hash, size or activation check never replaces the current known-good release. The `materialize` command deliberately stops before activation and cannot retarget the canonical `/ordax/current` pointer.

## Cryptographic envelope

The protocol deliberately does not invent canonical JSON. The envelope carries the **exact manifest bytes** as base64 and the Ed25519 signature is computed over those exact bytes.

```json
{
  "$schema": "prototype-ordax.release-envelope/1",
  "payload": "<base64 exact manifest bytes>",
  "signature": "<base64 Ed25519 signature over payload bytes>",
  "key_id": "prototype-1"
}
```

The local public trust anchor is a small regular file:

```json
{
  "$schema": "prototype-ordax.release-trust/1",
  "key_id": "prototype-1",
  "public_key_base64": "<32-byte Ed25519 public key>"
}
```

Private release signing keys must never be shipped in the repository, bootstrap, Desktop app or device image.

## Signed manifest

Prototype schema:

```json
{
  "$schema": "prototype-ordax.release-manifest/1",
  "source_repository": "ordaxsystems/ordax-os",
  "source_commit": "<lowercase 40-hex commit>",
  "release_id": "<same commit in prototype>",
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

The agent rejects unknown JSON fields, unsafe names, non-HTTPS artifact URLs, repository mismatch, malformed commits/hashes, duplicate artifact names and oversized documents/artifacts.

## Agent

`main.go` uses only the Go standard library:

- `crypto/ed25519` for manifest authenticity;
- `crypto/sha256` for artifact integrity;
- `net/http` for HTTPS acquisition;
- strict `encoding/json` decoding;
- filesystem staging, fsync, rename and symlink activation through `os`.

The CI pins Go 1.27.1, runs the protocol regression suite, builds with `CGO_ENABLED=0 GOOS=linux GOARCH=amd64`, rejects a dynamic program interpreter and publishes candidate hashes/provenance.

No candidate is automatically authorized for physical USB use.

## Creator payload boundary

The CI output is a candidate input to the OrdaX Creator payload; it is never a direct permission to write physical media.

The payload assembler copies the exact verified `ordax-release-agent` bytes into its bundle-relative release-agent location. The canonical media manifest then pins the SHA-256 of those copied bytes. Before a future physical `apply`, Creator Core hashes the assembled local file again and rejects any mismatch, traversal, symlink substitution or missing file.

```text
release-agent CI candidate
 -> verified candidate SHA-256 + provenance
 -> deterministic Creator payload
 -> bundle-relative source_path
 -> Creator Core local SHA-256 recheck
 -> disposable media proof
 -> explicit destructive authorization
 -> physical write
```

Temporary CI runner paths and workflow artifact IDs are evidence/provenance only; they are never runtime `source_path` values in the physical media contract.

## CLI

Verify a downloaded envelope without installing it:

```text
ordax-release-agent verify-envelope \
  --envelope release-envelope.json \
  --trust /ordax/bootstrap/trust/release-ed25519.json
```

Inspect the current signed channel without downloading its artifact or changing device state:

```text
ordax-release-agent inspect \
  --envelope-url https://releases.example/ordax/stable.json \
  --trust /ordax/bootstrap/trust/release-ed25519.json
```

`inspect` fetches only the release envelope, verifies its Ed25519 signature and strict manifest policy, and returns the signed source commit plus artifact metadata. It does **not** request `system.tar`, create a release directory or change `/ordax/current`.

Acquire and verify one exact commit without activating it:

```text
ordax-release-agent materialize \
  --envelope-url https://releases.example/ordax/stable.json \
  --trust /ordax/bootstrap/trust/release-ed25519.json \
  --root /ordax \
  --expected-commit <lowercase-40-hex>
```

This mode is used by the A/B base-update owner. It requires the signed `source_commit` to equal `--expected-commit`, writes only the immutable `/ordax/releases/<commit>` release, persists the exact verified signed envelope as `release-envelope.json` beside `release-manifest.json`, and leaves `/ordax/current` unchanged. Reuse of an existing release requires both persisted files to remain byte-identical to the freshly verified envelope and its signed payload.

Acquire and activate a release:

```text
ordax-release-agent install \
  --envelope-url https://releases.example/ordax/stable.json \
  --trust /ordax/bootstrap/trust/release-ed25519.json \
  --root /ordax
```

For the prototype, `release_id` equals `source_commit`, so immutable release identity and target directory are unambiguous.

See `docs/RELEASE-CHANNEL.md` for the system-wide delivery contract.


## Signed release bundles from removable media (offline, non-activating)

The same canonical `ordax-release-agent` materializers accept one of two
mutually exclusive sources: `--envelope-url` (HTTPS) or `--local-bundle`
(absolute path to a read-only, separate input directory). This is an **input
transport**, not a second updater and not permission to arm a boot slot.

A portable package directory contains the unmodified canonical files:

```text
<offline-bundle>/
  release-envelope.json             # signed Ed25519 envelope (all schemas)
  system.tar                        # release-manifest/1 only
  system.erofs                      # release-manifest/2, /3, /4
  native-surface-runtime.erofs      # release-manifest/3, /4
  local-ai-runtime.erofs            # release-manifest/4 only
```

Only files required by the **exact signed schema** should be needed for the
operation. Artifact names, roles, HTTPS provenance URLs, sizes and SHA-256 are
checked against the signed manifest. The HTTPS URLs remain signed provenance;
the offline command **does not request those URLs**. The package directory and
output root must not overlap. Symlinked ancestors, symlinked envelope/artifact
files, malformed files, wrong repository/commit/schema, truncated or changed
artifacts fail closed **before** release staging; the copy path rechecks the
same artifact hash and size. A mixed `--local-bundle`/`--envelope-url`
request is rejected.

For example, with an already trusted public Ed25519 key installed locally
and a pinned, authorized 40-hex release SHA:

```sh
ordax-release-agent materialize-portable-v4 \
  --local-bundle /media/ORDAX-DATA/verified-package \
  --trust /ordax/bootstrap/trust/release-ed25519.json \
  --root /ordax-data/.ordax \
  --expected-commit <pinned-signed-40-hex-SHA>
ordax-release-agent verify-portable-v4-exact \
  --trust /ordax/bootstrap/trust/release-ed25519.json \
  --root /ordax-data/.ordax \
  --expected-commit <pinned-signed-40-hex-SHA>
```

Use `materialize` for the legacy signed system.tar schema,
`materialize-portable` for v2, `materialize-portable-v3` for v3 and
`materialize-portable-v4` for v4. The existing exact verification and
Portable `ordax-portable-state` health/rollback owners are unchanged.
No `current`, `known-good`, BootNext or ESP pointer is modified by
materialization. An old signed SHA remains subject to the *separate* activation
policy, anti-downgrade and health gates: possession of a valid signature
**alone** is not authorization to downgrade.

A host/Windows tool may **transport** those signed bytes to removable media,
but it must still independently identify the intended disk, preserve the data,
check write/readback, and safely detach it. This CLI does not perform partition
repair, Creator reflashing or hardware identity checks. In particular a bundle
stored on the same corrupt ext4 cannot recover that filesystem: the recovery
runtime must be bootable independently of the damaged state partition.
This capability is a software/CI gate of issue #2005, **not** physical USB
certification.

## Exact offline activation

A Stable/MVP update must not resolve `latest` again after staged health succeeds. The release agent therefore exposes an offline exact activation primitive:

```text
ordax-release-agent activate-exact \
  --root /ordax \
  --trust /ordax/bootstrap/trust/release-ed25519.json \
  --repository ordaxsystems/ordax-os \
  --expected-commit <40-hex-source-commit>
```

Before replacing `/ordax/current`, the command re-verifies the stored signed envelope, manifest, artifact hash/size and materialized system tree for the exact commit. It also requires the existing `current` pointer to name a safe bootable release and reports that previous commit for rollback.

The command performs no network access, no artifact download, no materialization and no reboot. Health-ready policy remains owned by `system/supervisor`; merely having this command available does not authorize automatic Stable activation.


## Portable USB v2 candidate materialization

The acquisition agent now recognizes `prototype-ordax.release-manifest/2` only for the exact portable identity:

```text
product_mode=usb
storage_profile=portable-usb-v2
runtime_format=erofs
artifact=system.erofs
role=system-image
```

The new command is intentionally separate:

```text
ordax-release-agent materialize-portable \
  --envelope-url <https-url> \
  --trust <release-trust.json> \
  --expected-commit <40-hex> \
  --root /ordax-data/.ordax
```

It verifies the signed envelope/manifest, exact SHA-256 and size, checks the EROFS superblock, writes into a temporary release directory, persists the signed manifest and envelope, re-verifies the staged bytes and atomically renames the complete directory to:

```text
/ordax-data/.ordax/releases/<commit>/
├─ system.erofs
├─ release-manifest.json
└─ release-envelope.json
```

This command deliberately **does not activate** the release and does not create the legacy `current` symlink. The old `materialize`, `install` and `activate-exact` paths remain legacy-tree primitives. Portable activation is owned separately by the ext4 `ordax-portable-state` transaction and the shared supervisor: only an exactly verified, safely materialized candidate can be armed for a one-shot boot, and `current/known-good` are committed only after cold health. The command itself never acquires activation authority.


Before any portable-v2 boot handoff, the already materialized release can be revalidated offline:

```text
ordax-release-agent verify-portable-exact \
  --trust <release-trust.json> \
  --expected-commit <40-hex> \
  --root /ordax-data/.ordax
```

This command performs no network access, does not modify the release, does not create an activation pointer and does not mount the image. It revalidates the stored signed envelope, manifest v2 identity, exact commit, artifact hash/size and EROFS superblock. The boot handoff must consume only a release that passes this exact verification.


## Portable USB v3 runtime materialization

`release-manifest/3` adds the offline graphical Surface runtime as a second signed artifact without changing the v2 meaning.

Canonical signed artifacts:

```text
1. system.erofs                  role=system-image
2. native-surface-runtime.erofs  role=surface-runtime
```

Acquire one exact v3 release:

```text
ordax-release-agent materialize-portable-v3 \
  --envelope-url <https-url> \
  --trust <release-trust.json> \
  --expected-commit <40-hex> \
  --root /ordax-data/.ordax
```

The system image remains release-addressed by source commit. The larger graphical runtime is content-addressed by the signed SHA-256 so identical runtime bytes can be reused across later system releases:

```text
/ordax-data/.ordax/releases/<commit>/
├─ system.erofs
├─ surface-runtime.sha256
├─ release-manifest.json
└─ release-envelope.json

/ordax-data/.ordax/runtimes/sha256/<runtime_sha256>/
└─ native-surface-runtime.erofs
```

Before reuse, the agent rechecks the stored runtime size, SHA-256 and EROFS superblock. A hash match therefore avoids a network download but does not bypass verification.

Offline revalidation is explicit:

```text
ordax-release-agent verify-portable-v3-exact \
  --trust <release-trust.json> \
  --expected-commit <40-hex> \
  --root /ordax-data/.ordax
```

Both v3 release-agent commands are non-activating. They do not create or mutate Portable activation slots and do not authorize physical USB writing or publication. The Stable supervisor may subsequently arm an exact verified v3 release through `ordax-portable-state prepare`; PID1 grants that candidate one boot attempt, and the supervisor commits it only after cold Surface health. Failure persists the rejected SHA and falls back to the previous release without Git or network.


## Portable USB v4 local AI materialization

`release-manifest/4` extends the signed portable release with a third artifact while preserving v3 semantics:

```text
1. system.erofs                  role=system-image
2. native-surface-runtime.erofs  role=surface-runtime
3. local-ai-runtime.erofs        role=local-ai-runtime
```

The signed manifest also carries a bounded `local_ai` binding derived from the canonical source lock: engine repository/commit/license, model repository/revision/file/hash/size/license, and the SHA-256 of the source-lock document itself.

Acquire and revalidate one exact v4 release with:

```text
ordax-release-agent materialize-portable-v4 \
  --envelope-url <https-url> \
  --trust <release-trust.json> \
  --expected-commit <40-hex> \
  --root /ordax-data/.ordax

ordax-release-agent verify-portable-v4-exact \
  --trust <release-trust.json> \
  --expected-commit <40-hex> \
  --root /ordax-data/.ordax
```

The Surface runtime remains under `.ordax/runtimes/sha256/`; the local inference payload uses a separate `.ordax/ai-runtimes/sha256/` store. Both are revalidated by signed hash, exact size and EROFS superblock before reuse. The release directory stores digest references, not mutable runtime copies.

This protocol support does **not** mean the real llama.cpp/model EROFS has already been built or placed on a physical Stable USB. v4 materialization remains non-activating and does not grant physical-write authority.

## Owner/Development: selective signed Aura EROFS materialization (source candidate)

`materialize-owner-dev-local-ai` is a **non-activating** operation of the
existing `ordax-release-agent`; it does not create a second downloader, signer,
model source, updater, Stable slot or runtime service. It reads the published
signed portable v4 envelope with the **existing** release trust anchor, requires
an explicitly pinned release commit **independent of the Git `main` checkout**
and checks the signed `local_ai.source_lock_sha256` against the exact
`source-lock.json` of the active Owner/Development checkout.

Its caller must also supply exact EROFS SHA-256 and byte size, fixed by the
canonical v4 candidate and the current `owner-dev-runtime.sh`. Only then does it
download and verify **the local AI artifact alone**, reuse the existing
hash/size/EROFS verifier, and atomically materialize the file at:

```text
/state/ordax/local-ai/sha256/<signed-artifact-sha256>/local-ai-runtime.erofs
```

The store directories use 0700 and the image 0600; existing content is
reverified before reuse and corrupt candidates are **not** silently
overwritten. The operation performs no Stable activation, no boot mutation,
no Surface download, no Git update and no modification of existing known-good
state. A failed acquisition cannot affect the boot-critical system release.

Required options (no implicit `latest` identity):

```text
ordax-release-agent materialize-owner-dev-local-ai \
  --envelope-url <verified canonical v4 HTTPS release envelope> \
  --trust <canonical release public trust anchor> \
  --state-root /state/ordax \
  --source-lock /workspace/ordax/system/services/local-ai/source-lock.json \
  --expected-release-commit <signed portable v4 source commit> \
  --expected-artifact-sha256 <signed and locally pinned AI EROFS SHA-256> \
  --expected-artifact-size <signed and locally pinned AI EROFS byte size>
```

**Do not run this directly from the graphical Surface or device recovery
shell.** The acquisition is a verified primitive, not delivery wiring. The
authorized Owner/Development update supervisor must first receive a verified
static release-agent binary through its existing component delivery boundary,
then bind the exact candidate/trust and run this command in its governed
component acquisition stage. The CLI is never invoked during graphical boot.
That integration, disk-space checks, recovery/rollback receipts and real
notebook inference remain separate gates in #2071. A CI pass here is **not**
proof that the USB device received the model. This path introduces no APK or
Alpine-specific package installation.

