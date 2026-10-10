#!/bin/sh
set -eu

PATH=/sbin:/bin:/usr/sbin:/usr/bin
export PATH

ESP_MOUNT=/ordax-esp
DATA_MOUNT=/ordax-data
STATE_MOUNT=/state
CAPSULE_MOUNT=/bootstrap-capsule
BASE_MOUNT=/base-lower
RELEASE_MOUNT=/release-lower
NEWROOT=/newroot

CAPSULE_IMAGE="$ESP_MOUNT/ordax/bootstrap/bootstrap.erofs"
TRUST_ANCHOR="$ESP_MOUNT/ordax/bootstrap/trust/release-ed25519.json"
STATE_IMAGE="$DATA_MOUNT/.ordax/state/persistent-state.img"
STABLE_BASE_IMAGE="$DATA_MOUNT/.ordax/base/stable-base.erofs"
PORTABLE_ROOT="$DATA_MOUNT/.ordax"

SURFACE_RUNTIME_LOWER=/run/ordax/lower/surface-runtime
SURFACE_RUNTIME_UPPER=/run/ordax/runtime/native-surface/upper
SURFACE_RUNTIME_WORK=/run/ordax/runtime/native-surface/work
SURFACE_RUNTIME_ROOT=/run/ordax/runtime/native-surface/rootfs
AI_RUNTIME_ROOT=/run/ordax/runtime/local-ai
RUNTIME_STATE_HELPER=/run/ordax/bootstrap-tools/ordax-portable-state

rescue() {
    echo "ordax-portable-init: entering local read-only recovery shell: $*" >&2
    echo "No network or automatic mutation is started from this recovery path." >&2
    exec sh
}

is_sha() {
    value=${1:-}
    [ "${#value}" -eq 40 ] || return 1
    case "$value" in
        ''|*[!0-9a-f]*) return 1 ;;
    esac
}

is_sha256() {
    value=${1:-}
    [ "${#value}" -eq 64 ] || return 1
    case "$value" in
        ''|*[!0-9a-f]*) return 1 ;;
    esac
}

mkdir -p \
    /proc /sys /dev /run \
    "$ESP_MOUNT" "$DATA_MOUNT" "$STATE_MOUNT" "$CAPSULE_MOUNT" \
    "$BASE_MOUNT" "$RELEASE_MOUNT" "$NEWROOT"
mount -t proc proc /proc || rescue "cannot mount /proc"
mount -t sysfs sysfs /sys || rescue "cannot mount /sys"
mount -t devtmpfs devtmpfs /dev || rescue "cannot mount /dev"
mount -t tmpfs -o mode=0755 tmpfs /run || rescue "cannot mount /run"

mkdir -p /run/ordax/bootstrap-tools ||
    rescue "cannot create runtime bootstrap-tools directory"
/bin/busybox cp /sbin/ordax-portable-state "$RUNTIME_STATE_HELPER" ||
    rescue "cannot retain portable activation helper"
/bin/busybox chmod 0555 "$RUNTIME_STATE_HELPER" ||
    rescue "cannot protect portable activation helper"
ESP_DEVICE="$(findfs LABEL=ORDAX-ESP 2>/dev/null || true)"
case "$ESP_DEVICE" in
    "") rescue "ORDAX-ESP partition not found" ;;
esac
mount -t vfat -o ro,nodev,nosuid "$ESP_DEVICE" "$ESP_MOUNT" ||
    rescue "cannot mount ORDAX-ESP read-only"

/sbin/ordax-portable-capsule-verify verify ||
    rescue "bootstrap capsule does not match the fixed initramfs pin"
/sbin/ordax-portable-mount mount-capsule "$CAPSULE_IMAGE" "$CAPSULE_MOUNT" ||
    rescue "cannot mount verified bootstrap capsule"

RECOVERY_MODE=0
case " $(cat /proc/cmdline 2>/dev/null || true) " in
    *" ordax.mode=recovery "*) RECOVERY_MODE=1 ;;
esac

DATA_DEVICE="$(findfs LABEL=ORDAX-DATA 2>/dev/null || true)"
case "$DATA_DEVICE" in
    "") rescue "ORDAX-DATA partition not found" ;;
esac

case "$RECOVERY_MODE" in
    1)
        mount -t exfat -o ro,nodev,nosuid "$DATA_DEVICE" "$DATA_MOUNT" ||
            rescue "cannot mount ORDAX-DATA read-only for recovery"
        rescue "portable-v2 recovery mode requested"
        ;;
esac

mount -t exfat -o rw,nodev,nosuid "$DATA_DEVICE" "$DATA_MOUNT" ||
    rescue "cannot mount ORDAX-DATA"

