# Owner/Development — Intelligence in the existing Supervisor transaction

This optional, fail-closed Owner adapter stages the externally pinned Intelligence source **inside the same disposable Supervisor slot** already used for the exact OS commit and Surface. There is no second updater, identity authority, Memory, release signer or channel.

The canonical bridge templates live at `system/services/intelligence-source/wrappers/`. The Native build-time compositor `tools/intelligence-source/compose.py` reads those exact five files; the Owner POSIX shell copies them from the signed/versioned OS candidate source into its disposable slot after validating the eight exact external Git blobs. Offline `ready` checks Git blob hashes, wrapper/template matches, the OS-commit template Git blobs and every file against a slot manifest. The live checkout and previous release remain untouched.

The existing Supervisor calls the adapter at staging, existing-slot reuse and canonical startup; its update mode forces a restart rather than unsafe hot reload when Intelligence is canonical. The adapter changes no behavior while `docs/contracts/intelligence-source.json` is `integration-candidate`. Before setting the source status to `canonical` and deleting the old tracked services, the Creator Owner/Dev **first cold boot must have a verified preseeded offline release slot**, and QEMU/USB health, updater, rollback and Buildroot availability must be proven. Otherwise the runtime cannot be promoted.

Stable/MVP uses signed v4 EROFS, not the Owner Git transaction. Its cutover and physical authorization remain independent gates, never inferred from the Owner tests.
