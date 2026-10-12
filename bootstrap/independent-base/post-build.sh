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
ln -s /bin/busybox "$TARGET_DIR/ordax/bootstrap/network/bin/netbox"
printf 'ORDAX_INDEPENDENT_BASE=EXPERIMENTAL\n' > "$TARGET_DIR/etc/ordax/independent-base"
if test -e "$TARGET_DIR/etc/alpine-release" || test -e "$TARGET_DIR/sbin/apk" || test -e "$TARGET_DIR/lib/apk"; then
    echo "Alpine/APK unexpectedly present in independent rootfs" >&2
    exit 1
fi
