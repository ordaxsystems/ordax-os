# Stable/MVP first governed physical boot evidence — 2026-09-27

## Scope

This record covers the first governed Stable/MVP physical USB that completed writer readback verification and then booted on real hardware. It is hardware evidence, not a claim that Secure Boot, Legacy/CSM boot or the complete MVP UX is already closed.

## Physical media proof

The governed writer returned:

```text
Schema=prototype-ordax.creator-portable-physical-apply/1
Status=pass-readback-verified
DiskNumber=1
ApplicationPlanSHA256=dae43418a68219341f3ffb69fe902ef22450020ca69071ef546bb1fa93102e9a
OperationCount=39
MaterializedArtifacts=17
ReadbackArtifacts=17
WholeDiskRawImageUsed=false
```

Therefore the physical media write/readback milestone is accepted as:

```text
FIRST_REAL_STABLE_MVP_USB=PASS
PHYSICAL_USB_APPLY=PASS
```

## Physical boot evidence

On real hardware the USB reached:

1. firmware UEFI selection;
2. `EFI/BOOT/BOOTX64.EFI` / systemd-boot;
3. the OrdaX Linux kernel and fixed initramfs;
4. `/sbin/ordax-portable-init`;
5. verified Bootstrap Capsule;
6. verified Stable Base;
7. persistent-state loop/mount;
8. verified product handoff;
9. graphical Surface;
10. the native First Run experience.

The graphical First Run page was visibly rendered and interactive on physical hardware. This supports:

```text
FIRST_REAL_STABLE_MVP_PHYSICAL_BOOT=PASS
ORDAX_GRAPHICAL_SURFACE=PASS
FIRST_USE_UI=PASS
```

These markers apply to the tested UEFI path only.

## Hardware observations discovered by the proof

### Firmware mode

One desktop firmware exposed the same USB twice: a UEFI entry and a Legacy/CSM entry. The UEFI entry booted OrdaX; the Legacy/CSM entry did not. Other notebooks exposed only one USB entry. The current media remains UEFI-first and must not claim Legacy/CSM support.

### Boot presentation

The production kernel displayed upstream Linux/Tux logos before the OrdaX Surface. This is not acceptable product presentation. The product kernel must not enable the upstream Linux logo; diagnostic text must remain an explicit diagnostic-mode concern.

### SATA probe delay

One machine spent roughly 50 seconds retrying an `ata2` device classification/reset path before continuing successfully. This is a real boot-performance observation and must be investigated separately rather than hidden with a splash timeout.

### Wi-Fi

The First Run network step reported that native Wi-Fi management was unavailable. The Stable Base already owns Wi-Fi userspace; the physical proof exposed that supported modular Wi-Fi drivers were not being activated by the Stable native network owner. Hardware discovery must be owned by the network broker and remain demand-driven so local boot does not depend on Wi-Fi hardware.

### First Run viewport

On the local-security step, the primary continuation action could fall outside the visible physical viewport after validation content expanded. Enter still triggered the action. The wizard must keep its footer/actions visible and scroll only the content area.

### Account

Account actions were visibly disabled while identity was unavailable/offline. No fake authentication path was used. Follow-up must make capability state explicit and refresh identity after real connectivity becomes available.

### Surface performance/windowing

Opening multiple first-party apps caused noticeable responsiveness degradation on USB hardware. New apps also opened as smaller floating windows while the intended MVP experience is to use the full Surface work area by default. These are product issues requiring measured correction, not animation or delay masking.

## Explicit non-claims

```text
SECURE_BOOT_PROVEN=NO
LEGACY_CSM_BOOT_PROVEN=NO
ALL_WIFI_HARDWARE_PROVEN=NO
FULL_MVP_FUNCTIONAL_ACCEPTANCE=NO
INTERNAL_DISK_INSTALL_PROVEN=NO
```

The Stable/MVP remains USB-first and must not perform destructive writes to internal SSD/NVMe/HDD during this proof path.

## Follow-up tracking

See issue #586 for the product-hardening closure created from this physical proof.
