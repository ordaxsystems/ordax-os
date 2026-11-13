# Third-Party Input Inventory

Status: DECLARED INPUTS TRACKED / NOT A RELEASE SBOM

The repository now tracks the external inputs that OrdaX explicitly selects before a final image is assembled.

This inventory exists to make later license and source-compliance work deterministic. It is deliberately narrower than an SBOM.

## What is tracked today

`platform/compliance/declared-inputs.json` records source-controlled third-party selections, including:

- the pinned Linux kernel source archive from `bootstrap/kernel/source.json`;
- the independent Buildroot/musl Base source owner at `bootstrap/independent-base/source.json`;
- the Buildroot/musl native Surface runtime source contract at `bootstrap/surface-runtime/source.json`;
- other source candidates that already participate in pre-release compliance preparation.

The Independent Base entry deliberately does not duplicate Buildroot package versions. Its pinned Buildroot archive and `build_profile` remain owned by `bootstrap/independent-base/source.json`, while the selected package graph is owned by the Buildroot configs. The focused compliance test proves selected capabilities while build provenance/receipts resolve actual package versions. Final package/license closure still comes from shipped bytes, not this declared-input inventory.

Retired Alpine Development/Stable inputs are intentionally absent from the machine-readable inventory. Reintroducing an Alpine/APK source or package resolver would be a new third-party input and must fail the existing retirement gates rather than being treated as compatibility.

## What this is not

This file is **not** the final list of everything shipped to a user.

Package managers can resolve transitive dependencies, firmware can carry separate terms, and final release composition can differ by target. The final SBOM must therefore be generated from the bytes/packages actually present in the release artifact.

The declared-input inventory is an earlier control:

```text
source-selected external inputs
 -> build
 -> final shipped bytes/packages
 -> release SBOM
 -> license/notice resolution
 -> source-compliance bundle
 -> public release gate
```

## License fields

License identifiers are intentionally unresolved in this inventory.

That is safer than copying assumptions into a machine-readable file. Before a public release, license metadata must be resolved against the exact final component versions and captured in the real SBOM/notices workflow.

The kernel entry references `bootstrap/kernel/source.json` and never re-authors
its version, source URL or digest. The CI test validates that source owner and
checks other declared input versions/packages against their respective owners.
It also rejects adding an SPDX identifier while a license remains unresolved.

## Machine-readable contract

See `docs/contracts/third-party-inventory.json`.

Public release requirements remain owned by `docs/RELEASE-COMPLIANCE.md` and `docs/contracts/release-compliance.json`.
