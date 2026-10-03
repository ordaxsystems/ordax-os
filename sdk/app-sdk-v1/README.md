# OrdaX App SDK contract bundle v1

This directory publishes the first machine-readable contract set intended for apps developed outside the platform source tree.

It is intentionally small. Version `1.0.0` exports only contracts already canonical on `main`:

- `ordax.component-manifest/1`
- `ordax.intelligence/1`
- `ordax.memory/1`
- `prototype-ordax.localization-pack/1`

The bundle is generated from canonical source contracts by `tools/app-sdk/export.py`. Each entry records the exact Git blob of the contract source and `bundle.sha256` pins the exported bundle bytes.

## Compatibility

Compatibility is by contract major, not by an unpinned `latest` OrdaX release. Product versions and ISO versions can evolve independently as long as the required contract majors remain supported.

## Authority

The SDK has `authority: none`.

It does not contain install authority, private keys, grants, provider credentials or implementation copies of Identity/Memory/Intelligence.

## Consumers

- `washingtonmsdj/ordax-apps` for official apps;
- future third-party/user app repositories;
- package/build tooling that needs a stable public compatibility target.

The first-party delivery contract from #1017 is intentionally not in bundle `1.0.0` because it is not yet canonical on `main`. Once integrated, adding it will require an explicit bundle version update rather than silently changing 1.0.0.
