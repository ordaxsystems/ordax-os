# OrdaX MVP — pre-physical handoff

Status: CANONICAL EXECUTION HANDOFF BEFORE THE NEXT STABLE/MVP PHYSICAL RETEST

**Dev versus promoção:** o CI testa os contratos do Creator e os 17 artefatos em mídia descartável, mas não recompila uma Stable histórica assinada a partir de índices Alpine mutáveis. A reconstrução e publicação do pacote físico exigem `workflow_dispatch`, release canônica e autorização explícita. A integridade histórica da Stable Base permanece um gate separado, nunca contornado pelo CI de desenvolvimento.

**SSOT dos 17 vínculos físicos:** o OS continua produzindo os bytes de boot, kernel, Base, release e mídia. O único Core `ordax-creator`, fixado por commit e árvore em `docs/contracts/native-release-assembly.json#creator_source`, gera e verifica os 17 IDs, tamanhos e SHA-256. A lista e o hasher Python paralelos foram removidos do workflow físico. Esta integração não autoriza gravação física, alteração de assinatura ou publicação Stable.

**Publisher pre-sign readback:** o publicador Windows existente agora recusa o manifesto v2 e, para um manifesto v3, exige 17 arquivos realmente publicados sob o tag Stable canônico, com URL/nome únicos, SHA-256 e tamanho correspondentes aos vínculos assináveis. Faz download e leitura integral dos bytes antes de acessar a chave privada; qualquer ausência ou divergência bloqueia a assinatura. O tag Stable v4 atual ainda tem somente cinco assets e não passa. Sem novo SSOT, chave, autorização ou gravação física.\n\n**Physical distribution gate (2026-10-18, read-only audit):** the published canonical Stable v4 release `ordax-stable-v4-03f88eeaf382a59aaefbcf4943d0639d2730741b` exposes five assets (three EROFS images plus signed release manifest/envelope), while the existing Portable v3 consumer requires 17 individually verifiable source artifact bindings (exact URL, SHA-256 and byte size). The Physical Write Promotion workflow currently emits only an **unsigned v2** Windows-writer review bundle; it is not a signed v3 physical distribution. CI therefore reports `PORTABLE_V3_17_SOURCE_RELEASE_READY=NO`, `PORTABLE_V3_SIGNED_WRITER_PUBLISHED=NO` and `PHYSICAL_USB_WRITE_READY=NO`. The historical owner approval merged through #1974 was later suspended by #1997 after a protected-source change: the *current* authoritative authorization contract is `blocked-explicit-physical-authorization-pending`, with consent and physical-write flags false. Do not mutate the existing signed Stable tag, infer missing file URLs or hashes, reuse the prior source-context approval, or flash the v2 review bundle. A future signed v3 publisher needs independently verified 17-source distribution, legitimate offline publisher custody and new source-scoped owner confirmation before hardware tests.

**Lifecycle note (2026-10-18):** the pre-consent `NO` and `BLOCKED` markers preserved below describe the previously reviewed handoff snapshot, not a live override of `docs/contracts/physical-write-authorization.json`. A newly authorized branch must pass the canonical `physical_promotion.py` context check and CI before merge; recorded owner consent never substitutes for an offline signed v3 publisher release, live USB re-enumeration, UAC, 17-source readback or hardware boot evidence. The most recent actual authorization state must be read from the contract at the tested commit.

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
CURRENT_MAIN_CANONICAL_V4_RELEASE_PROOF=PASS_SIGNED_HTTPS_MATERIALIZED
CURRENT_MAIN_CANONICAL_V4_RELEASE_PROOF_BOUND=YES_VERIFIED
PHYSICAL_WRITE_AUTHORIZATION=BLOCKED_EXPLICIT_OWNER_AUTHORIZATION_PENDING
EXPLICIT_OWNER_AUTHORIZATION=NO
PHYSICAL_WRITE_ALLOWED=NO
PHYSICAL_TARGET_SELECTED=NO
POST_HARDENING_PHYSICAL_WRITE_PERFORMED=NO
CANONICAL_STABLE_GRAPHICAL_SESSION_CURRENT_MAIN=PENDING_PHYSICAL_RETEST
CANONICAL_SYSTEM_RUNTIME_CURRENT_MAIN=PENDING_PHYSICAL_RETEST
STABLE_CHANNEL_PUBLICATION=PENDING_AFTER_CURRENT_PHYSICAL_PROOF
```

`PASS` in source, CI or historical physical evidence never upgrades a current physical gate implicitly.

## Current verified v4 proof and separate physical authorization

`docs/contracts/physical-write-authorization.json` is authoritative for destructive eligibility. Its current state is:

```text
status=blocked-explicit-physical-authorization-pending
physical_write_allowed=false
explicit_owner_authorization=false
canonical_v4_release_proof_bound=true
```

The historical proof of source `b924ff8d74d1761232381ae3f9604bba17497cfd` remains evidence of the previous controlled USB. It cannot reopen authorization. The current release proof from `03f88eeaf382a59aaefbcf4943d0639d2730741b` was built from the real handoff and HTTPS materialization receipts, validated by Step 7 and bound by `tools/creator/bind_canonical_v4_release_proof.py` on 11/10/2026.

The safe proof-binding transition is complete. Explicit owner authorization is now a separate **ungranted** operation; no physical-media preparation, target selection or USB write is implied by the bound receipt.

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

The repository is currently at the **explicit owner authorization pending** stage. The ordered lifecycle gates, including the already completed non-destructive proof steps, are:

1. **CONCLUÍDO:** build/sign/publish a new canonical v4 prerelease whose source and artifact bytes include the post-#588 hardening;
2. **CONCLUÍDO:** materialize and verify that exact prerelease through the official non-activating path and produce a new canonical v4 release proof;
3. **CONCLUÍDO:** bind that new proof; the binder must reject the superseded pre-hardening source/proof;
4. **CONCLUÍDO EM CI:** run the read-only promotion preflight and obtain `pre_authorization_ready=true` for the new exact context;
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
- `canonical_v4_release_proof_valid` — the current proof has the exact signed evidence;
- `canonical_v4_release_proof_current` — true only for the exact current source;
- `canonical_v4_release_proof_bound_requirement`;
- `physical_authorization_status`;
- owner authorization state;
- source-versus-physical `proof_boundaries`;
- ordered `remaining_gates`;
- explicit false values for target selection, writer invocation, physical write and current physical proof.

At the current stage the expected high-level result is:

```text
stage=explicit-owner-authorization-pending
next_stage=explicit-owner-authorization
canonical_v4_release_proof_current=true
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

At the current explicit-consent-pending stage, `first_usb` must remain blocked. The historical first USB proof does not make the next post-hardening physical flow authorized.

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
