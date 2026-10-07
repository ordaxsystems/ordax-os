# Foundation security audit — 2026-10-07

Status: SOURCE AUDIT EVIDENCE / NOT A RELEASE OR PHYSICAL AUTHORIZATION

The audit started from fetched remote `main` at
`6fa535b94d53f9d90acb851fb105aca93a73919f` and incorporated concurrent remote
changes through `47ded213764f9f798c2c1422dc610a1a1b2ce780`. Work is isolated in
`codex/audit-foundation`, PR #1326. Existing public-site working changes were not
edited. Store acquisition/staging PRs #1319–#1323 and Account export PR #1306
were inspected for overlap rather than reimplemented.

This is a first completed correction batch, not an exhaustive certification of
the OS, all dependencies, all RPCs or hardware. Canonical owners and gates retain
authority; this evidence file creates no parallel security policy.

## Order and source graph

The useful starting point was the verified-release/activation boundary immediately
after the fixed kernel/initramfs: boot selection and persistent recovery decide
which source reaches every service and app. The review then followed the Native
host's credential/session boundary and the existing app lifecycle trust gates.

```text
Portable PID1 -> signed exact release verification -> immutable system mount
             -> Stable Init -> guardian -> supervisor -> Native Surface host
                                                        -> shared composition/apps

Transitional bootstrap -> stored current revalidation -> system entrypoint
```

The kernel recipe/environment was checked without rebuilding the kernel. No new
service manager, permission framework, app inventory or Store executor was added.

## Confirmed defects and corrections

| Finding | Before | Root correction and owner | Regression evidence |
| --- | --- | --- | --- |
| F01 — Portable recovery loses an intact fallback | A structurally present `current` whose signature/hash failed went directly to recovery. A missing/damaged armed candidate failed selection before rejection. | `portable_init.sh` independently resolves and exactly verifies `known-good` after failed current verification. `portable_state.c` durably rejects a structurally damaged candidate only after transaction/slot identities and the previous release validate. No slot retargeting or transaction-identity bypass. | Selector tests reproduce four failures against the original remote source. Dynamic C tests cover missing image, bad EROFS magic and symlink substitution before/after the one-shot attempt. |
| F02 — Local credential corruption opens the session | `os.path.isfile()` treats a dangling link or directory as no credential; GET could clear a live lock after credential loss. Credential reads followed links and were unbounded. | `native_host_server.py` has one no-follow presence owner, retains live lock authority, pins the opened regular file, checks UID/mode/link count/identity/byte bound and refuses unsafe bytes before authentication. The existing authenticated transitions remain the only way to clear a live lock. | Real HTTP tests reproduce two failures against original source. Positive scrypt unlock/removal, special files, unsafe permissions, oversized/invalid UTF-8 bytes, unreadable paths and opening-time replacement are covered. |
| F03 — Transitional offline boot trusts mutable current | The bootstrap executed an executable current tree without verifying stored signature, artifact or extracted files again. | `bootstrap/entrypoint` calls the existing `activate-exact` verifier with the already selected current SHA, then confirms the pointer still identifies that SHA before execution. This existing operation is idempotent for current; no second crypto implementation or new CLI is introduced. Missing verifier/failure enters recovery. | Four dynamic handoff tests fail against original source and pass after correction. Existing Go tests prove exact activation idempotence and rejection of signed-envelope/artifact/tree tampering without current replacement. |
| F04 — HTTP method dispatch bypasses ingress policy | Inherited HEAD served static responses to foreign/duplicate Host headers; unsupported methods and HEAD on native API paths bypassed the canonical ingress decision. This was a header-policy bypass, not proof of token or mutation access through HEAD. | `NativeHostHandler.parse_request()` applies the existing trust policy once before any method dispatch. Thin App Data handlers inherit this owner; repeated per-method ingress checks are removed. | Four real HTTP regressions fail before correction; trusted HEAD/GET and normal unsupported-method behavior remain covered alongside foreign origin, rebinding alias and duplicate Host rejection. |

The third correction also refreshes the source-owned orchestrator SHA-256 in
`minimal-bootstrap.json`. Explicit LF rules for the byte-pinned entrypoint and
product-mode marker prevent Windows checkout line endings from invalidating their
canonical hashes. The local-session machine-readable contract records the actual
reader policy and maximum file bytes in the same change.

