# Canonical Release Trust Ceremony

Status: LOCAL KEY GENERATED — CRYPTOGRAPHIC RECOVERY VERIFIED — PUBLIC ANCHOR PINNED — PHYSICAL WRITE BLOCKED

**Operational interpretation:** the first canonical release-trust ceremony is already complete. Do **not** run `generate-key` or the initialization sequence below as a routine setup/rebuild step. The detailed ceremony remains as provenance, recovery procedure and protocol reference. Creating a replacement canonical key requires an explicit rotation/recovery decision and the applicable machine-readable trust state; ordinary builds, PRs, new USB candidates or repository updates do not authorize a new identity.

This ceremony exists so the first physical OrdaX prototype can be created without Codex, without committing a private key, and without inventing a CI-only trust anchor.

The repository owns the protocol and policy. The developer owns the canonical private release-signing key. Only the matching public Ed25519 trust anchor may enter Git and the boot payload.

The machine-readable authority for this policy is `docs/contracts/release-trust-policy.json`. If prose and contract diverge, the contract wins.

## Current operator state — 2026-09-21

The eligible toolkit bound to source commit `2172eb6a18430910afd036199ec492ad63dc185d` has completed local steps 1, 2 and 3. The read-only preflight passed, key material was generated locally, independent public derivation matched, the initial proof signing step succeeded, and a distinct restored private copy from the encrypted backup independently derived the same public trust and produced a recovery signing proof that verified successfully. The public trust file SHA-256 is `d2836df77a3d5a54ccf64cc5643cfd5c19052efc83f2e3e2666c6d3197fce250`. The resulting public handoff ZIP SHA-256 is `85d4f8430f0a4066ebed84a410071409c112c65aa72a5818483a664a41b91e20`.

```text
TOOLKIT_TRUST_PREFLIGHT=PASS
CANONICAL_KEY_MATERIAL_GENERATED=YES
PUBLIC_TRUST_DERIVATION_MATCH=PASS
PROOF_SIGNATURE_CREATED=YES
OFFLINE_RECOVERY_VERIFIED=YES
LOCAL_ENCRYPTED_BACKUP_COPY_VERIFIED=YES
EXTERNAL_OFFLINE_BACKUP_CUSTODY_CONFIRMED=NO
PUBLIC_ANCHOR_PINNED=YES
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=YES
PHYSICAL_AUTHORIZATION_ELIGIBLE=YES
PHYSICAL_WRITE_ALLOWED=NO
```

No private PEM bytes, private-key hash, backup secret, recovery password or private-key path are recorded in source. The cryptographic recovery proof is verified and the exact public handoff has been promoted. The encrypted archive used for this controlled-prototype recovery test remains on the same host; a byte-identical redundant local copy is verified, but this is not treated as independent off-device custody. Off-device encrypted custody remains required before broad public distribution, not before the first controlled physical prototype.

## Boundary

```text
Windows developer machine
 -> ordax-release-signing.exe generate-key
 -> private PKCS#8 Ed25519 key: stays outside repository
 -> public release-ed25519.json: eligible for source pinning
 -> encrypted offline recovery copy
 -> independent public derivation + signing proof
 -> only then resolve bootstrap-release-trust
```

The first physical prototype uses the fixed key id:

```text
ordax-prototype-release-v1
```

The public anchor target is:

```text
repository: bootstrap/trust/release-ed25519.json
runtime:    /ordax/bootstrap/trust/release-ed25519.json
```

## Repository-state prerequisite for the first canonical identity

The first canonical release identity must be created only after the Stable/MVP Portable architecture that it will authorize is already present on `main`. For the first prototype ceremony, the reviewed `main` source must include:

