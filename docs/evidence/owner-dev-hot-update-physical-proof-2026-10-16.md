# Owner/Development hot-update physical proof — 2026-10-16

Status: **IN PROGRESS — physical observation required**

## Purpose

Prove on the target notebook that the running Owner/Development Surface receives a new `main` commit through the Git-controlled system supervisor without an explicit `ordax-pull`, without a USB reflash and without stopping the currently healthy Surface merely because the remote is checked.

This is a physical update-path proof, not a Stable/MVP release authorization.

## Starting observation

```text
TARGET=physical notebook booted from Owner/Development USB
STARTING_SOURCE_SHA=a8ebf952f02a224f378e60577db8a621d652c325
STARTING_SURFACE=healthy and interactive
NETWORK=connected
EXPLICIT_ORDAX_PULL_AFTER_TRIGGER=FORBIDDEN
USB_REFLASH_AFTER_TRIGGER=FORBIDDEN
```

The starting SHA is the merged Wi-Fi authentication-state fix. The notebook reached the Surface after the operator manually recovered networking on the older flashed development Base and then ran the normal Git/runtime path.

## Trigger

This evidence commit itself is the remote `main` movement used for the probe. After it is merged, the running supervisor must discover that `origin/main` advanced beyond `STARTING_SOURCE_SHA` and reconcile the local runtime checkout through its normal bounded update path.

No manual `git pull`, `ordax-pull`, checkout reset or copied file is allowed to make the notebook reach the candidate.

## Acceptance

The physical proof passes only when all of the following are observed on the notebook:

1. the running system detects a `main` SHA newer than `a8ebf952f02a224f378e60577db8a621d652c325`;
2. the local technical commit reported by System > Updates advances to that exact merged SHA;
3. the update is applied by the running supervisor without an explicit `ordax-pull`;
4. the Surface remains usable after the update transaction;
5. no recovery shell is entered;
6. the previous checkout remains available to the existing rollback owner if health acknowledgement fails.

A documentation-only trigger is intentional for this first physical probe: it proves remote discovery, fetch, fast-forward checkout movement and update-state publication without coupling the result to a new runtime behavior. A later runtime-bearing change can separately prove live reload/restart classification.

## Result

Pending physical observation. Do not mark this file PASS until the notebook reports the exact merged SHA and the healthy running Surface remains available.
