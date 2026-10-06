# External runtime-component signing preflight

This document defines the read-only boundary immediately before an external
runtime-component signing host may be considered eligible to sign a verified
first-party application candidate.

The boundary does **not** sign, publish, install, stage, promote, roll back or
activate a component. It does not accept a private-key path and it does not read
private key material.

## Canonical flow

External first-party applications such as Notes are produced in
`washingtonmsdj/ordax-apps`. The source repository emits a deterministic,
authority-free unsigned candidate. The OrdaX platform then performs:

1. unsigned candidate verification through
   `tools/runtime-component-channel/verify_unsigned_candidate.py`;
2. canonical trust/publication readiness validation through
   `tools/runtime-component-channel/check_production_readiness.py`;
3. public trust-anchor validation when the canonical anchor gate is pinned;
4. an explicit signing-eligibility decision through
   `tools/runtime-component-channel/check_external_signing_preflight.py`.

The preflight reuses the existing package policy and trust policy. It does not
create a second source-repository policy, trust store, updater or activation
path.

## Required invariants

- the unsigned candidate must already pass the canonical candidate verifier;
- the component source repository must match platform policy;
- the `runtime-components` trust domain and key id must match canonical policy;
- publication can never be eligible before the canonical public trust anchor is
  pinned;
- a pinned anchor must be a regular non-symlink file with exact SHA-256,
  schema, key id and 32-byte Ed25519 public key;
- production activation remains an independent gate and may remain disabled
  while signing/publication becomes eligible;
- absence of trust/publication authority is a valid blocked-safe state, not a
  reason to fall back to another trust path.

## Current expected state

Until the operator ceremony and publication transition are completed, a valid
candidate is expected to report:

```text
RUNTIME_COMPONENT_EXTERNAL_SIGNING_PREFLIGHT=PASS
SIGNING_ELIGIBLE=NO
BLOCKER=canonical-runtime-component-trust-anchor-not-pinned
BLOCKER=component-publication-not-authorized
PRIVATE_KEY_READ=NO
SIGNING_PERFORMED=NO
PUBLICATION_PERFORMED=NO
INSTALLATION_PERFORMED=NO
ACTIVATION_PERFORMED=NO
```

A future reviewed policy transition may make `SIGNING_ELIGIBLE=YES` while
`PRODUCTION_ACTIVATION_ALLOWED=NO`. That state is intentional: signing and
publication authority remain separate from runtime activation authority.

## CI proof

`.github/workflows/runtime-component-external-signing-preflight.yml` runs the
preflight regression suite whenever the verifier, readiness checker, trust/package
policies or preflight implementation change.

The existing unsigned-candidate workflow remains responsible for proving the
real cross-repository handoff. The preflight gate consumes that canonical
contract instead of duplicating the cross-repository build pipeline.