- the final `ORDAX-ESP + ORDAX-DATA` Portable media authority rather than the transitional `ORDAX + ext4` layout;
- the internal/tagged Portable writer implementation while the public writer and destructive authorization remain disabled;
- signed `release-manifest/3` system + Surface-runtime binding;
- recorded direct-kernel QEMU and OVMF/UEFI proof of the offline runtime-v3 handoff;
- recorded disposable QEMU proof of the Portable v3 one-shot failure path: candidate boots exactly once, next boot returns to the exact previous release, the candidate is persisted as `rejected`, and the activation transaction is cleaned up;
- `physical_write_allowed=false` and no claim of cold-health commit, physical USB boot or Secure Boot.

This ordering prevents the canonical key ceremony from being bound to a source commit whose physical-media policy is immediately obsolete. The eligible Windows Prototype Toolkit must therefore come from a `push` of `main` **after** these prerequisites have landed. A toolkit from an earlier `main` commit, even if otherwise well formed, must not be used for the first canonical identity.

This is enforced by provenance, not prose alone. `provenance.json` carries a `canonical_trust_prerequisites` object for the recorded runtime-v3 direct-kernel proof, runtime-v3 OVMF proof, the committed one-shot failure/fallback proof, final Portable writer implementation in fail-closed mode, and still-disabled physical authorization. The one-shot evidence source commit must also be an ancestor of the toolkit's exact `main` source commit. `canonical_trust_ceremony_eligible=true` is emitted only when the run is a canonical `main` push **and** every prerequisite is true. Both initialization and recovery re-check those fields locally.

## Required local ceremony

The actual canonical key generation is a local user action and must not be performed in CI, a chat session or a disposable runner. The signer under `tools/release-signing/` already supports the required operation and uses only standard Ed25519/PKCS#8 primitives from the Go standard library.

For the canonical ceremony, use the complete **Windows Prototype Toolkit** produced for one exact reviewed commit. Keep `provenance.json`, `ordax-release-signing.exe` and `Initialize-OrdaXReleaseTrust.ps1` together exactly as downloaded; do not mix files from different toolkit runs and do not replace one file with a locally rebuilt copy.

Before generating any key material, run the read-only toolkit preflight:

```text
1-Verify-OrdaXTrustToolkit.cmd
```

It invokes the same initializer with `-PreflightOnly`, validates canonical-main provenance plus the signer/initializer hashes, reports the exact source commit, and exits before creating private/review paths or mutating the filesystem. Require:

```text
TOOLKIT_TRUST_PREFLIGHT=PASS
CANONICAL_TRUST_CEREMONY_ELIGIBLE=YES
TOOLKIT_COMPONENT_HASHES_VERIFIED=YES
PRIVATE_KEY_TOUCHED=NO
FILESYSTEM_MUTATION=NO
```

Only after that succeeds, start the actual local ceremony through:

```text
2-Initialize-OrdaXTrust.cmd
```

The underlying PowerShell initializer is fail-closed: direct invocation without the explicit `-GenerateKey` switch refuses key generation. The step-2 wrapper supplies that switch only after the operator deliberately chooses the generation step.

Before any key is generated, the initializer fails closed unless:

1. `provenance.json` has schema `prototype-ordax.windows-prototype-toolkit/2` and status `candidate`;
2. the toolkit provenance declares repository `ordaxsystems/ordax-os`, event `push`, ref `refs/heads/main` and `canonical_trust_ceremony_eligible=true`;
3. `source_commit` is exactly 40 lowercase hexadecimal characters;
4. the SHA-256 of `ordax-release-signing.exe` matches the toolkit provenance;
5. the SHA-256 of `Initialize-OrdaXReleaseTrust.ps1` matches the toolkit provenance.

Artifacts produced for pull requests or manual workflow-dispatch remain useful for CI and review, but they are **not eligible** to create the canonical release-signing identity. The ceremony must use a toolkit emitted by a canonical `push` run on `main` whose provenance satisfies the prerequisites above; never infer eligibility from the PR that introduced or edited this runbook.

The proof manifest and `ceremony-result.json` are then bound to that provenance `source_commit`. The operator must not type or substitute a placeholder commit. A provenance or component-hash mismatch aborts the ceremony before private-key creation.

The initializer generates into a private path outside the toolkit/repository and a separate temporary public-review path. Its underlying signing operation is equivalent to:

