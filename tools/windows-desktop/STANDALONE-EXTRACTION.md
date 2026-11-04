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

Same-volume independent copy-on-write clones avoid copying large pinned model and engine bytes where
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

## CI cutover in this PR

The canonical Native compilation, verified OS+Surface provenance, and all
component source locks still come exclusively from their existing owners.
After staging, Windows CI installs the same pinned npm shell lock into the
isolated `out/windows-desktop-standalone/shell` and runs the **one** NSIS build
from there. The output path is unchanged, so the existing installed NSIS
smoke validates this candidate without producing a second release artifact.
Source files are **not hardlinked**: filesystem copy-on-write cloning is used
when available and normal file copies otherwise. The stage is disposable and
cannot mutate its OS input through a shared inode. No remote installer or
user profile is updated by this CI job.

The PR must remain Draft until the new Windows CI and inherited gates pass.
Do not remove the old build source before stable ownership transfers to
`ordaxsystems/ordax-desktop` and the Linux/Windows contract boundary is
verified end-to-end.

## Detached Owner/Dev candidate compilation

The installed Electron shell now owns the only Vite configuration needed for
new Git candidates (`vite-native-build.mjs` is included in `app.asar`). The
config is copied to a one-use directory under the candidate's ignored `out/`
folder and always cleaned up, including on compiler failure. It loads the exact
OS candidate from its own current working directory rather than deriving the
root from the config file path. This avoids importing any build policy from an
untrusted or obsolete OS commit.

The `ordax-os` sparse checkout now contains only the OS/contracts, evidence,
Native host and Surface-web inputs. It does **not** need
`tools/windows-desktop` for candidate compilation. The existing offline E2E
creates three real revisions of OS plus pinned Surface without any desktop tools
in their Git trees, compiles all three from the installed shell, verifies actual
activation/crash recovery and pins rollback. The same test executes once with
the workspace compiler and once with the installed NSIS compiler archive.

The OS root npm lock still owns the canonical Native dependency closure;
`runtime-toolchain.cjs` generates its verified offline archive at packaging
time. No second OS dependency manifest or Surface implementation is introduced.
