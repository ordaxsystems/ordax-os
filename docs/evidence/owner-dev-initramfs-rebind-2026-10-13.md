# Owner/Development initramfs rebind — 2026-10-13

## Trigger

PR #1763 changed the generated initramfs bytes to add the Owner/Development removable-media root guard. The Owner-only path requires the removable `ORDAX-ESP` + `ORDAX` pair before any writable root mount; the non-Owner/Stable discovery path was intentionally left unchanged.

## Failure that detected the stale binding

`Full Bootstrap Media Proof` run `38499051021`, job `115641387119`, built all owners successfully and then failed closed in `Assemble full bootstrap payload` because the generated initramfs SHA-256 no longer matched the pinned contract:

- previous pinned SHA-256: `774a6f659eb217503cc44e65cc98e36edb22d93cbfede8a719c3eede7d8c2a3f`
- generated SHA-256: `b2caad212533d1010229728130bad94c15373def29acee6e12836c50810208be`

The assembler validation is correct and remains unchanged.

## Reconciliation

The current generated digest is rebound consistently in the existing canonical owners:

- `docs/contracts/minimal-bootstrap.json`
- `system/base-update/candidate.json`
- `tests/test_mvp_seed_artifact_bindings.py`

No kernel binding, boot code, initramfs source, Creator write policy, or Stable behavior is changed by this reconciliation.

`physical_write_allowed` remains `false` in the minimal bootstrap contract. CI proof does not constitute physical notebook proof; a physical write/boot remains gated on positive identification of the removable USB target and must not touch an internal SSD/NVMe.