/sbin/ordax-portable-base-verify verify ||
    rescue "Stable Base does not match the fixed initramfs pin"

/sbin/ordax-portable-mount mount-state "$STATE_IMAGE" "$STATE_MOUNT" ||
    rescue "cannot mount persistent ext4 state"

AGENT="$CAPSULE_MOUNT/bootstrap/release-acquisition/ordax-release-agent"
cat "$AGENT" >/dev/null 2>&1 ||
    rescue "release agent is missing from verified capsule"
cat "$TRUST_ANCHOR" >/dev/null 2>&1 ||
    rescue "bootstrap-owned release trust anchor is missing"

SELECTED_SLOT=
SELECTED_COMMIT=
SELECTED_MANIFEST_SCHEMA=
SELECTED_SURFACE_RUNTIME_SHA256=
SELECTED_AI_RUNTIME_SHA256=
AI_RUNTIME_READY=0

verify_selected_release() {
    slot=$1
    commit=$2
    is_sha "$commit" || return 1

    if "$AGENT" verify-portable-v4-exact \
        --trust "$TRUST_ANCHOR" \
        --root "$PORTABLE_ROOT" \
        --expected-commit "$commit" \
        >"/run/portable-release-verify.json" 2>/dev/null; then
        runtime_ref="$PORTABLE_ROOT/releases/$commit/surface-runtime.sha256"
        runtime_sha="$(cat "$runtime_ref" 2>/dev/null || true)"
        is_sha256 "$runtime_sha" || return 1
        runtime_image="$PORTABLE_ROOT/runtimes/sha256/$runtime_sha/native-surface-runtime.erofs"
        [ -f "$runtime_image" ] || return 1

        ai_ref="$PORTABLE_ROOT/releases/$commit/local-ai-runtime.sha256"
        ai_sha="$(cat "$ai_ref" 2>/dev/null || true)"
        is_sha256 "$ai_sha" || return 1
        ai_image="$PORTABLE_ROOT/ai-runtimes/sha256/$ai_sha/local-ai-runtime.erofs"
        [ -f "$ai_image" ] || return 1

        SELECTED_SLOT=$slot
        SELECTED_COMMIT=$commit
        SELECTED_MANIFEST_SCHEMA=4
        SELECTED_SURFACE_RUNTIME_SHA256=$runtime_sha
        SELECTED_AI_RUNTIME_SHA256=$ai_sha
        return 0
    fi

    if "$AGENT" verify-portable-v3-exact \
        --trust "$TRUST_ANCHOR" \
        --root "$PORTABLE_ROOT" \
        --expected-commit "$commit" \
        >"/run/portable-release-verify.json" 2>/dev/null; then
        runtime_ref="$PORTABLE_ROOT/releases/$commit/surface-runtime.sha256"
        runtime_sha="$(cat "$runtime_ref" 2>/dev/null || true)"
        is_sha256 "$runtime_sha" || return 1
        runtime_image="$PORTABLE_ROOT/runtimes/sha256/$runtime_sha/native-surface-runtime.erofs"
        [ -f "$runtime_image" ] || return 1

        SELECTED_SLOT=$slot
        SELECTED_COMMIT=$commit
        SELECTED_MANIFEST_SCHEMA=3
        SELECTED_SURFACE_RUNTIME_SHA256=$runtime_sha
        SELECTED_AI_RUNTIME_SHA256=
        return 0
    fi

    if "$AGENT" verify-portable-exact \
        --trust "$TRUST_ANCHOR" \
        --root "$PORTABLE_ROOT" \
        --expected-commit "$commit" \
        >"/run/portable-release-verify.json" 2>/dev/null; then
        SELECTED_SLOT=$slot
        SELECTED_COMMIT=$commit
        SELECTED_MANIFEST_SCHEMA=2
        SELECTED_SURFACE_RUNTIME_SHA256=
        SELECTED_AI_RUNTIME_SHA256=
        return 0
    fi

    return 1
}

