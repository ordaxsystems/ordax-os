# Studio: availability and canonical app owner

## Status after the 2026-10-23 remove-first cleanup

- Canonical Studio product source owner: ordaxsystems/ordax-apps.
- OrdaX OS no longer bundles the old Studio git-app implementation or its fixed launch shortcuts.
- This removal does not publish, install, activate, or authorize any Studio package.
- Native verified component-slot inventory is the single authority for installed, healthy, compatible and signed apps.
- Generic host interfaces remain in their OS/runtime owners, separate from Studio product UI.

## Remaining integration gates

1. Publish a signed Studio package with executable entrypoint and compatibility descriptor in ordax-apps.
2. Verify Native/Web parity and package-origin isolation; do not copy Studio source into the OS.
3. Test activation, removal, rollback, offline reinstall and clean USB boot without the package.
4. Confirm Studio is absent from the installed inventory and default launchers until a verified slot is active.

Historical Studio host-panel design does not describe the current UI after remove-first cleanup.