```text
ordax-release-signing.exe generate-key \
  --private-key <private-path-outside-repository>\ordax-release-private.pem \
  --trust <temporary-public-review-path>\release-ed25519.json \
  --key-id ordax-prototype-release-v1
```

The command must report:

```text
KEY_GENERATED=YES
KEY_ID=ordax-prototype-release-v1
PUBLIC_KEY_SHA256=<64 lowercase hex>
PRIVATE_KEY_PRINTED=NO
```

Before the public anchor is eligible to be pinned:

1. the private key is stored outside the repository in user-private storage;
2. at least one encrypted offline recovery copy exists;
3. the public trust document is independently derived again from the same private key;
4. both public derivations are byte-identical and report the same public-key fingerprint;
5. a real-shaped proof manifest is signed with the private key while supplying the candidate public trust file explicitly;
6. the signer reports `TRUST_MATCH=YES` and refuses mismatched private/public material;
7. the private key is absent from Git, USB bootstrap, Actions artifacts, logs and chat;
8. only the reviewed public `release-ed25519.json` is committed;
9. `docs/contracts/minimal-bootstrap.json` pins that exact public file by SHA-256;
10. `all_artifacts_resolved` remains false until those public bytes and digest are real;
11. physical write remains disabled until every independent gate passes.

## Independent public derivation

Derive a second public file into a different empty review path:

```text
ordax-release-signing.exe derive-trust \
  --private-key <private-path-outside-repository>\ordax-release-private.pem \
  --out <second-public-review-path>\release-ed25519.json \
  --key-id ordax-prototype-release-v1
```

Require:

```text
FIRST_PUBLIC_FILE == SECOND_PUBLIC_FILE
FIRST_PUBLIC_FINGERPRINT == SECOND_PUBLIC_FINGERPRINT
TRUST_SCHEMA == prototype-ordax.release-trust/1
TRUST_KEY_ID == ordax-prototype-release-v1
PUBLIC_KEY_IS_32_BYTE_ED25519=YES
```

Do not hand-edit public key bytes to fix a mismatch. Any mismatch aborts the ceremony.

## Private/public signing proof

Use a non-production proof manifest that satisfies `prototype-ordax.release-manifest/1` and contains exactly one `system.tar` artifact. Then run:

```text
ordax-release-signing.exe sign \
  --manifest <proof-path>\release-manifest.json \
  --private-key <private-path-outside-repository>\ordax-release-private.pem \
  --trust <temporary-public-review-path>\release-ed25519.json \
  --key-id ordax-prototype-release-v1 \
  --out <proof-path>\release-envelope.json
```

Require:

```text
RELEASE_ENVELOPE_SIGNED=YES
KEY_ID=ordax-prototype-release-v1
TRUST_MATCH=YES
PRIVATE_KEY_PRINTED=NO
```

The repository tests must continue proving both sides: a valid signer envelope is accepted by the release-acquisition protocol, while private/trust mismatch fails closed.

## Offline recovery verification

After the encrypted offline backup exists, restore one copy to a **different temporary private path** outside the repository/toolkit. Do not point the recovery proof at the primary custodial PEM.

The Windows toolkit provides:

```text
3-Verify-OrdaXTrustRecovery.cmd
```

It calls `Complete-OrdaXReleaseTrust.ps1`, which fails closed unless all of these are true:

1. the primary private key and recovered private key are distinct local files outside the toolkit;
2. the initializer's `ceremony-result.json` is still in the expected pre-promotion state;
3. canonical trust, primary independent derivation and recovered derivation are byte-identical;
4. the recovered key successfully signs the protocol-shaped proof manifest while using the canonical public trust file;
5. the public trust document contains a 32-byte Ed25519 key and the fixed canonical key id;
6. no private-key bytes or private-key hashes enter the public evidence.

On success it emits:

