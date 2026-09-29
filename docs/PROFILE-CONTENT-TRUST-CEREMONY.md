# Canonical Profile Content Trust Ceremony

Status: **SOURCE TOOLKIT READY — OPERATOR CEREMONY PENDING — NO CANONICAL PROFILE CONTENT KEY PINNED**

This ceremony creates the Ed25519 trust identity used only for OrdaX Profile
Knowledge Packs and Skill Packs. It is separate from whole-OS release trust,
runtime-component trust, apps and models.

Machine-readable policy:

`docs/contracts/profile-content-trust-policy.json`

## Boundary

```text
eligible main-push toolkit
  -> local operator preflight
  -> external PKCS#8 Ed25519 private key
  -> independent public derivation
  -> signed protocol-shaped Profile content proof
  -> encrypted offline recovery copy
  -> distinct restored private key
  -> recovered public derivation + recovered signing proof
  -> public-only handoff
  -> separate repository promotion of public trust only
```

Canonical key id: `ordax-profile-content-v1`.

Future public anchor:

```text
repository: system/trust/profile-content-ed25519.json
runtime:    /srv/ordax-system/trust/profile-content-ed25519.json
```

No private key, seed, recovery password, encrypted backup, private-key hash or
secret-looking material belongs in Git, CI artifacts, the USB image or chat.

## Windows operator toolkit

Only an artifact emitted by an eligible **push of main** may create the
canonical identity. Pull-request and manual-dispatch artifacts are review
artifacts only.

The toolkit contains the three numbered wrappers, the two PowerShell operator
scripts, `ordax-profile-content-channel.exe`, this ceremony, the exact policy,
provenance and hashes.

Step 1 is read-only. Step 2 requires explicit key generation, writes the private
key outside repository/toolkit paths, proves independent derivation and a
protocol-shaped sign/verify, then stops with `READY_TO_PIN_PUBLIC_ANCHOR=NO`.

After an encrypted offline backup is restored to a distinct temporary private
path, step 3 derives the public anchor again, proves byte identity, signs the
original proof with the recovered key, verifies it using public trust only and
creates `OrdaX-Profile-Content-Public-Trust-Handoff.zip`.

The toolkit never pins Git automatically and never changes:

```text
PROFILE_CONTENT_PUBLISH_ALLOWED=NO
PROFILE_CONTENT_INSTALL_ALLOWED=NO
PROFILE_CONTENT_ACTIVATION_ALLOWED=NO
```

## Required recovery proof

Before the public anchor is eligible to be pinned:

1. generate the private key outside repository/toolkit paths;
2. independently derive the same public trust bytes;
3. sign and verify a non-production Knowledge Pack proof;
4. create an encrypted recovery copy outside the repository;
5. restore it to a different temporary private-key path;
6. derive public trust again and require byte identity;
7. sign the original proof manifest with the recovered key;
8. verify the recovered envelope using only the candidate public trust;
9. produce a handoff containing only public trust, public evidence and the
   non-production proof fixture.

A CI-generated key or fixture can test the protocol but can never satisfy the
canonical ceremony.

## Relationship to first-public-profile-proof

Pinning the canonical public anchor is necessary but **not sufficient** for
`first-public-profile-proof`. That gate also requires a real canonical Profile
component, real publication under the pinned anchor, verified install,
health/receipt/inventory evidence and domain review. Legal-BR remains blocked
until its official-source, freshness and professional-review requirements pass.
