# Standalone Windows Desktop staging — verified source, no fork

This is a disposable packaging projection, not a second OS source and not the
new canonical Desktop repository yet. Its owner remains the Windows packaging code
in ordax-os until an explicitly gated cutover.

## Build flow

After the existing Windows CI mounts the pinned Surface, compiles the Native
bundle, writes its OS+Surface provenance, and prepares verified components:

    node tools/windows-desktop/standalone-stage.cjs <exact-OS-SHA>

The staging tool invokes the established Native provenance verifier and requires
the embedded OS SHA to match the exact requested Git revision. It takes only
the files already listed in tools/windows-desktop/package.json, honoring exact
exclusions. Unknown filters, source links, duplicate targets, mismatched bytes,
missing files, or an existing output destination fail closed.

The generated ignored out/windows-desktop-standalone directory contains:

- shell/: Electron source, NSIS include, lockfile, rewritten package manifest
  with exactly one local extraResources input.
- runtime-template/: verified OS/Surface and component payload projection.
- stage-manifest.json: per-file SHA-256 and bound OS source revision.

Same-volume hardlinks avoid copying large pinned model and engine bytes where
supported; a cross-volume copy fallback is allowed. No second Git authority,
persistent Surface fork, service, installer or update policy is created.

## Cutover gate

The Windows CI validates this projected input but continues generating the
existing NSIS installer unchanged. Only after a real Windows run of
electron-builder against the projected shell plus installed/upgrade/rollback
tests on isolated profiles should the build be switched over.

Do not edit MCP, Capability Fabric, Runtime, Platform or shared Surface here.

Unit tests (no network or model build):

    node --test tools/windows-desktop/standalone-stage.test.cjs
