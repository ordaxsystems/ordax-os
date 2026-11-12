# Runtime Composition

`system/composition/` is the thin wiring layer that joins the shared Surface to
the capability adapter for a runtime. It selects and connects implementations;
it does not own product screens, design tokens, or domain policy.

Current entry points are `web/` and `native/`. Both consume the shared product
source under `system/surface/` and the same contracts. The Native entry is the
OrdaX OS composition used by USB and the integrated Native-disk target. Its
screen structure and Meridian styling do not fork by USB, development, or
Stable/MVP profile; only genuine environment capabilities belong in adapters.

The Windows emulator embeds `system/composition/native/index.html` directly, so
it previews the Native composition rather than maintaining an emulator-owned
workspace. The First Run owner and its visual sources are recorded in
`docs/contracts/first-run.json`.

## How Native changes reach USB

The **Owner/Development USB** updates its sparse checkout of `/system/` from
`main` through the existing `ordax-pull` flow, then starts the Surface from that
checkout. A shared Surface change therefore reaches this profile through the
normal source update; no separate USB stylesheet or port is needed.

The **Stable/MVP USB** receives the same Native composition and Surface inside
the verified, signed `system.tar` release. A commit to `main` alone does not
change an already materialized MVP release: the exact source must pass through
the existing assembly, signing, publication, acquisition, and activation gates.
This source-level parity does not claim that a new public release or physical
USB acceptance has occurred.

Visual assets, design tokens, and reusable interaction behavior remain under
`system/surface/`. In particular, Meridian tokens are owned by
`system/surface/ui/meridian.tokens.css`; target compositions must reference that
shared source rather than copy it or introduce a mode-specific theme.

## Canonical Web presentation cutover — 2026-10-10

The approved Web workspace presentation lives under `system/surface/workspace`
and uses the official Web composition. Pending app interfaces are preserved.
Real service wiring remains capability-driven: presentation does not imply an
authenticated session, user files, inference, sync, package installation, or
remote-device access. Native operational UI, services, contracts, and public
Account remain separate capability wiring over the shared product source. See
`docs/DESKTOP-IDENTITY.md` and migration ledger 007. This is a source/candidate
change, not production activation.
