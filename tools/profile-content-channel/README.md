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
```

Verification binds the exact canonical manifest signature, payload SHA-256,
payload size and provenance fields. A successful verification still prints
`PROFILE_CONTENT_ACTIVATION_ALLOWED=NO`.

Do not reuse the whole-OS release key or runtime-component key.