select_verified_release() {
    selection="$(/sbin/ordax-portable-state select-boot "$STATE_MOUNT" "$PORTABLE_ROOT" 2>/dev/null || true)"
    set -- $selection
    slot=${1:-}
    commit=${2:-}
    extra=${3:-}
    [ -z "$extra" ] || return 1
    case "$slot" in
        current|known-good|candidate) ;;
        *) return 1 ;;
    esac
    is_sha "$commit" || return 1

    if verify_selected_release "$slot" "$commit"; then
        return 0
    fi

    if [ "$slot" = "candidate" ]; then
        /sbin/ordax-portable-state rollback \
            "$STATE_MOUNT" "$PORTABLE_ROOT" "$commit" >/dev/null 2>&1 ||
            return 1

        selection="$(/sbin/ordax-portable-state select-boot "$STATE_MOUNT" "$PORTABLE_ROOT" 2>/dev/null || true)"
        set -- $selection
        slot=${1:-}
        commit=${2:-}
        extra=${3:-}
        [ -z "$extra" ] || return 1
        case "$slot" in
            current|known-good) ;;
            *) return 1 ;;
        esac
        is_sha "$commit" || return 1
        if verify_selected_release "$slot" "$commit"; then
            return 0
        fi
    fi

    # State selection alone does not attest the release bytes. An invalid
    # current must not prevent the separate known-good slot from being
    # resolved and verified offline. No slot is retargeted by this fallback.
    [ "$slot" = "current" ] || return 1
    fallback_commit="$(/sbin/ordax-portable-state resolve \
        "$STATE_MOUNT" "$PORTABLE_ROOT" known-good 2>/dev/null)" || return 1
    is_sha "$fallback_commit" || return 1
    [ "$fallback_commit" != "$commit" ] || return 1
    verify_selected_release known-good "$fallback_commit"
}
select_verified_release ||
    rescue "no candidate/current/known-good release is safely selectable and exactly verified"

# select-boot may durably arm the one-shot attempt or persist fallback cleanup
# inside the ext4 state image, which itself is a file on ORDAX-DATA. Flush the
# outer filesystem before advertising the selection as QEMU-proof durable.
sync || rescue "cannot durably flush portable activation state"
echo "ORDAX_PORTABLE_ACTIVATION_STATE_DURABLE=YES"

if [ "$SELECTED_MANIFEST_SCHEMA" = "3" ] || [ "$SELECTED_MANIFEST_SCHEMA" = "4" ]; then
    SURFACE_RUNTIME_IMAGE="$PORTABLE_ROOT/runtimes/sha256/$SELECTED_SURFACE_RUNTIME_SHA256/native-surface-runtime.erofs"
    mkdir -p \
        "$SURFACE_RUNTIME_LOWER" \
        "$SURFACE_RUNTIME_UPPER" \
        "$SURFACE_RUNTIME_WORK" \
        "$SURFACE_RUNTIME_ROOT"
    /sbin/ordax-portable-mount mount-surface-runtime \
        "$SURFACE_RUNTIME_IMAGE" \
        "$SURFACE_RUNTIME_LOWER" \
        "$SURFACE_RUNTIME_UPPER" \
        "$SURFACE_RUNTIME_WORK" \
        "$SURFACE_RUNTIME_ROOT" ||
        rescue "cannot compose exactly verified Surface runtime"
fi

if [ "$SELECTED_MANIFEST_SCHEMA" = "4" ]; then
    AI_RUNTIME_IMAGE="$PORTABLE_ROOT/ai-runtimes/sha256/$SELECTED_AI_RUNTIME_SHA256/local-ai-runtime.erofs"
    mkdir -p "$AI_RUNTIME_ROOT"
    if /sbin/ordax-portable-mount mount-ai-runtime \
        "$AI_RUNTIME_IMAGE" \
        "$AI_RUNTIME_ROOT"; then
        AI_RUNTIME_READY=1
    else
        AI_RUNTIME_READY=0
        echo "ordax-portable-init: verified local AI payload could not be mounted; continuing with Intelligence degraded" >&2
    fi
fi

mkdir -p "$BASE_MOUNT" "$NEWROOT" "$RELEASE_MOUNT"
/sbin/ordax-portable-mount mount-base \
    "$STABLE_BASE_IMAGE" "$STATE_MOUNT" "$BASE_MOUNT" "$NEWROOT" ||
    rescue "cannot compose verified Stable Base runtime"

mkdir -p "$NEWROOT/system"
/sbin/ordax-portable-mount mount-system \
    "$PORTABLE_ROOT/releases/$SELECTED_COMMIT/system.erofs" \
    "$RELEASE_MOUNT" \
    "$NEWROOT/system" ||
    rescue "cannot mount exactly verified product system release"

mkdir -p \
    "$NEWROOT/proc" \
    "$NEWROOT/sys" \
    "$NEWROOT/dev" \
    "$NEWROOT/run" \
    "$NEWROOT/state" \
    "$NEWROOT/ordax-data" \
    "$NEWROOT/ordax-esp" \
    "$NEWROOT/ordax/bootstrap"

mount --move /run "$NEWROOT/run" ||
    rescue "cannot move /run into Stable Base"

mkdir -p \
    "$NEWROOT/run/ordax/lower/base" \
    "$NEWROOT/run/ordax/lower/release" \
    "$NEWROOT/run/ordax/lower/capsule"

