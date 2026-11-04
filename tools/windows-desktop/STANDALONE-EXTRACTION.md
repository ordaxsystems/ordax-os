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

The Windows CI now generates its one NSIS installer from this projected
shell, after installing the locked Electron dependencies. The isolated NSIS
install, same-version upgrade, compiled Dev update/rollback and startup proof
are validated in the current Windows workflow. An old-to-new release upgrade
still needs a dedicated gate before any public release.

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

## Reattestation after copying source bytes

The staging tool verifies canonical Native/Surface provenance both **before**
copying the OS-owned sources and **inside the copied runtime-template** before
publishing the disposable stage. The second check calls the existing
`verifyBundledNativeReceipt` implementation with the staged Surface lock and
compiled Native assets. A matching standalone file manifest cannot replace
this authority: altered bytes, copy races, or mismatched receipts must fail
closed before NSIS. The original OS inputs and installed Desktop remain
untouched.


## Handoff-ready source split (no second live implementation)

The staging tool also supports a **detached, exact Git checkout** of the future
`ordaxsystems/ordax-desktop` as the shell owner:

    node standalone-stage.cjs <OS_SHA> --os-root <absolute-OS-directory> \
      --desktop-root <absolute-Desktop-directory> --desktop-sha <DESKTOP_SHA>

The detached shell must be at the canonical Git repository root, have the
official origin, match the exact supplied commit and contain no modified or
untracked files. Only Electron package files (and its one npm lock) are taken
from that source. All build.extraResources paths are resolved relative to the
unchanged OS checkout layout, so the Native runtime, Surface lock, engine,
models and trust contracts retain their OS ownership. The output manifest
records both the OS SHA and Desktop SHA. No copying of OS source into the
Desktop Git repository is needed.

This is a gated extraction contract, not an authorization to publish a
replacement installer or delete the original tools/windows-desktop tree.
The actual repository migration still requires CI pinned to both SHAs,
real Windows installed upgrade/rollback proof, and one-way removal of the
superseded source after its owner verifies the cutover.


## Two-source Git trust gate

In detached mode, both inputs must now be official, clean Git checkout roots.
The OS checkout HEAD must equal the specified OS SHA, and the Desktop checkout
HEAD must equal the specified Desktop SHA. Generated build output must remain
Git-ignored; it is verified by the existing Native provenance receipt.
The Desktop file list is also checked against Git's tracked-file index: an
untracked, Git-ignored JS file cannot be smuggled into a build solely by listing
it in package.json. Tests exercise both SHA mismatches, dirty OS source and
ignored Desktop source rejection. This strengthens a future two-repository cutover
without creating a second source owner, release channel or installer.

## Installed source-boundary audit

The *existing* `stage-manifest.json` is also installed as
`resources/runtime-template/docs/evidence/desktop-stage-manifest.json`.
This is a read-only audit record, **not** an independent authority for OS,
Surface, signatures or capabilities. The Windows installed-NSIS smoke compares
its OS SHA with the canonical Native provenance and its Surface SHA with the
OS-pinned lock. In detached mode the record also reports the exact Desktop
commit and correctly identifies `ordax-desktop` as shell/product owner, while
`ordax-os` remains runtime owner. The staging verifier forbids an OS
resource from shadowing this reserved receipt destination.

## Exact committed Desktop bytes

In detached mode, the wrapper also checks the Git **blob object** of every
listed shell source, `package.json`, `installer.nsh` and lockfile against
`HEAD:<path>`. This prevents a Git `assume-unchanged` flag from hiding
modified local code even when `git status` reports a clean checkout. The
actual bytes of each copied shell file are checked against the same pinned Git
blob again *after* the copy, before the stage is committed. These checks reuse
Git's SHA-1 object format only to bind local bytes to the pinned Git revision;
the stage manifest continues recording SHA-256 for packaged files. A mismatch
fails closed with no published stage.
