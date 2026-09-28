# OrdaX MVP — pre-physical handoff

Status: CANONICAL EXECUTION HANDOFF BEFORE THE NEXT STABLE/MVP PHYSICAL RETEST

This document narrows the current physical-promotion boundary. It does not authorize a USB write and does not replace `MVP.md`, `docs/CURRENT-STATE.md`, `docs/PROMOTION-GATES.md`, the structured physical-authorization contract, or hardware evidence.

## Current boundary

The first governed Stable/MVP physical pass already happened. Its exact authorized candidate completed the 39-operation writer plan, verified 17/17 artifacts by readback and reached real UEFI boot. That pass is historical evidence for the pre-hardening candidate only.

PR #588 changed boot/kernel and shared system bytes after the physical pass exposed product-level defects. PR #602 then closed the release-freshness gap: the old signed v4 proof remains cryptographically valid historical evidence, but it is no longer a current proof that may reopen destructive authorization.

The current repository state is therefore intentionally split into separate proofs:

```text
PRE_USB_PRODUCT_SOURCE=PASS
PRIOR_CANONICAL_V4_RELEASE_CANDIDATE_PROOF=PASS_PRE_HARDENING_HISTORY
PRIOR_STABLE_MVP_USB_WRITE=PASS_AUTHORIZED_CONTROLLED_PROOF
PRIOR_STABLE_MVP_ARTIFACT_READBACK=PASS_17_OF_17
PRIOR_STABLE_MVP_UEFI_BOOT=PASS_PHYSICAL_PRE_HARDENING
CURRENT_MAIN_CANONICAL_V4_RELEASE_PROOF=PENDING_POST_HARDENING_REPLACEMENT
CURRENT_MAIN_CANONICAL_V4_RELEASE_PROOF_BOUND=NO
PHYSICAL_WRITE_AUTHORIZATION=BLOCKED_CANONICAL_V4_RELEASE_PROOF_PENDING
EXPLICIT_OWNER_AUTHORIZATION=NO
PHYSICAL_WRITE_ALLOWED=NO
PHYSICAL_TARGET_SELECTED=NO
POST_HARDENING_PHYSICAL_WRITE_PERFORMED=NO
CANONICAL_STABLE_GRAPHICAL_SESSION_CURRENT_MAIN=PENDING_PHYSICAL_RETEST
CANONICAL_SYSTEM_RUNTIME_CURRENT_MAIN=PENDING_PHYSICAL_RETEST
STABLE_CHANNEL_PUBLICATION=PENDING_AFTER_CURRENT_PHYSICAL_PROOF
```

`PASS` in source, CI or historical physical evidence never upgrades a current physical gate implicitly.

## Why the previous proof cannot be rebound

`docs/contracts/physical-write-authorization.json` is authoritative for destructive eligibility. Its current state is:

```text
status=blocked-canonical-v4-release-proof-pending
physical_write_allowed=false
explicit_owner_authorization=false
canonical_v4_release_proof_bound=false
```

The historical release binding remains recorded so the repository can identify which release was superseded. `tools/creator/bind_canonical_v4_release_proof.py` now rejects both the same historical proof bytes and a repackaged proof for the same superseded source commit while the contract is in replacement-proof state.

A genuinely new signed/materialized v4 proof from a new post-hardening source commit is required before the state machine may advance to `blocked-explicit-physical-authorization-pending`. Only after that transition can explicit owner authorization become reachable again.

No proof binding, owner authorization or CI result opens a device, selects a target, confirms destructive work, bypasses UAC or invokes the physical writer.

## Interpreting broad roll-up markers

Broad roll-ups such as `GRAPHICAL_SURFACE_COMPLETE=NO` and `CANONICAL_SYSTEM_RUNTIME_COMPLETE=NO` do not mean that the shared graphical source or the pre-USB product implementation is absent.

Their current operational meaning is narrower:

- the shared Surface source, Native composition and pre-USB product closure are implemented and source/CI-proven within their documented scopes;
- the Owner/Development graphical path has physical evidence;
- the first Stable/MVP physical pass has pre-hardening UEFI/readback evidence;
- the **post-hardening current-main Stable/MVP graphical session** is not yet physically proven;
- current-main cold-health, known-good persistence, offline reboot and physical rollback/recovery remain unproven;
- therefore the complete canonical runtime remains physically gated.

The authoritative separation remains the one in `docs/PROMOTION-GATES.md`: source and historical evidence are recorded independently from the current-main physical promotion gates.

## Ordered remaining gates

The repository is currently at the **replacement canonical v4 release proof required** stage. The ordered remaining gates are:

