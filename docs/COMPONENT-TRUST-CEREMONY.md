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
policy JSON and four operator wrappers:

```text
1-Verify-OrdaXComponentTrustToolkit.cmd
2-Initialize-OrdaXComponentTrust.cmd
2-Resume-OrdaXComponentTrust.cmd
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

## Resume a preserved component key without generating another

If a previous ceremony produced a local component Ed25519 private key and two
byte-identical reviewed public JSONs, but the old toolkit failed to complete the
proof, use the **new official main-push toolkit** with:

```cmd
2-Resume-OrdaXComponentTrust.cmd
```

This is explicitly `-ResumeExistingKey` and mutually exclusive with
`-GenerateKey`. It requires the original local PEM, independently re-derives its
public identity, checks both prior public files byte-for-byte and refuses
missing/mismatched identities, unexpected directories, or redirected files.
The original PEM and prior review files remain unchanged. The new
`local-ai-service`/`bundled` proof, envelope and receipt are prepared under an
isolated staging directory and atomically published as
`review\\resumed-current-toolkit`. Re-running checks that receipt and signature,
without replacing them. The recovery wrapper from step 3 automatically uses
this reviewed directory and still requires a separate restored private file.

The new receipt names the **current toolkit source commit**, while recording
the previous review proof commit (when present) as **prior evidence**, not as the
origin of the older key. A successful resumed signature does **not** prove that
the private key was never exposed: review historical ACLs, physical custody,
encrypted offline backup and a demonstrated independent recovery before any
production decision. The local resume/recovery proof does not pin trust or
enable component publication, activation or physical writes.

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

The Windows toolkit performs a *protocol-shaped*, non-installable signing
proof for the OS-owned `local-ai-service` component, using
`source_repository=ordaxsystems/ordax-os`, `release_mode=bundled`, and
`version=0.0.0-trust-proof`. The artificial package binding is a signing
fixture only: it does **not** attest to a package ZIP or authorize component
publication/activation. The `internet` application belongs to
`ordaxsystems/ordax-apps` and must never be represented as an OS-owned
proof. The Go signer, recovery finalizer and public-handoff promoter enforce
the same source/component identity.

Separately, a future **real** `component-slot` application release requires
its correctly owned package, immutable artifacts, trusted source provenance,
external authorized signing, health probation and activation gates. The
candidate private key and reviewed public trust must match for any signing
proof. For a manually reviewed real-shaped release:

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

## Interrupted obsolete-toolkit identity

An identity generated by a toolkit whose source proof later failed is **not**
an operator-approved signing identity. The key may be preserved solely for
the explicit, offline technical resume and recovery tests described above;
those tests do not authorize production custody, pinning or distribution.
Do not pin or distribute this candidate key as production without separate
custody review and independent authorization.

On a shared Windows Desktop, first confirm there is no approved public trust
handoff, no canonical anchor pinned from the failed key, and no authorized
component publication. Use an isolated administrator-controlled session to
remove only the old toolkit-specific
`%LOCALAPPDATA%\\OrdaX\\ComponentTrust\\private\\runtime-component-private.pem`
and `%LOCALAPPDATA%\\OrdaX\\ComponentTrust\\review` contents after the
operator has confirmed they are the failed attempt, not files from a new
ceremony. Do not run broad deletion against `%LOCALAPPDATA%\\OrdaX`,
Windows profile data or unrelated installations. Deletion on SSD storage does
not guarantee forensic erasure; rely on full-disk encryption and any applicable
organizational sanitization policy. New production custody must happen on a
separate secure machine with the new main-push toolkit.

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
