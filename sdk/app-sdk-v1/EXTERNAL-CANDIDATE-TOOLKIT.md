# External candidate verifier toolkit

The App SDK publishes the read-only verifier used to validate unsigned external first-party component candidates before any platform signing or activation step.

## Canonical files

- `verify_unsigned_candidate.py` — canonical verifier implementation.
- `runtime-component-package-policy.json` — public SDK snapshot of the package policy consumed by that verifier.

The historical platform path `tools/runtime-component-channel/verify_unsigned_candidate.py` is a repository compatibility symlink to the SDK verifier. It is not a second implementation or authority owner.

The policy snapshot is byte-identical to `docs/contracts/runtime-component-package.json` for this SDK release. CI rejects drift between the two files, so external consumers do not need to import or copy private platform implementation code.

## Usage

From a checkout or vendored copy of `sdk/app-sdk-v1`:

```bash
python3 verify_unsigned_candidate.py \
  --candidate-dir /path/to/candidate \
  --package-policy runtime-component-package-policy.json
```

The candidate directory must contain the deterministic package, release descriptor, compatibility descriptor, unsigned handoff, and `SHA256SUMS` expected by the verifier.

## Authority boundary

This toolkit is verification-only. It does not read private keys and cannot sign, publish, install, stage, promote, rollback, or activate components. A successful verification result means only that the unsigned candidate matches the public package/handoff contract. Production trust, publication authorization, component-slot activation, health/probation, promotion, rollback, and installed inventory remain platform-owned gates.

The toolkit therefore remains compatible with App SDK `authority: none`.
