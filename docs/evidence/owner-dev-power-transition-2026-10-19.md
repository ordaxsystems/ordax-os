# Owner/Development USB — Restart and Shutdown recovery gate (2026-10-19)

Scope: `ordax-os`, **Owner/Development USB only**. This is source repair and
Linux integration evidence, **not** physical notebook certification or Stable/MVP
activation. Do not build/reflash USB while these power-action gates are open.

## Architecture (unchanged; canonical owners)

1. Shared Surface asks for `restart` or `shutdown` after explicit two-step
   confirmation through the native authenticated loopback adapter.
2. Native HTTP server writes only to the private, live local FIFO
   `/run/ordax-surface/power-request`. It has no kernel reboot privilege in the
   graphical chroot.
3. Surface host-side broker persists `state/ordax/power/last-request` as
   `action|boot-id|epoch|pending`, then forwards the narrow action to Guardian.
4. Root Guardian in `system/entrypoint` owns the only destructive transition.
   It requires Supervisor quiescence proof of released Native/Surface authority,
   stops persistent agents, syncs, remounts the root read-only, verifies that
   boundary and invokes the existing BusyBox kernel restart/poweroff with SysRq
   fallback.
5. The next boot reconciles the durable receipt. No remote power endpoint is
   added; power is never interpreted as a Git Pull or Surface restart.

## Root corrections proposed

- Both Guardian and Surface used a **literal trailing dollar** in
  `temporary=$POWER_LAST_REQUEST.tmp.$`, meaning their supposedly
  process-specific temporary path was shared. Use POSIX `$$` for unique
  process IDs and preserve atomic move to the existing durable receipt.
- The Surface's forwarding `printf >FIFO` could wait indefinitely if the
  Guardian reader disappeared after FIFO creation; bound the same narrow
  transfer with BusyBox `timeout` and fail the request rather than
  hanging the power broker indefinitely.
- Clear a stale local power FIFO before evaluating Guardian availability;
  do not advertise functioning power controls when the real host owner
  channel is missing. Desktop startup itself remains available offline.
- Keep existing strict native token/FIFO checks, valid action vocabulary,
  persistent receipt requirements and kernel transition ownership.

## Test matrix

- `sh -n system/entrypoint system/surface/bin/ordax-surface`
- `python3 -m unittest discover -s tests -p test_system_runtime_contract.py -k power -v`
- `python3 -m unittest discover -s tests -p test_native_power_broker.py -v`
- `node --test tests/test_power_actions.mjs`
- Live disposable FIFO test with no reader: bounded failure; with reader:
  exact `shutdown\\n` delivered, no kernel action executed.
- Repeat QEMU Owner/Development **only after the code is integrated**, using a
  new isolated disk overlay and captured cross-boot `power/last-request` proof;
  verify two-step UI confirmations, restart into the same first-use-completed
  Surface, then shutdown until QEMU process actually exits.
- Run on physical notebook last, verifying restart truly crosses a boot
  boundary and shutdown powers off, plus preserved data and no ext4 recovery.

## Nonclaims

QEMU ACPI `system_powerdown` sent by a monitor is **not** a UI button test.
A completed broker request only proves that action was queued, not that the
kernel/firmware transitioned. Any pending `last-request` without a new
boot-ID or clean shutdown proof is NOT approved. QEMU tests must not touch the
physical USB, internal disk, or parallel Stable/MVP emulation.