1. build/sign/publish a new canonical v4 prerelease whose source and artifact bytes include the post-#588 hardening;
2. materialize and verify that exact prerelease through the official non-activating path and produce a new canonical v4 release proof;
3. bind that new proof; the binder must reject the superseded pre-hardening source/proof;
4. run the read-only promotion preflight and obtain `pre_authorization_ready=true` for the new exact context;
5. record a new explicit owner authorization for that exact context — only after a deliberate owner decision;
6. separately select the physical USB and revalidate its live identity immediately before destructive work;
7. require target-specific destructive confirmation and Windows UAC;
8. execute a new physical write only when explicitly authorized and verify all 17 canonical artifacts by exact SHA-256, size and readback;
9. boot the post-hardening Stable/MVP USB on the target notebook and complete OOBE -> Surface -> first-party-app smoke;
10. prove real cold-health, commit `current/known-good`, reboot offline and confirm known-good boot;
11. exercise a broken candidate and prove physical rollback/recovery without losing known-good;
12. only after the required physical evidence, promote the approved release into the Stable public channel/catalog.

Steps 1–4 are non-destructive release/proof work. Step 5 is authorization only. Steps 6–8 are a later physical operation and must never be inferred from completion of earlier steps.

## Read-only status command

Use:

```text
python tools/creator/stable_mvp_usb_readiness.py
```

The output deliberately distinguishes:

- `pre_usb_product_source_complete`;
- `canonical_v4_release_proof_valid` — the historical proof may still be cryptographically valid;
- `canonical_v4_release_proof_current` — false while that proof is superseded;
- `canonical_v4_release_proof_bound_requirement`;
- `physical_authorization_status`;
- owner authorization state;
- source-versus-physical `proof_boundaries`;
- ordered `remaining_gates`;
- explicit false values for target selection, writer invocation, physical write and current physical proof.

At the current stage the expected high-level result is:

```text
stage=canonical-v4-release-proof-pending
next_stage=canonical-v4-release-proof
canonical_v4_release_proof_current=false
owner_authorization_recorded=false
physical_write_performed=false
```

The fail-closed operator prerequisite remains:

```text
python tools/creator/stable_mvp_usb_readiness.py --require-authorized-candidate
```

It must fail at the current stage. It may succeed only after a fresh proof has been bound and a fresh explicit owner authorization has been recorded. Even then, success means only **authorized candidate ready for a separate physical flow**, never “physical proof complete”.

## First-MVP operator readiness split

For the operator-facing aggregate status, use:

```text
python tools/ops/first_mvp_operator_readiness.py
```

It deliberately keeps three concerns independent:

- `first_usb`: whether the source-authorized physical writer path is eligible for the offline `creator-physical` signing/publication handoff;
- `official_creator`: whether the end-user Windows Creator has its separate Authenticode publisher identity/certificate policy configured and is ready for public distribution;
- `native_installation`: whether post-MVP internal-disk foundations may exist in source while remaining hidden, disabled and fail-closed in the MVP.

At the current replacement-proof stage, `first_usb` must remain blocked. The historical first USB proof does not make the next post-hardening physical flow authorized.

An unconfigured Authenticode identity for the public Creator remains a publication blocker for public Creator distribution, but it is independent from canonical Stable/MVP release-proof freshness and physical owner consent.

The fail-closed operator prerequisite is:

```text
python tools/ops/first_mvp_operator_readiness.py --require-first-usb-handoff
```

It must not become a shortcut around the new-release-proof gate. This command never reads private-key contents, creates a signature, selects media, records target confirmation, writes the USB or writes an internal disk.

## Public Creator boundary

The internal/tagged physical writer may remain implemented while the normal public Creator keeps destructive apply disabled. Do not expose public physical apply merely because a prior physical proof exists. Public exposure is a separate product-promotion decision and must preserve target filtering, system-disk exclusion, live revalidation, target-specific confirmation, UAC and exact readback.

The official Creator publication boundary is stricter than an owner-operated controlled proof: `docs/contracts/creator-code-signing.json` must be explicitly configured with the reviewed Authenticode publisher identity, pinned leaf certificate SHA-256 and custody provider before public distribution is allowed. Keeping that capability hidden or fail-closed in the MVP is intentional product gating, not unfinished storage architecture.

## Stable publication boundary

The previously published canonical v4 prerelease is retained as historical signed/materialized evidence for its exact pre-hardening bytes. It must not be promoted to Stable/`latest` as the post-hardening candidate and must not be rebound to reopen physical authorization.

A replacement post-hardening v4 prerelease must first complete the signed/materialized proof chain described above. Stable/`latest` publication still must not be used as a shortcut around canonical physical proof. The final public catalog may point only to a release whose physical evidence matches the documented MVP support scope.
