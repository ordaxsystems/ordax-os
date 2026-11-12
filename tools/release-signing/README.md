# OrdaX Release Signing

`tools/release-signing/` owns the small host-neutral utility used to create and verify the public/private boundary of the OrdaX release protocol.

It uses only the Go standard library and standard Ed25519/PKCS#8 primitives. It does not own release publication, device provisioning or physical-media authorization.

## Commands

```text
ordax-release-signing generate-key \
  --private-key <external-path>/ordax-release-private.pem \
  --trust <review-path>/release-ed25519.json \
  --key-id prototype-1

ordax-release-signing derive-trust \
  --private-key <external-path>/ordax-release-private.pem \
  --out <review-path>/release-ed25519.json \
  --key-id prototype-1

ordax-release-signing sign \
  --manifest release-manifest.json \
  --private-key <external-path>/ordax-release-private.pem \
  --trust <canonical-public-path>/release-ed25519.json \
  --key-id prototype-1 \
  --out release-envelope.json

ordax-release-signing verify-envelope \
  --envelope release-envelope.json \
  --trust <canonical-public-path>/release-ed25519.json

ordax-release-signing sign-trust-transition \
  --current-private-key <external-path>/ordax-release-private.pem \
  --current-trust <current-public-trust.json> \
  --next-trust <next-public-trust.json> \
  --sequence <N> \
  --out trust-transition.json

ordax-release-signing verify-trust-transition \
  --envelope trust-transition.json \
  --current-trust <current-public-trust.json> \
  --expected-sequence <N> \
  --out-next-trust <verified-next-public-trust.json>
```

## Private-key boundary

The private key:

- must be a regular non-symlink PKCS#8 Ed25519 PEM file;
- must be `0600` on Unix-like systems;
- is never printed by the CLI;
- is never copied into a trust file or envelope;
- is never accepted from the repository as canonical custody;
- must not be committed, uploaded as a build artifact, placed on the USB seed or shipped inside OrdaX Desktop.

All outputs use exclusive creation. Existing files are never silently replaced.

`generate-key` exists to support an explicit key ceremony on a trusted operator/signing host. Generating a key in CI, a disposable runner or an arbitrary developer temp directory does **not** make that key a canonical release key.

The repository already ignores `*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets/` and `credentials/`, but `.gitignore` is only a safety net. Canonical private-key custody must be outside the repository tree.

## Trust anchor

`derive-trust` emits only:

```json
{
  "$schema": "prototype-ordax.release-trust/1",
  "key_id": "prototype-1",
  "public_key_base64": "<32 raw Ed25519 public-key bytes in base64>"
}
```

The public trust anchor may enter `bootstrap/trust/release-ed25519.json` only after the matching private key has an explicit custody owner and recovery/rotation policy outside Git.

The `sign` command requires that public trust anchor as an explicit input and refuses to emit an envelope when the private key, public key or `key_id` disagree.

## Signing

Before signing, the tool validates the same v1 release-manifest invariants consumed by the device agent:

- exact schema;
- expected source repository;
- lowercase 40-hex source commit;
- `release_id == source_commit`;
- bounded CI recipe identifier;
- exactly one artifact;
- artifact name exactly `system.tar`;
- artifact role exactly `system`;
- HTTPS artifact URL;
- exact SHA-256 syntax and positive bounded size.

The signature is standard Ed25519 over the **exact manifest file bytes**. Whitespace is preserved in the signed payload. The output envelope uses the existing `prototype-ordax.release-envelope/1` protocol.

## Signed trust transition

Trust rotation is a separate protocol from release envelopes. `sign-trust-transition` requires the currently trusted private key and binds:

- the exact SHA-256 of the current public trust file;
- the current key id;
- a positive exact sequence number;
- a distinct successor key id and distinct Ed25519 public key;
- the canonical SHA-256 of the successor trust file.

`verify-trust-transition` verifies all of those bindings using only the current public trust and writes the successor trust only to a new output path. It does not mutate the active device trust. Stateful device activation remains a separate future owner and production rotation is not yet enabled.

## Public trust promotion

After the offline recovery ceremony succeeds, the only ceremony artifact that needs repository promotion is:

```text
OrdaX-Public-Trust-Handoff.zip
```

Use the existing fail-closed promoter directly on the ZIP; manual extraction is unnecessary:

```text
python tools/release-signing/promote_public_trust.py check \
  --promotion-zip <path>/OrdaX-Public-Trust-Handoff.zip \
  --verifier <reviewed-toolkit>/ordax-release-signing.exe

python tools/release-signing/promote_public_trust.py apply \
  --promotion-zip <path>/OrdaX-Public-Trust-Handoff.zip \
  --verifier <reviewed-toolkit>/ordax-release-signing.exe
```

The promoter re-verifies the recovery signature and public hashes, pins only public trust/evidence, resolves the minimal-bootstrap trust group and prepares later physical-authorization bindings. It always leaves:

```text
PHYSICAL_WRITE_ALLOWED=NO
EXPLICIT_OWNER_AUTHORIZATION=NO
```

Public trust promotion is therefore not permission to write a USB.

## CI policy

Repository CI may generate an ephemeral test key solely to prove the signing protocol and tooling. Such a key:

```text
CI_TEST_KEY=YES
CANONICAL_TRUST_ANCHOR=NO
PHYSICAL_BOOTSTRAP_TRUST=NO
PRIVATE_KEY_ARTIFACT_UPLOAD=NO
```

The production/canonical private key must come from a separate explicit custody decision.

Expensive build/boot candidate workflows retain the canonical release signer as a causal
source but exclude the physical writer signer (`cmd/ordax-physical-release-signing/`),
Windows ceremony scripts, public trust promoter and this README. In particular,
`.github/workflows/local-ai-runtime-candidate.yml` proves signed-v4 materialization
using the canonical Go signer, not the physical writer signer. A physical-signing-only
change must run its own `release-signing`, `release-pipeline` and Creator safety
checks without needlessly compiling the local AI EROFS twice. The exclusions follow
the existing `tests/test_release_signing_heavy_workflow_scope.py` policy; changes to
the canonical signer itself still trigger the heavyweight proofs.

See `docs/RELEASE-SIGNING.md` and `docs/RELEASE-TRUST-CEREMONY.md`.
