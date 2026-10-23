#!/bin/sh
set -eu
# Runs only inside Buildroot's disposable target tree.
TARGET_DIR=$1
PROFILE=${2:-}
test -n "$TARGET_DIR"
test -d "$TARGET_DIR"
case "$PROFILE" in
    minimal|owner-development) ;;
    *)
        echo "Unknown Independent Base profile: ${PROFILE:-<empty>}" >&2
        exit 1
        ;;
esac
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$HERE/../.." && pwd)
mkdir -p "$TARGET_DIR/ordax/bootstrap/network/bin" "$TARGET_DIR/etc/ordax"

remove_exact_symlink() {
    relative=$1
    expected=$2
    path="$TARGET_DIR/$relative"
    if test -e "$path" || test -L "$path"; then
        if ! test -L "$path"; then
            echo "Unexpected Independent Base runtime object: $path" >&2
            exit 1
        fi
        actual=$(readlink "$path")
        if test "$actual" != "$expected"; then
            echo "Unexpected Independent Base runtime link: $path -> $actual" >&2
            exit 1
        fi
        rm "$path"
    fi
}

# /dev is runtime-owned. Both the portable initramfs and the Owner/Development
# handoff mount/bind a real devtmpfs over this directory before the target root
# becomes active. Buildroot's skeleton procfs shortcuts therefore become dead
# lower-layer content and reference paths that only exist after procfs mounts.
for volatile_dev_link in \
    'fd:../proc/self/fd' \
    'stdin:../proc/self/fd/0' \
    'stdout:../proc/self/fd/1' \
    'stderr:../proc/self/fd/2'
