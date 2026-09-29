# Canonical Profile Content Trust Ceremony

Status: **SOURCE FOUNDATION READY — OPERATOR CEREMONY PENDING — NO CANONICAL PROFILE CONTENT KEY PINNED**

Esta cerimônia cria a identidade de confiança usada para autenticar **Knowledge Packs** e **Skill Packs** do OrdaX. Ela é deliberadamente separada da chave de release do sistema, da chave de Runtime Components e de qualquer chave de apps externos.

Autoridade machine-readable:

`docs/contracts/profile-content-trust-policy.json`

## Boundary

```text
external operator/signing host
  -> ordax-profile-content-channel generate-key
  -> external PKCS#8 Ed25519 private key
  -> reviewed public Profile Content trust JSON
  -> independent derive-trust into a second empty review path
  -> byte-identical public trust proof
  -> protocol-shaped signed Profile content manifest
  -> encrypted recovery copy outside repository/device
  -> restore to a distinct temporary private-key path
  -> derive-trust again and require byte identity
  -> recovered-key signing proof
  -> public-only handoff
  -> repository pin of public trust only
```

The fixed v1 key id is:

```text
ordax-profile-content-v1
```

Future public anchor target:

```text
repository: system/trust/profile-content-ed25519.json
runtime:    /srv/ordax-system/trust/profile-content-ed25519.json
```

No private Profile Content key belongs in Git, the OrdaX USB, CI artifacts, logs or chat.

## Trust separation

The Profile Content key must not reuse or alias:

- whole-OS release trust;
- Runtime Component trust;
- external-app test/publisher trust;
- disposable CI Profile keys.

Compromise or rotation of one domain must not grant authority in another.

## Required operator ceremony

Use a reviewed `ordax-profile-content-channel` binary bound to an exact reviewed source commit.

Generate the private key outside the repository:

```text
ordax-profile-content-channel generate-key \
  --private-key <external-private-path>/profile-content-private.pem \
  --trust <review-path-a>/profile-content-ed25519.json \
  --key-id ordax-profile-content-v1
```

Independently derive the public trust into a second empty review directory:

```text
ordax-profile-content-channel derive-trust \
  --private-key <external-private-path>/profile-content-private.pem \
  --out <review-path-b>/profile-content-ed25519.json \
  --key-id ordax-profile-content-v1
```

The two public files must be byte-identical and contain exactly one 32-byte Ed25519 public key.

## Signing proof

Create a non-regulated, non-authorizing proof manifest with:

- kind `knowledge-pack` or `skill-pack`;
- no requested capabilities;
- runtime network disabled;
- mutable host access disabled;
- content owned by the OrdaX project, not legal/medical/professional source material.

Sign it:

```text
ordax-profile-content-channel sign \
  --manifest profile-content-trust-proof-manifest.json \
  --private-key <external-private-path>/profile-content-private.pem \
  --trust <review-path-a>/profile-content-ed25519.json \
  --key-id ordax-profile-content-v1 \
  --out profile-content-trust-proof-envelope.json
```

Verify the signature using public trust only:

```text
ordax-profile-content-channel verify-envelope \
  --manifest profile-content-trust-proof-manifest.json \
  --envelope profile-content-trust-proof-envelope.json \
  --trust <review-path-b>/profile-content-ed25519.json
```

A private/public mismatch or modified manifest must fail closed.

## Recovery proof

Before the public anchor becomes eligible for Git:

1. create at least one encrypted recovery copy outside the repository;
2. restore one copy to a different temporary private-key path;
3. run `derive-trust` from the restored key;
4. require byte identity with both original public derivations;
5. sign the same protocol-shaped proof manifest with the restored key;
6. verify that recovered envelope using only the candidate public trust;
7. remove the temporary restored private key according to operator custody procedure.

Repository evidence must never contain:

- private-key bytes;
- private-key hash or seed;
- recovery password;
- encrypted backup contents;
- any secret material.

## Public-only handoff

After recovery succeeds, the operator may create a handoff containing only reviewed public material. The future repository promoter must reject secret-looking files and accept no private-key argument.

Pinning the public anchor will mean only:

```text
CANONICAL_PROFILE_CONTENT_TRUST_ANCHOR_PINNED=YES
```

It must **not** mean:

```text
PROFILE_CONTENT_PUBLISH_ALLOWED=YES
PROFILE_CONTENT_INSTALL_ALLOWED=YES
PROFILE_CONTENT_ACTIVATION_ALLOWED=YES
STABLE_PROFILE_MUTATION_ALLOWED=YES
PHYSICAL_WRITE_ALLOWED=YES
```

Publication of a canonical Developer component, installation policy and activation remain separate promotion gates.

## Current state

Today:

```text
CANONICAL_PROFILE_CONTENT_TRUST_ANCHOR_PINNED=NO
PROFILE_CONTENT_PUBLISH_ALLOWED=NO
PROFILE_CONTENT_INSTALL_ALLOWED=NO
PROFILE_CONTENT_ACTIVATION_ALLOWED=NO
STABLE_PROFILE_MUTATION_ALLOWED=NO
```

CI disposable keys prove the protocol but can never satisfy this ceremony.
