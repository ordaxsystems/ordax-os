#!/bin/sh
set -eu
# Runs only inside Buildroot's disposable target tree.
TARGET_DIR=$1
test -n "$TARGET_DIR"
test -d "$TARGET_DIR"
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)
mkdir -p "$TARGET_DIR/ordax/bootstrap/network/bin" "$TARGET_DIR/etc/ordax"
# Reuse the current owner of DHCP semantics. Do not fork its scripts.
cp "$ROOT/bootstrap/network/bring-up" "$TARGET_DIR/ordax/bootstrap/network/bring-up"
cp "$ROOT/bootstrap/network/udhcpc.script" "$TARGET_DIR/ordax/bootstrap/network/udhcpc.script"
chmod 0755 "$TARGET_DIR/ordax/bootstrap/network/bring-up" "$TARGET_DIR/ordax/bootstrap/network/udhcpc.script"
# The existing OrdaX network contract calls netbox <applet>. BusyBox only
# dispatches its first argument in multicall mode when invoked as "busybox",
# not via an alias whose basename is "netbox". Preserve the canonical scripts
# with a minimal argument-forwarding entrypoint, not a second network stack.
printf '%s\n' '#!/bin/sh' 'exec /bin/busybox "$@"' > "$TARGET_DIR/ordax/bootstrap/network/bin/netbox"
chmod 0755 "$TARGET_DIR/ordax/bootstrap/network/bin/netbox"
# Phase 2: install the canonical runtime handoff verbatim. The official
# portable PID1 (not this build) verifies the pinned base and invokes this
# entrypoint after composing the verified EROFS/ext4 OverlayFS root.
# Do not fork or replace bootstrap/stable-base/ordax-stable-init.
test -f "$ROOT/bootstrap/stable-base/ordax-stable-init"
cp "$ROOT/bootstrap/stable-base/ordax-stable-init" "$TARGET_DIR/sbin/ordax-stable-init"
chmod 0755 "$TARGET_DIR/sbin/ordax-stable-init"
# Install the real product Guardian and Supervisor verbatim for isolated
# *adversarial* QEMU execution. This proof-only directory is never the release
# /system mount, never a PID1, and cannot stand in for a signed product release.
PROOF_SYSTEM="$TARGET_DIR/usr/lib/ordax-phase3-proof/system"
mkdir -p "$PROOF_SYSTEM"
for source in entrypoint supervisor; do
    test -f "$ROOT/system/$source"
    cp "$ROOT/system/$source" "$PROOF_SYSTEM/$source"
    chmod 0755 "$PROOF_SYSTEM/$source"
done
test -x "$TARGET_DIR/sbin/modprobe"
printf 'ORDAX_INDEPENDENT_BASE=EXPERIMENTAL\n' > "$TARGET_DIR/etc/ordax/independent-base"
if test -e "$TARGET_DIR/etc/alpine-release" || test -e "$TARGET_DIR/sbin/apk" || test -e "$TARGET_DIR/lib/apk"; then
    echo "Alpine/APK unexpectedly present in independent rootfs" >&2
    exit 1
fi
