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

## Transitive physical pre-consent binding

Changing the canonical bytes of `docs/contracts/minimal-bootstrap.json` also invalidated the exact byte binding held by `docs/contracts/physical-write-authorization.json`. Both `Foundation Contract` and `Physical Write Promotion` correctly failed closed because `test_real_preconsent_contract_hashes_match_current_repository_bytes` requires the pre-consent contract to match the current repository bytes.

The reconciliation therefore updates only `bindings.minimal_bootstrap_sha256` from the previous bootstrap-contract digest `a22d9963ee9d24dfb20810262e7d273fcdd3abb60522ad8da8b378e0345bb9d1` to the exact digest reported by the current-head promotion regression, `e6046970f92330fba0f1a14e8866fd81cc21bd5db33a03e4cb51216ca69a897b`. The release-trust, Portable USB, Creator Portable media-plan and canonical v4 release-proof bindings remain unchanged.

This is not an authorization grant: `physical_write_allowed` remains `false`, `explicit_owner_authorization` remains `false`, and `authorization_context_sha256` remains `null`. The evidence file is outside the destructive authorization-context source patterns, so recording this reconciliation does not alter that context.

`physical_write_allowed` also remains `false` in the minimal bootstrap contract. CI proof does not constitute physical notebook proof; a physical write/boot remains gated on positive identification of the removable USB target and must not touch an internal SSD/NVMe.
