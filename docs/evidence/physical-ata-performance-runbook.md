# Physical ATA, kernel-log and performance evidence runbook

## Purpose

This companion runbook collects **diagnostic evidence only** during a governed physical Stable/MVP validation session. It does not replace `mvp-surface-smoke-runbook.md`, does not promote a candidate, and does not turn ATA, kernel-log, or performance observations into an automatic PASS/FAIL verdict.

The collectors are intentionally read-only entrypoints resolved against the active OrdaX Surface runtime. They do not authorize a USB rewrite, reflash, reboot, storage rescan, kernel parameter change, or any SSD/NVMe/SATA mutation.

## Preconditions

- Boot the already-authorized OrdaX candidate by the existing physical validation procedure.
- Keep the graphical Surface running while evidence is collected.
- Run the commands from the OrdaX host environment using the canonical absolute paths below.
- Do not pass fixture roots or synthetic `/proc`/`/sys` paths to the physical entrypoints.
- If evidence must be persisted, choose an operator-approved evidence destination separately. The commands themselves emit JSON to stdout.

## 1. Capture ATA state

Run once after the Surface is available, before the manual MVP tour:

```sh
/system/surface/bin/ordax-ata-evidence
```

The ATA collector reads the bounded `/sys/class/ata_port`, `/sys/class/ata_link`, and `/sys/class/ata_device` views exposed to the active runtime. It is intended to preserve evidence relevant to the observed `ata2` reset/identification delay without reading block contents or issuing storage commands.

Interpretation rules:

- `physicalStorageVerdict` remains non-authoritative; the collector is evidence, not a policy engine.
- Do not infer universal SATA compatibility from one machine.
- Do not disable SATA/AHCI/libata/NVMe support merely to remove a delay observed on one target.

## 2. Capture bounded ATA-related kernel-log evidence

If the boot console showed ATA resets, IDENTIFY failures, link negotiation problems, or similar errors, collect the matching printk records from the already-running system:

```sh
/system/surface/bin/ordax-kernel-log-evidence
```

This collector reads `/dev/kmsg` with a separate read-only, non-blocking file descriptor. It scans a bounded amount of the printk ring buffer and emits only records that match both an ATA/libata/AHCI/SATA scope and an explicit recovery/error/link-event allowlist. Identification-only records are excluded so the evidence does not become an accidental model/serial inventory.

The collector does **not** use `/proc/kmsg`, does not invoke `dmesg`, does not clear the ring buffer, and does not write kernel messages. If `/dev/kmsg` is unavailable or permission is denied, the command fails closed with `status=unavailable` instead of falling back to another source.

Do not use this evidence to justify a blind storage workaround. In particular, do not trigger rescans, resets, IDENTIFY commands, module unload/reload, `libata.force` changes, or other controller mutations to manufacture a different result.

## 3. Capture performance baseline

Immediately before the manual Surface tour, run a bounded sample:

```sh
/system/surface/bin/ordax-performance-evidence --samples 20 --interval-seconds 0.5
```

The performance collector samples the active runtime's read-only `/proc` view and reports aggregate CPU/load, memory, PSI, disk statistics, and bounded process-role aggregates. It does not emit process command lines, URLs, filenames, document contents, or a synthetic product verdict.

The entrypoint accepts only:

- `--samples`;
- `--interval-seconds`;
- `-h` / `--help`.

Any attempt to redirect it to a synthetic proc root through the physical entrypoint must fail closed.

## 4. Run the canonical MVP Surface smoke

Follow `docs/evidence/mvp-surface-smoke-runbook.md` unchanged:

1. generate the structured `tour.json` with `tour-template`;
2. collect the canonical smoke baseline;
3. perform the 12-item manual tour;
4. collect the post-tour snapshot;
5. compare;
6. finalize fail-closed and require `FAIL=0`.

ATA/kernel-log/performance evidence is supplemental. It must not be used to fill manual tour items, override a failed smoke item, or manufacture a physical PASS.

## 5. Capture performance after the tour

After the post-tour smoke collection, run the same bounded performance sample again:

```sh
/system/surface/bin/ordax-performance-evidence --samples 20 --interval-seconds 0.5
```

Compare baseline and post-tour evidence manually or with a separately reviewed analysis step. The collector deliberately does not choose thresholds or declare regressions by itself.

## 6. Optional second ATA/kernel-log snapshot

If the session observed new storage symptoms after the tour, collect another read-only sysfs snapshot and bounded kernel-log view:

```sh
/system/surface/bin/ordax-ata-evidence
/system/surface/bin/ordax-kernel-log-evidence
```

Do not trigger rescans, resets, IDENTIFY commands, module unload/reload, libata command-line changes, mounts, writes, or reboots just to force a different result.

## Evidence boundary

A valid diagnostic session should make the following separation explicit:

- **MVP Surface smoke**: functional physical validation with its own fail-closed finalization.
- **ATA evidence**: bounded read-only sysfs state useful for investigating the previously observed boot delay.
- **Kernel-log evidence**: bounded read-only ATA recovery/error records from `/dev/kmsg`, without full-ring disclosure or device identification lines.
- **Performance evidence**: bounded read-only runtime measurements useful for investigating the previously observed latency growth.
- **Release/physical promotion**: separate authority; none of these commands records owner consent or permits destructive apply.

No result from this runbook alone proves Secure Boot, universal hardware compatibility, canonical Stable graphical readiness, physical cold-health promotion, or end-user release readiness.
