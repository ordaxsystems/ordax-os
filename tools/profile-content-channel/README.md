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

profile-content-channel derive-trust \
  --private-key <external>/profile-content-private.pem \
  --out <independent-review>/profile-content-trust.json \
  --key-id ordax-profile-content-v1

profile-content-channel sign \
  --manifest manifest.json \
  --private-key <external>/profile-content-private.pem \
  --trust profile-content-trust.json \
  --key-id profile-proof-test \
  --out envelope.json

profile-content-channel verify-envelope \
  --manifest manifest.json \
  --envelope envelope.json \
  --trust profile-content-trust.json

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

Verification binds the exact canonical manifest signature, payload SHA-256,
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


## Trust ceremony primitives

`derive-trust` exists so an operator can independently derive the exact public
Ed25519 trust document from a custodied private key into a separate review path.
It never reads or modifies repository trust state.

`verify-envelope` verifies the signed canonical Profile content manifest using
only the public trust document. It deliberately does not require or install the
content payload, which lets a recovery ceremony prove that a restored private
key still controls the same public identity.

Neither command pins the canonical anchor or enables publication, installation,
activation, Store access or Stable/MVP Profile mutation.
