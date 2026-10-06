# Canonical Runtime Component Trust Ceremony

Status: **SOURCE FOUNDATION READY — OPERATOR CEREMONY PENDING — NO CANONICAL COMPONENT KEY PINNED**

This ceremony creates the trust identity used to authenticate independently
updated OrdaX runtime components such as Internet. It is intentionally separate
from whole-OS release trust.

Machine-readable authority:

`docs/contracts/runtime-component-trust-policy.json`

## Boundary

```text
external operator/signing host
  -> ordax-runtime-component-channel generate-key
  -> external PKCS#8 Ed25519 private key
  -> reviewed public runtime-component trust JSON
  -> encrypted recovery copy
  -> independent public derivation
  -> recovered-key signing proof
  -> public-only handoff
  -> repository pin of public trust only
```

The fixed first component key id is:

```text
ordax-runtime-components-v1
```

The future public anchor target is:

```text
repository: system/trust/runtime-components-ed25519.json
runtime:    /srv/ordax-system/trust/runtime-components-ed25519.json
```

No private component-signing key belongs in Git, the OrdaX USB, a public build
artifact, CI logs or chat.

## Trust separation

The component key must **not** reuse, copy or alias the whole-OS release key.

This separation allows the OS release authority and component publication
authority to evolve independently. Compromise or rotation of one trust domain
must not silently grant authority in the other.

CI may create disposable component keys only for protocol tests. A disposable
CI key can never satisfy the canonical component-trust gate.

## Windows operator toolkit

After this toolkit source is merged, use only the artifact produced by an
eligible **push of `main`**. Pull-request and manual-dispatch artifacts remain
review/test artifacts and are not eligible to create the canonical identity.

The toolkit contains the signer, provenance, this ceremony document, the exact
policy JSON and three operator wrappers:

```text
1-Verify-OrdaXComponentTrustToolkit.cmd
2-Initialize-OrdaXComponentTrust.cmd
3-Verify-OrdaXComponentTrustRecovery.cmd <restored-private-key-path>
```

Step 1 is read-only and must report:

```text
COMPONENT_TRUST_TOOLKIT_PREFLIGHT=PASS
CANONICAL_COMPONENT_TRUST_CEREMONY_ELIGIBLE=YES
TOOLKIT_COMPONENT_HASHES_VERIFIED=YES
PRIVATE_KEY_TOUCHED=NO
FILESYSTEM_MUTATION=NO
```

Step 2 is the only wrapper that supplies the explicit `-GenerateKey` switch.
It writes the private key and review material under the operator's local
`%LOCALAPPDATA%\OrdaX\ComponentTrust\...` paths by default, outside the
toolkit/repository. It performs independent public derivation and a
protocol-shaped signing/verification proof, then stops with:

```text
OFFLINE_RECOVERY_VERIFIED=NO
READY_TO_PIN_PUBLIC_ANCHOR=NO
```

After creating an encrypted backup and restoring one copy to a **different**
temporary private path, step 3 derives the public key from the restored copy,
re-verifies the initial proof bytes, creates a recovered signing proof and
builds the public-only:

```text
OrdaX-Component-Public-Trust-Handoff.zip
```

Only then may it report `READY_TO_PIN_PUBLIC_ANCHOR=YES`. The toolkit does not
pin the anchor automatically and does not enable publication or activation.

## Required ceremony

The ceremony is an explicit operator action. Source support does not make a key
canonical.

Using a reviewed `ordax-runtime-component-channel` binary bound to an exact
reviewed source commit, generate the private key outside the repository:

```text
ordax-runtime-component-channel generate-key \
  --private-key <external-private-path>/runtime-component-private.pem \
  --trust <review-path>/runtime-components-ed25519.json \
  --key-id ordax-runtime-components-v1
```

Then derive the public trust independently into a second empty review path:

```text
ordax-runtime-component-channel derive-trust \
  --private-key <external-private-path>/runtime-component-private.pem \
  --out <second-review-path>/runtime-components-ed25519.json \
  --key-id ordax-runtime-components-v1
```

Require byte-identical public files and a 32-byte Ed25519 public key.

## Signing proof

Before pinning the public anchor, create a real-shaped test component package and
release descriptor using `release_mode=component-slot`. Sign it with the
candidate private key while supplying the candidate public trust explicitly:

```text
ordax-runtime-component-channel sign \
  --release runtime-component-release.json \
  --private-key <external-private-path>/runtime-component-private.pem \
  --trust <review-path>/runtime-components-ed25519.json \
  --key-id ordax-runtime-components-v1 \
  --out runtime-component-envelope.json

ordax-runtime-component-channel verify-envelope \
  --envelope runtime-component-envelope.json \
  --trust <review-path>/runtime-components-ed25519.json
```

A private/public mismatch must fail closed.

## Recovery proof

Before the public anchor becomes eligible for Git:

