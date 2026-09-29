# Canonical Profile Content Trust Ceremony

Status: **SOURCE FOUNDATION READY — OPERATOR CEREMONY PENDING — NO CANONICAL PROFILE CONTENT KEY PINNED**

This ceremony creates the trust identity used to authenticate independently
published OrdaX Profile content: **Knowledge Packs** and **Skill Packs**.

Machine-readable authority:

`docs/contracts/profile-content-trust-policy.json`

## Boundary

```text
external operator/signing host
  -> ordax-profile-content-channel generate-key
  -> external PKCS#8 Ed25519 private key
  -> reviewed public profile-content trust JSON
  -> independent public derivation
  -> encrypted recovery copy
  -> recovered-key derivation + signing proof
  -> public-only handoff
  -> repository pin of public trust only
```

The fixed first key id is:

```text
ordax-profile-content-v1
```

Future public anchor:

```text
repository: system/trust/profile-content-ed25519.json
runtime:    /srv/ordax-system/trust/profile-content-ed25519.json
```

No private Profile-content key belongs in Git, the OrdaX USB, Actions artifacts,
CI logs, chat or device state.

## Trust separation

The Profile-content key must not reuse:
- whole-OS release trust;
- runtime-component trust;
- external-app trust.

CI may create disposable keys only for protocol tests. Disposable CI trust can
never satisfy the canonical Profile-content gate.

## Required operator ceremony

Using a reviewed `ordax-profile-content-channel` binary from an eligible push of
`main`, generate the private key outside the repository:

```text
ordax-profile-content-channel generate-key \
  --private-key <external-private-path>/profile-content-private.pem \
  --trust <review-path>/profile-content-ed25519.json \
  --key-id ordax-profile-content-v1
```

Independently derive the public trust into a second empty path:

```text
ordax-profile-content-channel derive-trust \
  --private-key <external-private-path>/profile-content-private.pem \
  --out <review-path>/profile-content-ed25519-derived.json \
  --key-id ordax-profile-content-v1
```

The two public JSON files must be byte-identical and contain the same 32-byte
Ed25519 public key.

## Signing proof

Before any public anchor may be pinned, create a non-regulated protocol-shaped
Knowledge or Skill Pack with:
- zero requested capabilities;
- runtime network disabled;
- mutable host access disabled;
- per-entry provenance;
- exact content hash.

Sign its manifest with the candidate private key and verify it using only the
candidate public trust. Stage it into an immutable content-addressed slot and
require structural health to report:
- per-entry hashes verified;
- provenance verified;
- executable payload forbidden;
- authority `none`.

This proof does **not** enable Profile activation.

## Recovery proof

Before repository promotion:
1. create an encrypted recovery copy outside the repository;
2. restore it to a different temporary private-key path;
3. run `derive-trust` from the recovered copy;
4. require byte identity with the original public trust;
5. sign the same protocol-shaped Profile-content manifest with the recovered key;
6. verify using only the candidate public trust;
7. remove the temporary recovered private key according to operator custody policy.

Never record private-key bytes, private-key hashes, seeds, backup passwords or
encrypted backup contents.

## Public anchor pin

Only after generation, independent derivation, custody and recovery proof pass
may public trust be eligible for:

`system/trust/profile-content-ed25519.json`

Pinning means only:

```text
CANONICAL_PROFILE_CONTENT_TRUST_ANCHOR_PINNED=YES
```

It does **not** mean:

```text
PROFILE_CONTENT_PUBLISH_ALLOWED=YES
PROFILE_CONTENT_INSTALL_ALLOWED=YES
PROFILE_CONTENT_ACTIVATION_ALLOWED=YES
LEGAL_BR_PUBLIC_ALLOWED=YES
```

Those remain separate gates.

## Current state

Today:

```text
CANONICAL_PROFILE_CONTENT_TRUST_ANCHOR_PINNED=NO
PROFILE_CONTENT_PUBLISH_ALLOWED=NO
PROFILE_CONTENT_INSTALL_ALLOWED=NO
PROFILE_CONTENT_ACTIVATION_ALLOWED=NO
```

The signing protocol, immutable staging, structural health, install receipts,
inventory and Native Profile consent foundation exist in source. The operator
trust ceremony is the next identity gate and must never be replaced by a random
CI key.
