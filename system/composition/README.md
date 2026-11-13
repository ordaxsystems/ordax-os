# Runtime Composition

`system/composition/` is the thin OS wiring layer that joins **verified component inputs** to the capability adapter for a runtime. It selects and connects implementations; it does not own product screens, design tokens, removable app source or domain policy.

Current entry points are `web/` and `native/`. Both consume the **staged release tree** under `system/surface/` plus the same contracts. In source control, the visual `ui/` and `workspace/` bytes belong to `ordaxsystems/ordax-surface` and are materialized from the exact OS lock; only the host/runtime boundary remains OS-owned. The Native entry is the OrdaX OS composition used by USB and Native-disk targets. Visual structure does not fork by mode; only genuine environment capabilities belong in adapters.

The Windows emulator embeds `system/composition/native/index.html` directly, so
it previews the Native composition rather than maintaining an emulator-owned
workspace. The First Run owner and its visual sources are recorded in
`docs/contracts/first-run.json`.

## How Native changes reach USB

The **Owner/Development USB** updates its OS checkout through the existing `ordax-pull` flow and starts the Surface from the composed tree. A visual Surface revision reaches this profile **only after `ordax-os` adopts its exact external revision in the canonical lock/composition**; no USB-specific stylesheet, copied source or second Surface pin is needed.

The **Stable/MVP USB** receives the same Native composition and Surface inside
the verified, signed `system.tar` release. A commit to `main` alone does not
change an already materialized MVP release: the exact source must pass through
the existing assembly, signing, publication, acquisition, and activation gates.
This source-level parity does not claim that a new public release or physical
USB acceptance has occurred.

Visual assets, design tokens and reusable interaction behavior are **owned in `ordaxsystems/ordax-surface`**. The composed/staged tree exposes them at paths such as `system/surface/ui/meridian.tokens.css`; those release paths do not transfer source ownership to the OS. Target compositions must consume the verified staged bytes rather than copy them or create a mode-specific theme.

## Canonical Web presentation cutover — 2026-10-10

The approved Web workspace is materialized under `system/surface/workspace` in the composed tree and uses the official Web composition; its source owner is `ordaxsystems/ordax-surface`. Pending app interfaces are preserved.
Real service wiring remains capability-driven: presentation does not imply an
authenticated session, user files, inference, sync, package installation, or
remote-device access. Native operational UI, services, contracts, and public
Account remain separate capability wiring over the shared product source. See
`docs/DESKTOP-IDENTITY.md` and migration ledger 007. This is a source/candidate
change, not production activation.