1. create at least one encrypted recovery copy outside the repository;
2. restore a copy to a distinct temporary private path;
3. derive public trust from the restored copy;
4. require byte identity with both earlier public derivations;
5. sign a second protocol-shaped component release with the recovered key;
6. verify that envelope using only the candidate public trust;
7. remove the temporary restored private key according to the operator custody procedure.

The repository records only non-secret evidence. Never record private key bytes,
a private-key hash, seed, recovery password or encrypted backup contents.

## Public anchor pin

Only after generation, independent derivation, custody and recovery proof pass
may the reviewed public JSON be committed at:

`system/trust/runtime-components-ed25519.json`

Pinning the public anchor means only:

```text
CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED=YES
```

It does **not** mean:

```text
COMPONENT_PUBLISH_ALLOWED=YES
COMPONENT_SLOT_ACTIVATION_ALLOWED=YES
PHYSICAL_WRITE_ALLOWED=YES
```

Publication still requires a reviewed signing workflow. Production activation
still requires pending probation execution, runtime health, atomic promote and
rollback proof. Physical USB authorization remains a completely separate gate.

## Repository public promotion

After step 3 has produced `OrdaX-Component-Public-Trust-Handoff.zip`, repository
promotion is a separate public-only operation. The promoter never accepts a
private key:

```text
tools/runtime-component-channel/promote_public_trust.py
```

First run read-only validation with the reviewed runtime-component verifier:

```text
python tools/runtime-component-channel/promote_public_trust.py check \
  --promotion-zip OrdaX-Component-Public-Trust-Handoff.zip \
  --verifier <path-to-ordax-runtime-component-channel>
```

The check must re-verify the recovered envelope, exact four-file ZIP set,
ceremony hashes, source commit, key id and fail-closed repository contracts.

Only after review may the same public handoff be applied:

```text
python tools/runtime-component-channel/promote_public_trust.py apply \
  --promotion-zip OrdaX-Component-Public-Trust-Handoff.zip \
  --verifier <path-to-ordax-runtime-component-channel>
```

Apply may pin only public trust/evidence and update the trust/package contracts.
It must keep all of these false:

```text
COMPONENT_PUBLISH_ALLOWED=NO
PRODUCTION_COMPONENT_SLOT_ACTIVATION_ALLOWED=NO
PHYSICAL_WRITE_ALLOWED=NO
```

A pinned component anchor therefore enables signature verification against the
canonical identity, not production update activation.

## External app signing preflight

External first-party apps such as Notes are produced in `ordax-apps`, not in
the OrdaX OS repository. The source repository emits a deterministic,
authority-free handoff first; the platform verifies that handoff before it can
be considered eligible for external signing.

The read-only preflight is:

`tools/runtime-component-channel/check_external_signing_preflight.py`

It performs these checks in order:

1. re-validate the unsigned candidate ZIP, release descriptor, compatibility
   sidecar, source repository/commit and `SHA256SUMS`;
2. require the component's canonical external source repository from platform
   policy;
3. require the canonical `runtime-components` public anchor to be genuinely
   pinned and byte/hash/key-id consistent;
4. require component publication to be explicitly authorized;
5. keep production component-slot activation independent and allowed to remain
   false.

Example:

```text
python tools/runtime-component-channel/check_external_signing_preflight.py \
  --candidate-dir <public-unsigned-candidate-directory>
```

Before the operator ceremony/publication transition is completed, a valid
candidate must report a safe blocked state:

```text
RUNTIME_COMPONENT_EXTERNAL_SIGNING_PREFLIGHT=PASS
SIGNING_ELIGIBLE=NO
BLOCKER=canonical-runtime-component-trust-anchor-not-pinned
BLOCKER=component-publication-not-authorized
PRIVATE_KEY_READ=NO
SIGNING_PERFORMED=NO
```

The preflight never accepts a private-key path. It does not sign or publish.
When a future reviewed policy transition makes `SIGNING_ELIGIBLE=YES`, the
actual private-key operation still occurs only on the external signing host.

## Production readiness check

The platform exposes one read-only checker:

`tools/runtime-component-channel/check_production_readiness.py`

It does not mutate policy, publish components, activate slots or carry authority.
It verifies that the runtime-component trust policy and package policy agree on
the three ordered production gates:

1. canonical component trust anchor pinned;
2. component publication authorized;
3. production component-slot activation authorized.

It fails closed if publication is enabled before trust, activation is enabled
before publication, or the package policy disagrees with the trust policy. When
activation is authorized it also requires the runtime package capabilities for
pending-health promotion, rollback and Native slot serving to be available.

This checker is intended to be run before and after each explicit operator
transition so apps such as Notes can consume one platform-consistent production
state instead of inferring readiness from isolated flags.

## Current state

Today:

```text
CANONICAL_COMPONENT_TRUST_ANCHOR_PINNED=NO
COMPONENT_PUBLISH_ALLOWED=NO
PRODUCTION_COMPONENT_SLOT_ACTIVATION_ALLOWED=NO
```

The signed component protocol, immutable slots, activation state machine and
verified runtime-file reader exist in source. The operator trust ceremony is the
next identity gate; it must not be silently replaced by a random CI key.
