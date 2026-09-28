# Stable/MVP first real physical USB evidence — 2026-09-27

## Scope

This checkpoint records the first governed Stable/MVP USB write/readback and the first subsequent real-hardware boot observations. It deliberately separates media integrity, UEFI boot, graphical Surface reachability, and product-readiness findings.

## Governed media result

Physical target used for the controlled proof:

- Windows target: `PhysicalDrive1`
- device serial: `6699E36B`
- physical bytes: `8053063680`
- application-plan SHA-256: `dae43418a68219341f3ffb69fe902ef22450020ca69071ef546bb1fa93102e9a`

Writer result recorded after the destructive authorization boundary:

```text
Schema=prototype-ordax.creator-portable-physical-apply/1
Status=pass-readback-verified
DiskNumber=1
OperationCount=39
MaterializedArtifacts=17
ReadbackArtifacts=17
WholeDiskRawImageUsed=false
```

Therefore the physical media/write milestone is **PASS** for this exact target and plan. This does not by itself prove firmware compatibility or runtime behavior on arbitrary hardware.

## Real UEFI boot

The same USB subsequently reached the OrdaX graphical Surface on real x86-64 hardware through the UEFI path. One tested desktop firmware exposed the same USB twice:

- `UEFI: Lidermix 8.07` — boots the OrdaX UEFI path;
- `Lidermix 8.07` — legacy/CSM path and did not boot OrdaX.

Other tested notebooks did not necessarily expose separate labels, so absence of the explicit `UEFI:` prefix is not treated as proof of legacy-only firmware.

The physical boot reached:

1. firmware/systemd-boot;
2. exact kernel + initramfs;
3. `ordax-portable-init`;
4. verified bootstrap capsule;
5. verified Stable Base and persistent state;
6. Stable Surface runtime;
7. graphical First Run.

This establishes a real physical UEFI/Surface pass on the successful machine. It is not a claim of universal hardware support.

## Diagnostic-only boot modification

For the physical debugging session only, the USB loader entry was changed locally from serial-only logging to include `console=tty0`, `loglevel=7`, `ignore_loglevel`, and `logo.nologo`. That local diagnostic edit is not a production boot policy and is not source authority.

Verbose kernel/init logs seen during that run are therefore expected diagnostic output, not desired end-user UX.

## Product findings from the physical session

### Upstream Linux logo visible

The original kernel displayed Tux logos before the Surface. The production OrdaX identity must own the visible boot experience. Source hardening now disables the upstream kernel logo rather than relying on a runtime command-line workaround.

### Wi-Fi management unavailable

First Run reached the network step but reported that Wi-Fi management was unavailable. Source inspection showed that the Stable Base contains pinned Wi-Fi tools, selected modules, and firmware, while the Surface eudev path only coldplugged the input subsystem. The hardening branch therefore moves physical PCI/USB module coldplug to Stable Base before the Surface starts.

This must be re-proven on hardware before Wi-Fi is marked PASS.

### First Run action footer on shorter display

On the physical display, the Security step accepted keyboard Enter while the visible Continue action had fallen outside the practical viewport. The layout is being corrected so body scrolling and the action footer have independent bounded rows at physical viewport height.

The local-session credential contract still requires at least six characters; any future distinct four-digit PIN policy must be implemented explicitly across the security contract rather than inferred from the word “PIN”.

### Account actions unavailable

The Account step correctly did not invent a fake identity provider: Sign in/Register remained disabled because real identity capabilities were unavailable in that run. The signed system configuration already names the real account gateway. Account must be re-tested after network readiness is physically proven; no synthetic provider is accepted as a substitute.

### App window sizing

First-party apps opened in restored/small windows. The product requirement from the physical review is now maximized-by-default within the Surface workspace while retaining the existing restore/minimize/close window lifecycle.

### Performance

Opening several apps in sequence (Files, Projects, Notes, Internet) produced increasing latency on the tested physical machine. This is an unresolved performance finding. It must be measured and optimized with real activation/runtime metrics; arbitrary sleeps, hidden loading delays, or reduced functionality are not acceptable fixes.

### ATA probe delay

The diagnostic console showed repeated `ata2` identification/reset retries before boot continued, adding tens of seconds on the tested desktop. This remains a hardware/boot-time investigation item. It must not be “fixed” by blindly disabling storage support because the same kernel serves supported SATA/NVMe hardware paths.

## Current verdict

- physical USB write/readback: **PASS**
- physical UEFI boot to OrdaX Surface on at least one machine: **PASS**
- graphical First Run reachability: **PASS**
- Wi-Fi on the tested physical run: **FAIL / hardening in progress**
- account online path on the tested physical run: **NOT PROVEN**
- multi-app performance: **NEEDS HARDENING**
- universal hardware compatibility: **NOT CLAIMED**
- Stable/MVP ready for end users: **NOT YET**

A new signed candidate and a new physical validation cycle are required after the hardening changes pass CI. The successful first USB is evidence; it is not silently promoted into a production-ready claim.