do
    name=${volatile_dev_link%%:*}
    expected=${volatile_dev_link#*:}
    remove_exact_symlink "dev/$name" "$expected"
done

# The boot capsule mounts procfs before any handoff. A static /etc/mtab link to
# procfs is therefore not a self-contained Base member and is not needed by the
# OrdaX runtime. The QEMU gate exercises mount operations without this shortcut.
remove_exact_symlink "etc/mtab" "../proc/self/mounts"

# Preserve Buildroot's resolver indirection because the canonical DHCP script
# writes /etc/resolv.conf. Make its /run backing file a real archive member so
# the symlink is non-dangling before network configuration fills it.
resolver="$TARGET_DIR/etc/resolv.conf"
if test -L "$resolver"; then
    resolver_target=$(readlink "$resolver")
    if test "$resolver_target" != "../run/resolv.conf"; then
        echo "Unexpected Independent Base resolver link: $resolver -> $resolver_target" >&2
        exit 1
    fi
    mkdir -p "$TARGET_DIR/run"
    : > "$TARGET_DIR/run/resolv.conf"
    chmod 0644 "$TARGET_DIR/run/resolv.conf"
elif test -e "$resolver" && ! test -f "$resolver"; then
    echo "Unexpected Independent Base resolver object: $resolver" >&2
    exit 1
fi

# BR2_STATIC_LIBS leaves no musl dynamic loader or libc.so in this profile.
# Buildroot's generic skeleton can still leave a literal ld-musl* shortcut;
# carrying that dangling loader alias would falsely imply dynamic-link support.
if test -e "$TARGET_DIR/lib/libc.so" || test -L "$TARGET_DIR/lib/libc.so"; then
    echo "Independent Base static-link contract unexpectedly contains lib/libc.so" >&2
    exit 1
fi
remove_exact_symlink "lib/ld-musl*" "libc.so"

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

if test "$PROFILE" = owner-development; then
    # Owner/Development is an explicit capability profile of this same
    # Independent Base. Do not infer the profile from incidental binaries.
    for required in \
        "$TARGET_DIR/usr/bin/git" \
        "$TARGET_DIR/usr/sbin/iw" \
        "$TARGET_DIR/usr/sbin/wpa_supplicant" \
        "$TARGET_DIR/usr/sbin/wpa_passphrase" \
        "$TARGET_DIR/usr/sbin/wpa_cli"
    do
        if ! test -x "$required"; then
            echo "Incomplete Owner/Development target capability set: $required" >&2
            exit 1
        fi
    done
    test -s "$TARGET_DIR/etc/ssl/certs/ca-certificates.crt" || {
        echo "Owner/Development CA trust store is missing" >&2
        exit 1
    }

    # Kernel modules are a separately verified canonical component. Reuse the
    # archive supplied by the integration workflow; never compile or download a
    # second kernel from the Buildroot base build.
    test -n "${ORDAX_HOST_PYTHON:-}" || {
        echo "Owner/Development requires ORDAX_HOST_PYTHON" >&2
        exit 1
    }
    test -n "${ORDAX_KERNEL_MODULES_ARCHIVE:-}" || {
        echo "Owner/Development requires ORDAX_KERNEL_MODULES_ARCHIVE" >&2
        exit 1
    }
    test -n "${ORDAX_KERNEL_MODULES_RECEIPT:-}" || {
        echo "Owner/Development requires ORDAX_KERNEL_MODULES_RECEIPT" >&2
        exit 1
    }
    test -n "${ORDAX_FIRMWARE_COVERAGE_RECEIPT:-}" || {
        echo "Owner/Development requires ORDAX_FIRMWARE_COVERAGE_RECEIPT" >&2
        exit 1
    }
    test -f "$ROOT/bootstrap/base/kernel_module_payload.py"
    test -f "$ROOT/bootstrap/base/firmware_policy.py"
    "$ORDAX_HOST_PYTHON" "$ROOT/bootstrap/base/kernel_module_payload.py" install \
        --archive "$ORDAX_KERNEL_MODULES_ARCHIVE" \
        --target "$TARGET_DIR" \
        --receipt "$ORDAX_KERNEL_MODULES_RECEIPT"
    test -s "$ORDAX_KERNEL_MODULES_RECEIPT"
    cp "$ORDAX_KERNEL_MODULES_RECEIPT" "$TARGET_DIR/etc/ordax/kernel-module-payload.json"
    cmp -s "$ORDAX_KERNEL_MODULES_RECEIPT" "$TARGET_DIR/etc/ordax/kernel-module-payload.json"

    # A module payload without matching firmware is not a valid Owner base.
    # Generate one external receipt for CI/evidence, then embed those exact
    # verified bytes into the immutable target. Never generate two receipts.
    "$ORDAX_HOST_PYTHON" "$ROOT/bootstrap/base/firmware_policy.py" check \
        --rootfs "$TARGET_DIR" \
        --receipt "$ORDAX_FIRMWARE_COVERAGE_RECEIPT" \
        --log-prefix ORDAX_INDEPENDENT_OWNER
    test -s "$ORDAX_FIRMWARE_COVERAGE_RECEIPT"
    cp "$ORDAX_FIRMWARE_COVERAGE_RECEIPT" "$TARGET_DIR/etc/ordax/firmware-coverage.json"
    cmp -s "$ORDAX_FIRMWARE_COVERAGE_RECEIPT" "$TARGET_DIR/etc/ordax/firmware-coverage.json"

    mkdir -p "$TARGET_DIR/usr/local/bin" "$TARGET_DIR/state" "$TARGET_DIR/workspace" "$TARGET_DIR/home" "$TARGET_DIR/root" "$TARGET_DIR/run" "$TARGET_DIR/tmp"
    chmod 1777 "$TARGET_DIR/tmp"
    for helper in ordax-network ordax-pull ordax-rollback ordax-run ordax-diagnose; do
        test -f "$ROOT/bootstrap/dev-base/$helper"
        cp "$ROOT/bootstrap/dev-base/$helper" "$TARGET_DIR/usr/local/bin/$helper"
        chmod 0755 "$TARGET_DIR/usr/local/bin/$helper"
    done
    # These are the SAME two native helpers compiled by the canonical Dev
    # Base owner. Both are consumed by Owner runtime: mountattr seals the USB
    # superblock and checkout-exchange commits the verified Git transaction.
    # Build from source with THIS Buildroot's static target compiler, not host
    # glibc, local developer executables or an alternative native backend.
    native_compiler="${HOST_DIR:-}/bin/x86_64-buildroot-linux-musl-gcc"
    if test -z "${HOST_DIR:-}" || ! test -x "$native_compiler"; then
        echo "Owner/Development static Buildroot compiler unavailable" >&2
        exit 1
    fi
    for native in \
        ordax_usb_mountattr:ordax-usb-mountattr \
        ordax_checkout_exchange:ordax-checkout-exchange
    do
        source_name=${native%%:*}
        binary_name=${native#*:}
        native_source="$ROOT/bootstrap/dev-base/$source_name.c"
        native_target="$TARGET_DIR/usr/local/bin/$binary_name"
        if test -L "$native_source" || ! test -f "$native_source"; then
            echo "Canonical Owner/Development native helper source unavailable: $source_name" >&2
            exit 1
        fi
        "$native_compiler" -static -Os -s -Wall -Wextra -Werror \
            -Wl,--build-id=none -o "$native_target" "$native_source"
        chmod 0755 "$native_target"
        test -x "$native_target"
    done
    if test "$("$TARGET_DIR/usr/local/bin/ordax-checkout-exchange" --abi)" != \
        "prototype-ordax.checkout-exchange/1"; then
        echo "Owner/Development native atomic exchange ABI mismatch" >&2
        exit 1
    fi
    test -f "$ROOT/bootstrap/dev-base/ordax-dev-init"
    cp "$ROOT/bootstrap/dev-base/ordax-dev-init" "$TARGET_DIR/sbin/ordax-dev-init"
    chmod 0755 "$TARGET_DIR/sbin/ordax-dev-init"
    test -f "$ROOT/bootstrap/recovery/entrypoint"
    mkdir -p "$TARGET_DIR/ordax/bootstrap/recovery"
    cp "$ROOT/bootstrap/recovery/entrypoint" "$TARGET_DIR/ordax/bootstrap/recovery/entrypoint"
    chmod 0755 "$TARGET_DIR/ordax/bootstrap/recovery/entrypoint"
    printf 'ORDAX_OWNER_DEVELOPMENT_PROFILE=YES\n' > "$TARGET_DIR/etc/ordax/owner-development"
else
    # The minimal proof must remain minimal. If Owner capabilities leak into
    # this profile, fail instead of silently widening the canonical base.
    for unexpected in \
        "$TARGET_DIR/usr/bin/git" \
        "$TARGET_DIR/usr/sbin/wpa_supplicant" \
        "$TARGET_DIR/etc/ordax/owner-development" \
        "$TARGET_DIR/usr/local/bin/ordax-checkout-exchange" \
        "$TARGET_DIR/usr/local/bin/ordax-usb-mountattr"
    do
        if test -e "$unexpected"; then
            echo "Owner/Development capability leaked into minimal profile: $unexpected" >&2
            exit 1
        fi
    done
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
for forbidden in \
    "$TARGET_DIR/etc/alpine-release" \
    "$TARGET_DIR/sbin/apk" \
    "$TARGET_DIR/lib/apk" \
    "$TARGET_DIR/etc/apk" \
    "$TARGET_DIR/usr/bin/opkg" \
    "$TARGET_DIR/bin/opkg" \
    "$TARGET_DIR/usr/bin/dpkg" \
    "$TARGET_DIR/usr/bin/apt" \
    "$TARGET_DIR/usr/bin/apt-get" \
    "$TARGET_DIR/usr/bin/rpm"
do
    if test -e "$forbidden"; then
        echo "Runtime package manager or Alpine dependency unexpectedly present: $forbidden" >&2
        exit 1
    fi
done