mount --move "$BASE_MOUNT" "$NEWROOT/run/ordax/lower/base" ||
    rescue "cannot retain Stable Base lower mount"
mount --move "$RELEASE_MOUNT" "$NEWROOT/run/ordax/lower/release" ||
    rescue "cannot retain product release lower mount"
mount --move "$CAPSULE_MOUNT" "$NEWROOT/run/ordax/lower/capsule" ||
    rescue "cannot retain bootstrap capsule lower mount"

mount -o bind,ro "$NEWROOT/run/ordax/lower/capsule/bootstrap" "$NEWROOT/ordax/bootstrap" ||
    rescue "cannot expose verified bootstrap support tree"
mount -o remount,bind,ro,nodev,nosuid "$NEWROOT/ordax/bootstrap" ||
    rescue "cannot enforce read-only bootstrap support tree"

mount --move "$STATE_MOUNT" "$NEWROOT/state" ||
    rescue "cannot move persistent state into Stable Base"
mount --move "$DATA_MOUNT" "$NEWROOT/ordax-data" ||
    rescue "cannot move ORDAX-DATA into Stable Base"
mount --move "$ESP_MOUNT" "$NEWROOT/ordax-esp" ||
    rescue "cannot move ORDAX-ESP into Stable Base"
mount --move /proc "$NEWROOT/proc" || rescue "cannot move /proc"
mount --move /sys "$NEWROOT/sys" || rescue "cannot move /sys"
mount --move /dev "$NEWROOT/dev" || rescue "cannot move /dev"

export ORDAX_DISTRIBUTION_PROFILE=stable-mvp
export ORDAX_PRODUCT_MODE=usb
export ORDAX_STABLE_LAYOUT=portable-v2
export ORDAX_SOURCE_SHA="$SELECTED_COMMIT"
export ORDAX_BOOT_SLOT="$SELECTED_SLOT"
export ORDAX_RELEASE_MANIFEST_SCHEMA="$SELECTED_MANIFEST_SCHEMA"
export ORDAX_PORTABLE_STATE_HELPER="$RUNTIME_STATE_HELPER"
export ORDAX_PORTABLE_STATE_ROOT=/state
export ORDAX_PORTABLE_ROOT=/ordax-data/.ordax

if [ "$SELECTED_MANIFEST_SCHEMA" = "3" ] || [ "$SELECTED_MANIFEST_SCHEMA" = "4" ]; then
    export ORDAX_SURFACE_RUNTIME_MODE=verified-erofs-overlay
    export ORDAX_SURFACE_RUNTIME_ROOT=/run/ordax/runtime/native-surface/rootfs
    export ORDAX_SURFACE_RUNTIME_SHA256="$SELECTED_SURFACE_RUNTIME_SHA256"
fi

if [ "$SELECTED_MANIFEST_SCHEMA" = "4" ] && [ "$AI_RUNTIME_READY" -eq 1 ]; then
    export ORDAX_LOCAL_AI_RUNTIME_MODE=verified-erofs-read-only
    export ORDAX_LOCAL_AI_RUNTIME_ROOT=/run/ordax/runtime/local-ai
    export ORDAX_LOCAL_AI_RUNTIME_SHA256="$SELECTED_AI_RUNTIME_SHA256"
fi

echo "ORDAX_PORTABLE_V2_HANDOFF=VERIFIED"
echo "ORDAX_PORTABLE_V2_SLOT=$SELECTED_SLOT"
echo "ORDAX_PORTABLE_V2_SOURCE_SHA=$SELECTED_COMMIT"
echo "ORDAX_PORTABLE_RELEASE_MANIFEST_SCHEMA=$SELECTED_MANIFEST_SCHEMA"
if [ "$SELECTED_MANIFEST_SCHEMA" = "3" ] || [ "$SELECTED_MANIFEST_SCHEMA" = "4" ]; then
    echo "ORDAX_SURFACE_RUNTIME_HANDOFF=VERIFIED"
    echo "ORDAX_SURFACE_RUNTIME_SHA256=$SELECTED_SURFACE_RUNTIME_SHA256"
fi
if [ "$SELECTED_MANIFEST_SCHEMA" = "4" ]; then
    if [ "$AI_RUNTIME_READY" -eq 1 ]; then
        echo "ORDAX_LOCAL_AI_RUNTIME_HANDOFF=VERIFIED"
        echo "ORDAX_LOCAL_AI_RUNTIME_SHA256=$SELECTED_AI_RUNTIME_SHA256"
    else
        echo "ORDAX_LOCAL_AI_RUNTIME_HANDOFF=DEGRADED"
    fi
fi

exec switch_root "$NEWROOT" /sbin/ordax-stable-init
