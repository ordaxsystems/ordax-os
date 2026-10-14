# Independent Base — Wi-Fi userspace + CA parity

Status: **candidate-only / not promotable**.

This slice provisions the userspace capabilities already consumed by `system/surface/runtime/network_broker.sh` without introducing a second network manager:

- `/sbin/ip` from the existing minimal iproute2 slice;
- `/usr/sbin/iw` for nl80211 scan/link inspection;
- `/usr/sbin/wpa_supplicant` with nl80211 for association;
- BusyBox `udhcpc` through the existing OrdaX DHCP owner;
- `/etc/ssl/certs/ca-certificates.crt` from the pinned Buildroot source graph.

The profile intentionally does **not** select `wpa_cli`, `wpa_passphrase`, DBus control, the Unix control interface, WEXT, WPS, EAP or WPA3 because the current broker does not consume those capabilities. WPA3 must be added together with an actual product consumer/contract, not as unused payload.

The disposable QEMU probe executes `iw --version` and `wpa_supplicant -v` and validates a non-empty PEM CA bundle before it can emit `ORDAX_INDEPENDENT_BOOT=PASS`. This proves the built userspace is present and runnable in the guest. QEMU still attaches only Ethernet user-NAT; it does **not** prove a Wi-Fi radio, association, firmware, regulatory data, notebook drivers or physical hardware.

Firmware remains a later hardware-derived slice. No `linux-firmware` bundle is selected here, and no kernel source/config is changed. The physical hardware owner must provide supported device/module/firmware evidence; only then may this base select the exact required firmware and, if evidence demands it, request a causal kernel integration.

Persistent credentials remain owned by the canonical broker under `/state/network/wpa.conf`; no SSID, PSK or generated credential file is embedded in the immutable EROFS base or its provenance.
