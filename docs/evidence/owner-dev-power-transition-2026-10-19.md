# Owner/Development USB — Restart and Shutdown recovery gate (2026-10-19)

Scope: `ordax-os`, **Owner/Development USB only**. This is source repair and
Linux integration evidence, **not** physical notebook certification or Stable/MVP
activation. Disposable Creator/QEMU media is permitted for tests; do not
build/publish a physical deployment USB or reflash hardware while power-action gates are open.

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

## Persistent runtime and rescue receipt staging — additional root repair

The same literal `.$` temporary-suffix defect was also present outside the
power action itself. The existing owners now use process-specific `.$$` staging
for the persistent Base update agent, Surface runtime proof context, and the
rescue agent's generation/action/telemetry receipts. No second agent, API,
updater or state store was introduced; the same atomic renames are retained.

A contract regression rejects any literal `.tmp.$` staging suffix across
the Surface launcher and rescue agent and asserts each expected `.$$` path.
The updated PR #2008 revision passed **37 Python runtime/power tests**, both
shell syntax checks and a clean Git diff. The exact, separately published
combined test candidate in draft PR #2025 passed **151 Python and 29 JavaScript**
tests (180 total), but has **not** completed the in-guest Power/Network/Pull
QEMU gates.

Process-specific temporary paths address naming collisions; they do not
constitute proof of successful physical restart, shutdown, NAND durability,
network recovery, or an applied update on the physical notebook.

## Real headless QEMU with NAT — additional integration evidence

- Existing combined test seed `18a65e24cfe955d8964dccd1b3aa553816fc610a`
  was booted as a **disposable QCOW2 overlay** on a verified 4 GiB RAW
  via QEMU 10.0 in Windows WSL2 (TCG, no guest GUI window).
- Guest devices: UEFI USB mass-storage, virtio-vga, USB keyboard/mouse,
  **virtio-net-pci** and QEMU user-mode NAT on `10.0.2.0/24`.
  QMP `query-status` returned `running` and `info network` listed the
  actual NAT NIC. **This is not proof of guest DHCP/DNS/TLS/Git connectivity.**
- The guest console confirmed the exact source SHA and local Owner/Development
  runtime start. First native HTTP launch reported
  `native Surface HTTP/control server failed readiness check` with repeated
  connection refusals to `127.0.0.1:8765`; Guardian killed and retried it.
  The next graphical attempt reached the rendered **8-step First Run**
  and navigated from Welcome to Region to Network. The Network step showed
  `Não é possível configurar o Wi-Fi nesta sessão`, expected without a Wi-Fi
  NIC but **not evidence of usable wired Internet**.
- Root timeout mismatch: the Owner Guardian exports **90 seconds** of initial
  Surface health time, but `wait_for_native_server 10` gave its live Python
  loopback server only **10 seconds** before a premature recovery.
  The owning launcher now waits a bounded **30 seconds** and still aborts early
  if the server process exits. Regression asserts the new exact limit.
- Local source verification after this correction: **34**
  `test_system_runtime_contract.py` tests plus **3**
  `test_native_power_broker.py` tests passed.
- The corrected source has been copied to the **draft integration gate PR
  #2025**, head `0d317f48eeced121a1fe11736286e2d0208869db`;
  its replacement Creator/QEMU pipeline has been started. **The already
  running 18a65e24 guest does not contain this correction.**
- First Run persistence across reboot, guest DHCP, DNS, TLS, GitHub, a
  successful forward `ordax-pull` to an authorized later commit and
  **real UI → authenticated Native → Guardian → Linux restart/shutdown**
  remain **not proven**. HMP or ACPI monitor reset/powerdown never counts
  as a button test. No physical drive was passed to QEMU.

This evidence must not be used to approve deployment/USB recording until the
exact rebuilt image passes the remaining gates. Preserve the single shared
OrdaX OS and the existing Native, Network and Guardian owners.
