# OrdaX Profile Content Channel

Host-neutral Ed25519 verifier for **Knowledge Packs** and **Skill Packs**.

It reuses the security pattern of the Runtime Component Channel but owns a
separate trust domain and key. It does not verify apps, models or executable
runtime components.

Schemas:

```text
prototype-ordax.profile-content-manifest/1
prototype-ordax.profile-content-envelope/1
prototype-ordax.profile-content-trust/1
```

The canonical trust anchor is not pinned. Public publication, installation and
activation remain disabled.

## Commands

```text
profile-content-channel generate-key \
  --private-key <external>/profile-content-private.pem \
  --trust <review>/profile-content-trust.json \
  --key-id profile-proof-test

profile-content-channel derive-trust \\
  --private-key <external>/profile-content-private.pem \\
  --out <second-review>/profile-content-trust.json \\
  --key-id profile-proof-test

profile-content-channel sign \
  --manifest manifest.json \
  --private-key <external>/profile-content-private.pem \
  --trust profile-content-trust.json \
  --key-id profile-proof-test \
  --out envelope.json

profile-content-channel verify \
  --manifest manifest.json \
  --envelope envelope.json \
  --trust profile-content-trust.json \
  --content content.pack

profile-content-channel stage \
  --manifest manifest.json \
  --envelope envelope.json \
  --trust profile-content-trust.json \
  --content content.pack \
  --root /var/lib/ordax/profile-content
```

`derive-trust` reconstructs only the public trust anchor from an existing external private key so an operator can prove independent derivation and recovery without copying private material into Git or CI.\n\nVerification binds the exact canonical manifest signature, payload SHA-256,
payload size and provenance fields. A successful verification still prints
`PROFILE_CONTENT_ACTIVATION_ALLOWED=NO`.

Do not reuse the whole-OS release key or runtime-component key.


## Staging boundary

`stage` verifies the signature and exact payload before materializing a slot at:

```text
<root>/<kind>/<id>/versions/<version>/<sha256>/
```

The slot contains only the canonical manifest, signed envelope and content payload.
Files and the slot directory become read-only, then the slot is reverified after
the atomic rename. Re-staging reuses only an existing slot that still verifies.

Staging does **not** activate a Profile, mutate a Space, write the installed
component inventory or create an install receipt.


## Deterministic unsigned publication handoff

Before any external signing ceremony, the repository can freeze the exact source
bytes that are eligible to be signed without pretending that publication is
already authorized:

```text
python3 tools/profile-content-channel/prepare_publication_handoff.py \
  --source system/profile-content-sources/developer-core/v0.1.0 \
  --out <review>/publication-handoff.json
```

The handoff contains only public metadata: exact manifest/content SHA-256 and
sizes, component identity, source revision and fail-closed gate state. It never
creates an envelope, never reads a private key, never pins trust, and always
reports publication/install/activation as disabled. The output is an operator
review input, not release evidence.
