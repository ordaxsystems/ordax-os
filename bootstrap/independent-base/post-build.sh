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
test -x "$TARGET_DIR/sbin/modprobe"

# Owner/Development is a capability profile of this same Independent Base.
# Detect it from the built target, not from a parallel owner or copied config:
# Git + iw + wpa_supplicant + wpa_passphrase must all exist before Dev helpers
# are installed. A partially resolved profile fails closed later in verification.
if test -x "$TARGET_DIR/usr/bin/git" || test -x "$TARGET_DIR/usr/sbin/wpa_supplicant"; then
    for required in \
        "$TARGET_DIR/usr/bin/git" \
        "$TARGET_DIR/usr/sbin/iw" \
        "$TARGET_DIR/usr/sbin/wpa_supplicant" \
        "$TARGET_DIR/usr/bin/wpa_passphrase"
    do
        if ! test -x "$required"; then
            echo "Incomplete Owner/Development target capability set: $required" >&2
            exit 1
        fi
    done

    mkdir -p "$TARGET_DIR/usr/local/bin" "$TARGET_DIR/state" "$TARGET_DIR/workspace" "$TARGET_DIR/home" "$TARGET_DIR/root" "$TARGET_DIR/run" "$TARGET_DIR/tmp"
    chmod 1777 "$TARGET_DIR/tmp"
    for helper in ordax-network ordax-pull ordax-rollback ordax-run ordax-diagnose; do
        test -f "$ROOT/bootstrap/dev-base/$helper"
        cp "$ROOT/bootstrap/dev-base/$helper" "$TARGET_DIR/usr/local/bin/$helper"
        chmod 0755 "$TARGET_DIR/usr/local/bin/$helper"
    done
    test -f "$ROOT/bootstrap/dev-base/ordax-dev-init"
    cp "$ROOT/bootstrap/dev-base/ordax-dev-init" "$TARGET_DIR/sbin/ordax-dev-init"
    chmod 0755 "$TARGET_DIR/sbin/ordax-dev-init"
    test -f "$ROOT/bootstrap/recovery/entrypoint"
    mkdir -p "$TARGET_DIR/ordax/bootstrap/recovery"
    cp "$ROOT/bootstrap/recovery/entrypoint" "$TARGET_DIR/ordax/bootstrap/recovery/entrypoint"
    chmod 0755 "$TARGET_DIR/ordax/bootstrap/recovery/entrypoint"
    printf 'ORDAX_OWNER_DEVELOPMENT_PROFILE=YES\n' > "$TARGET_DIR/etc/ordax/owner-development"
fi

# This parity slice has exactly one iproute2 runtime consumer: /sbin/ip.
# The version-scoped Buildroot patch must prevent the rest of the suite from
# entering the target at all; do not hide unused payload by deleting it here.
test -x "$TARGET_DIR/sbin/ip"
for unexpected in \
    "$TARGET_DIR/sbin/tc" \
    "$TARGET_DIR/sbin/bridge" \
    "$TARGET_DIR/sbin/ss" \
    "$TARGET_DIR/sbin/rtmon" \
    "$TARGET_DIR/sbin/routel" \
    "$TARGET_DIR/sbin/genl" \
    "$TARGET_DIR/sbin/tipc" \
    "$TARGET_DIR/sbin/devlink" \
    "$TARGET_DIR/sbin/rdma" \
    "$TARGET_DIR/sbin/dcb" \
    "$TARGET_DIR/sbin/vdpa" \
    "$TARGET_DIR/sbin/netshaper" \
    "$TARGET_DIR/sbin/dpll" \
    "$TARGET_DIR/sbin/nstat" \
    "$TARGET_DIR/sbin/lnstat" \
    "$TARGET_DIR/sbin/arpd" \
    "$TARGET_DIR/usr/share/iproute2" \
    "$TARGET_DIR/usr/include/iproute2" \
    "$TARGET_DIR/usr/share/bash-completion/completions/tc" \
    "$TARGET_DIR/usr/share/bash-completion/completions/devlink"
do
    if test -e "$unexpected"; then
        echo "Unexpected unused iproute2 payload in Independent Base: $unexpected" >&2
        exit 1
    fi
done
printf 'ORDAX_INDEPENDENT_BASE=EXPERIMENTAL\n' > "$TARGET_DIR/etc/ordax/independent-base"
if test -e "$TARGET_DIR/etc/alpine-release" || test -e "$TARGET_DIR/sbin/apk" || test -e "$TARGET_DIR/lib/apk" || test -e "$TARGET_DIR/etc/apk"; then
    echo "Alpine/APK unexpectedly present in independent rootfs" >&2
    exit 1
fi
