# Canonical Profile Content Trust Ceremony

Status: **SOURCE BOUNDARY READY — OPERATOR CEREMONY PENDING — NO CANONICAL PROFILE-CONTENT KEY PINNED**

This ceremony creates the trust identity used only to authenticate OrdaX
Knowledge Packs and Skill Packs. It is separate from whole-OS release trust,
runtime-component trust and application trust.

Machine-readable authority:

`docs/contracts/profile-content-trust-policy.json`

## Boundary

```text
external operator/signing host
  -> ordax-profile-content-channel generate-key
  -> external PKCS#8 Ed25519 private key
  -> first public trust derivation
  -> ordax-profile-content-channel derive-trust
  -> independent second public trust derivation
  -> encrypted recovery copy
  -> restored-key public derivation
  -> recovered-key signing + verify proof
  -> public-only reviewed handoff
  -> later explicit repository promotion of public trust only
```

The fixed first key id is:

```text
ordax-profile-content-v1
```

Future public anchor target:

```text
repository: system/trust/profile-content-ed25519.json
runtime:    /srv/ordax-system/trust/profile-content-ed25519.json
```

No private Profile-content signing key belongs in Git, an OrdaX USB/device,
a public artifact, Actions logs or chat.

## Trust separation

The Profile-content key must not reuse, alias or be derived from:

- whole-OS release trust;
- runtime-component trust;
- external app/test trust;
- a disposable CI key.

Publisher authority remains separate from Profile activation authority.

## Operator generation and independent derivation

Use a reviewed `ordax-profile-content-channel` binary on an operator-controlled
host. Generate the private key outside the repository:

```text
ordax-profile-content-channel generate-key \
  --private-key <external-private-path>/profile-content-private.pem \
  --trust <review-a>/profile-content-ed25519.json \
  --key-id ordax-profile-content-v1
```

Then independently derive the public anchor from the same private key into a
different empty review path:

```text
ordax-profile-content-channel derive-trust \
  --private-key <external-private-path>/profile-content-private.pem \
  --out <review-b>/profile-content-ed25519.json \
  --key-id ordax-profile-content-v1
```

Require byte-identical public trust documents. The derivation command must report
a 32-byte Ed25519 public-key SHA-256 and must continue to report:

```text
PROFILE_CONTENT_CANONICAL_ANCHOR_PINNED=NO
PROFILE_CONTENT_PUBLICATION_ALLOWED=NO
PROFILE_CONTENT_INSTALL_ALLOWED=NO
PROFILE_CONTENT_ACTIVATION_ALLOWED=NO
```

## Signing proof

Before an anchor is eligible for repository review, create a protocol-shaped
Knowledge Pack or Skill Pack with no requested capabilities, no runtime network
and no mutable host access. Sign the exact manifest with the candidate private
key and verify manifest + envelope + payload using only the candidate public trust.

A private/public mismatch, payload hash mismatch, payload size mismatch, malformed
provenance, executable authority, Skill tools or mutable authority must fail closed.

## Recovery proof

Before public anchor pinning can be considered:

1. create at least one encrypted recovery copy outside the repository;
2. restore one copy to a distinct temporary private-key path;
3. run `derive-trust` against the restored copy;
4. require byte identity with both earlier public derivations;
5. sign a second protocol-shaped Profile-content proof with the recovered key;
6. verify that proof using only the candidate public trust;
7. remove the temporary restored key according to operator custody policy.

Repository evidence must never contain private-key bytes, a private-key hash,
seed material, recovery password or encrypted backup contents.

## Public anchor pin is a separate future action

This source change does **not** perform the operator ceremony and does not pin a key.

Even after a reviewed public anchor is eventually pinned, the following remain
separate gates:

```text
PROFILE_CONTENT_PUBLISH_ALLOWED=NO
PROFILE_CONTENT_INSTALL_ALLOWED=NO
PROFILE_CONTENT_ACTIVATION_ALLOWED=NO
```

Pinning establishes only the canonical verification identity. Publication still
requires a reviewed publisher workflow; installation still requires verified
content acquisition/staging; activation still requires the independent Space,
Profile, provisioning receipt and activation policies.

## CI rule

CI may generate disposable Profile-content keys only to prove protocol behavior,
including independent public derivation. A CI key is never canonical and CI must
continue asserting that the production anchor is unpinned.

## Current state

```text
CANONICAL_PROFILE_CONTENT_TRUST_ANCHOR_PINNED=NO
PROFILE_CONTENT_PUBLICATION_ALLOWED=NO
PROFILE_CONTENT_INSTALL_ALLOWED=NO
PROFILE_CONTENT_ACTIVATION_ALLOWED=NO
```
