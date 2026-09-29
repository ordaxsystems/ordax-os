# Physical ATA and performance evidence runbook

## Purpose

This companion runbook collects **diagnostic evidence only** during a governed physical Stable/MVP validation session. It does not replace `mvp-surface-smoke-runbook.md`, does not promote a candidate, and does not turn ATA or performance observations into an automatic PASS/FAIL verdict.

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
- If sysfs evidence is insufficient to explain the boot-time console sequence, establish a separate bounded kernel-log contract before collecting more data. Do not assume an incidental `dmesg` applet is part of the Stable proof surface.

## 2. Capture performance baseline

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

## 3. Run the canonical MVP Surface smoke

Follow `docs/evidence/mvp-surface-smoke-runbook.md` unchanged:

1. generate the structured `tour.json` with `tour-template`;
2. collect the canonical smoke baseline;
3. perform the 12-item manual tour;
4. collect the post-tour snapshot;
5. compare;
6. finalize fail-closed and require `FAIL=0`.

ATA/performance evidence is supplemental. It must not be used to fill manual tour items, override a failed smoke item, or manufacture a physical PASS.

## 4. Capture performance after the tour

After the post-tour smoke collection, run the same bounded performance sample again:

```sh
/system/surface/bin/ordax-performance-evidence --samples 20 --interval-seconds 0.5
```

Compare baseline and post-tour evidence manually or with a separately reviewed analysis step. The collector deliberately does not choose thresholds or declare regressions by itself.

## 5. Optional second ATA snapshot

If the session observed new storage symptoms after the tour, collect a second read-only snapshot:

```sh
/system/surface/bin/ordax-ata-evidence
```

Do not trigger rescans, resets, IDENTIFY commands, module unload/reload, libata command-line changes, mounts, writes, or reboots just to force a different result.

## Evidence boundary

A valid diagnostic session should make the following separation explicit:

- **MVP Surface smoke**: functional physical validation with its own fail-closed finalization.
- **ATA evidence**: bounded read-only hardware state useful for investigating the previously observed boot delay.
- **Performance evidence**: bounded read-only runtime measurements useful for investigating the previously observed latency growth.
- **Release/physical promotion**: separate authority; none of these commands records owner consent or permits destructive apply.

No result from this runbook alone proves Secure Boot, universal hardware compatibility, canonical Stable graphical readiness, physical cold-health promotion, or end-user release readiness.