The session correction protects the Surface session only. It does not claim
storage encryption or protection against an operator rewriting an offline USB.

## Validation boundary

- Initial correction: Linux Foundation run `37593513429` passed **2,530 tests**
  with one unrelated skip, including dynamic compilation/execution of the C helper.
- Boot/session batch: Linux Foundation run `37595838276` passed **2,543 tests**;
  release-agent run `37596225489` independently passed the full Go protocol suite
  and static candidate build at the same commit. The subsequent HTTP-dispatch
  correction has its own directed regressions and requires the final PR checks.
- Directed local validation: five Portable selector tests, seven handoff contract
  tests, sixteen Stable activation regressions, four transitional handoff tests,
  twelve minimal-bootstrap contracts and three JS session-contract tests passed.
- Native credential/session tests run under the existing Linux test environment
  and use real loopback HTTP plus disposable private state. Windows is not used to
  assert POSIX ownership/mode semantics.
- JSON contract discovery and module-boundary/build checks are applied to the
  final change; the PR's final commit checks remain the current CI authority.
- Test doubles exist only at external verification/state boundaries in selector
  unit tests. Production code uses the existing actual verifier and state owners.

```text
TARGET=source + disposable test files + test-only loopback listeners
PHYSICAL_WRITE=NO
PHYSICAL_REBOOT=NO
PRIVATE_KEY_OR_TOKEN_ACCESS=NO
PUBLIC_RELEASE_OR_STORE_ACTIVATION=NO
PHYSICAL_RECOVERY_PROOF=UNCHANGED_PENDING
```

## Remaining work, in dependency order

1. **Kernel security maintenance before public promotion.** Source remains pinned
   to Linux **6.6.52** without a security-backport series in its recipe. On the audit
   date, the official [kernel release index](https://www.kernel.org/) lists
   **6.6.158** for the same maintained branch. Reproducible bytes do not establish
   current security coverage. Review the full maintained patch line, actual generated
   configuration and driver compatibility; update source hash/recipe/contracts with
   repeat-digest and boot/recovery proof. This audit does not assert exploitability
   of any particular CVE. The kernel project's [CVE guidance](https://docs.kernel.org/process/cve.html)
   requires use-case applicability assessment and recommends the integrated stable
   fixes rather than isolated cherry-picks.
2. **Process and application isolation before public component activation.** The
   Native launcher currently starts the Python host and graphical host as root
   inside the runtime chroot. Separate WebKit contexts and receipt-bound App Data
   are present, but are not themselves a demonstrated per-app OS sandbox or a
   per-app authorization boundary for every host API. Review the actual WebKit
   sandbox, UID/process split, inherited FDs, filesystem/network exposure and
   capability enforcement before loading untrusted/public apps. Do not infer an
   exploit from root UID alone or claim isolation from a chroot alone.
3. **Release filesystem confinement and IPC robustness.** The release agent uses
   path-based filesystem operations; `ensureDir()` validates the final directory
   after `MkdirAll`, rather than pinning every storage operation to a confined root.
   Review ancestor substitution/races across acquisition, reuse and verification
   with descriptor/root-bound adversarial tests. Review body framing, timeouts and
   concurrency bounds at the Native listener as an independent trust boundary.
   These are investigation targets, not vulnerabilities certified by this batch.
4. **Finish existing app lifecycle gates without a parallel Store.** Manifests,
   presentation catalog, signed catalog verifier/watermark, component trust and
   pending-health/promotion/rollback already have owners. Public component trust is
   still unpinned and the Native production executor remains gated. Continue the
   existing private artifact plan/acquisition/staging work after isolation and
   health/rollback proofs, rather than interpreting a valid signature as privilege.
5. **Physical Stable/MVP release proof and recovery.** The replacement signed v4
   proof, current hardware Surface/network/cold-health/known-good/rollback evidence
   and Secure Boot support policy remain separate gates. This source batch neither
   selects media nor revives superseded consent.

No legacy code was removed: this review did not establish an unused dependency
closure sufficient to justify deletion. Identity, grants, manifests, update identity
and component versions retain their existing canonical owners.