```text
OFFLINE_RECOVERY_VERIFIED=YES
PRIMARY_PUBLIC_DERIVATION_MATCH=YES
RECOVERED_PUBLIC_DERIVATION_MATCH=YES
RECOVERED_PRIVATE_PATH_DISTINCT=YES
RECOVERED_SIGNING_PROOF=YES
PRIVATE_KEY_PRINTED=NO
PRIVATE_KEY_COPIED_TO_PUBLIC_PROMOTION=NO
READY_TO_PIN_PUBLIC_ANCHOR=YES
```

The `trust-review/public-promotion/` directory contains only public material:

```text
release-ed25519.json
ceremony-public-evidence.json
trust-proof-manifest.json
trust-proof-recovery-envelope.json
```

The finalizer also creates a single public handoff archive next to that directory:

```text
trust-review/OrdaX-Public-Trust-Handoff.zip
```

That ZIP contains exactly the four public files above. It is the only ceremony artifact that needs to leave the developer machine for repository promotion. It must never contain a PEM, private key, secret, seed, recovery password or encrypted private-key backup. The finalizer emits the ZIP SHA-256 for transport checking.

The recovered-signing envelope is re-verified with `ordax-release-signing verify-envelope` before the finalizer reports readiness. The public-promotion set therefore carries both the ceremony assertions and the cryptographic proof needed to revalidate them later without any private key.

The restored private PEM should be removed from the temporary recovery location after verification according to the operator's backup procedure. The repository does not prescribe the backup encryption product or password handling; it proves that the recovered material is cryptographically the same release identity.

## Public-anchor promotion

Only after custody, recovery, derivation and signing proof pass may the reviewed public JSON be copied to:

```text
bootstrap/trust/release-ed25519.json
```

Before commit, verify:

```text
PUBLIC_FILE_ONLY=YES
PRIVATE_KEY_STAGED=NO
PRIVATE_KEY_CONTENT_SEARCH=NO_MATCH
KEY_ID_REVIEWED=YES
PUBLIC_KEY_FINGERPRINT_REVIEWED=YES
```

Then run the repository promoter with the exact reviewed signer binary:

```text
python tools/release-signing/promote_public_trust.py check \
  --promotion-zip <trust-review>\OrdaX-Public-Trust-Handoff.zip \
  --verifier <toolkit>\ordax-release-signing.exe

python tools/release-signing/promote_public_trust.py apply \
  --promotion-zip <trust-review>\OrdaX-Public-Trust-Handoff.zip \
  --verifier <toolkit>\ordax-release-signing.exe
```

The ZIP path is canonical for both `check` and `apply`; manual extraction is not required for repository promotion. The promoter re-verifies the archive shape, Ed25519 recovery envelope, public hashes and proof bindings, pins the exact public-anchor SHA-256 into `docs/contracts/minimal-bootstrap.json`, records the public proof material under `docs/evidence/`, updates the trust-policy gates, and computes public bindings for the later physical-write authorization.

It **does not** authorize destructive writes. After successful public trust promotion:

```text
MINIMAL_BOOTSTRAP_ALL_ARTIFACTS_RESOLVED=YES
PHYSICAL_AUTHORIZATION_ELIGIBLE=YES
PHYSICAL_WRITE_ALLOWED=NO
```

`PHYSICAL_AUTHORIZATION_ELIGIBLE=YES` means only that the trust-side prerequisites for the separate physical-promotion gate are satisfied. It is not an authorization to write physical media.

Physical authorization remains a separate contract and separate gate.

## CI signing

An encrypted GitHub Actions secret may hold an online signing copy only after the user explicitly configures it. The secret is an execution input, not source authority and not canonical custody.

No workflow may silently generate a new canonical key when configured signing material is absent. Missing canonical signing material is a hard publication failure.

The private key must never be uploaded as an Actions artifact or printed into logs. Ephemeral CI-only test keys may exercise protocol tests but can never satisfy the physical bootstrap trust gate.

## Ceremony evidence

Record only non-secret evidence:

```text
CEREMONY_STATUS=PASS
SOURCE_COMMIT=<40-hex reviewed commit>
KEY_ID=ordax-prototype-release-v1
PUBLIC_KEY_SHA256=<64 lowercase hex>
PUBLIC_TRUST_FILE_SHA256=<64 lowercase hex>
PRIVATE_KEY_CUSTODY_OWNER=repository-owner-developer
OFFLINE_ENCRYPTED_BACKUP=YES
OFFLINE_BACKUP_RECOVERY_VERIFIED=YES
RECOVERED_PRIVATE_PATH_DISTINCT=YES
RECOVERED_PUBLIC_DERIVATION_MATCH=YES
RECOVERED_SIGNING_PROOF=YES
PUBLIC_KEY_DERIVED_FROM_CUSTODIED_PRIVATE_KEY=YES
PUBLIC_KEY_FINGERPRINT_REVIEWED=YES
SIGNER_PRIVATE_TRUST_MATCH=PASS
PRIVATE_KEY_IN_GIT=NO
PRIVATE_KEY_IN_USB=NO
PRIVATE_KEY_IN_ACTIONS_ARTIFACTS=NO
PRIVATE_KEY_IN_LOGS=NO
PRIVATE_KEY_IN_CHAT=NO
```

Never record the private PEM, a seed, private-key bytes or another reversible secret in this evidence.

## Custody evolution after the controlled prototype

The local PEM ceremony is allowed to close the first controlled physical prototype proof without introducing a paid cloud dependency. It is not the intended permanent production custody model.

The release-signing boundary must remain provider-neutral: `local-pem` is the current controlled-prototype backend; a future managed non-exportable KMS/HSM backend may replace operational custody while devices continue verifying the same signed release protocol. GitHub remains source/build/orchestration infrastructure and is not a key custodian.

Before broad public distribution, OrdaX must implement signed trust transition/rotation so loss or retirement of one operational release key does not force mass reprovisioning. The exact future KMS/HSM provider and any threshold Root topology are intentionally not embedded in this ceremony contract.
## Recovery

For the prototype, key loss is intentionally fail-closed.

Before physical distribution, losing the private key means generating a new key and repinning the public anchor before the first write. After prototype media has been provisioned, loss of the key requires reprovisioning that prototype media with a new trust anchor.

This is acceptable for the first notebook proof because the device population is intentionally tiny and controlled.

## Rotation

Silent public-key replacement is forbidden.

A signed trust-transition protocol v1 is now implemented and CI-proven between the signer and release agent. It requires the currently trusted key to authorize a distinct successor key, binds the exact current-trust SHA-256 and an exact monotonic sequence, and fails closed on rollback/tampering. Stateful device activation of the successor trust is still disabled, so production rotation is not yet complete. Until that activation owner is implemented and physically proven, the first controlled prototype remains bound to the pinned canonical anchor.

Current fail-closed state after local generation, verified cryptographic recovery and canonical public-anchor promotion:

```text
TRUST_POLICY_RESOLVED=YES
CANONICAL_KEY_MATERIAL_GENERATED=YES
OFFLINE_RECOVERY_VERIFIED=YES
TOOL_REPORTED_READY_TO_PIN_PUBLIC_ANCHOR=YES
LOCAL_ENCRYPTED_BACKUP_COPY_VERIFIED=YES
EXTERNAL_OFFLINE_BACKUP_CUSTODY_CONFIRMED=NO
EXTERNAL_OFFLINE_BACKUP_REQUIRED_BEFORE_BROAD_DISTRIBUTION=YES
PUBLIC_ANCHOR_PINNED=YES
BOOTSTRAP_RELEASE_TRUST_RESOLVED=YES
PHYSICAL_AUTHORIZATION_ELIGIBLE=YES
EXPLICIT_OWNER_AUTHORIZATION=NO
PHYSICAL_WRITE_ALLOWED=NO
```

See also:

- `docs/contracts/release-trust-policy.json`
- `docs/RELEASE-SIGNING.md`
- `bootstrap/trust/README.md`
- `tools/release-signing/README.md`
- `docs/contracts/minimal-bootstrap.json`
- `docs/PROMOTION-GATES.md`
