#!/bin/sh
set -eu

RUNTIME_ROOT=${ORDAX_BASE_RUNTIME_ROOT:-}
HOST_REPO_ROOT=${ORDAX_BASE_HOST_REPO_ROOT:-}
DISTRIBUTION_PROFILE=${ORDAX_BASE_DISTRIBUTION_PROFILE:-owner-development}
SOURCE_SHA_HINT=${ORDAX_BASE_SOURCE_SHA:-}
HOST_STATE_ROOT=${ORDAX_BASE_HOST_STATE_ROOT:-/state/ordax}
INTERVAL=${ORDAX_BASE_INTERVAL_SECONDS:-30}
MOUNTINFO_FILE=${ORDAX_BASE_MOUNTINFO_FILE:-/proc/self/mountinfo}
MOUNT_STAGE_HOST=${ORDAX_BASE_MOUNT_STAGE_ROOT:-/run/ordax-base-owner}
PHYSICAL_MOUNT_HOST=
PHYSICAL_BIND_HOST=
PHYSICAL_MOUNT_CHROOT=/mnt/ordax-device
OWNER_STATE_CHROOT=
OWNER_BASE_ROOT_CHROOT=
PHYSICAL_ROOT_SOURCE=
ESP_DISCOVERY_FILE=$HOST_STATE_ROOT/base-update/esp-discovery.json
ESP_READONLY_PREFLIGHT_FILE=$HOST_STATE_ROOT/base-update/esp-readonly-preflight.json
ESP_READONLY_PREFLIGHT_SHA_FILE=$HOST_STATE_ROOT/base-update/esp-readonly-preflight-sha
ESP_READONLY_MOUNT_ROOT=${ORDAX_BASE_ESP_READONLY_MOUNT_ROOT:-/run/ordax-base-owner/esp-readonly}
ESP_STAGE_MOUNT_ROOT=${ORDAX_BASE_ESP_STAGE_MOUNT_ROOT:-/run/ordax-base-owner/esp-stage}
DEV_BASE_REQUEST_FILE=$HOST_STATE_ROOT/dev-base-request-sha
DEV_BASE_READY_FILE=$HOST_STATE_ROOT/dev-base-ready-sha
DEV_BASE_FETCHING_FILE=$HOST_STATE_ROOT/dev-base-fetching-sha
DEV_BASE_STAGED_FILE=$HOST_STATE_ROOT/base-update/dev-base-staged-sha
DEV_BASE_STAGE_RESULT_FILE=$HOST_STATE_ROOT/base-update/dev-base-stage-result.json
DEV_BASE_STAGE_LOG=$HOST_STATE_ROOT/base-update/dev-physical-stage.log
DEV_BASE_ACTIVATION_READINESS_FILE=$HOST_STATE_ROOT/base-update/dev-base-activation-readiness.json
DEV_BASE_ACTIVATION_READINESS_SHA_FILE=$HOST_STATE_ROOT/base-update/dev-base-activation-readiness-sha
ESP_ACTIVATION_READINESS_MOUNT_ROOT=${ORDAX_BASE_ESP_ACTIVATION_READINESS_MOUNT_ROOT:-/run/ordax-base-owner/esp-activation-readiness}
DEV_BASE_ACTIVATION_READINESS_LOG=$HOST_STATE_ROOT/base-update/dev-activation-readiness.log
EFIVARFS_PREFLIGHT_FILE=$HOST_STATE_ROOT/base-update/efivarfs-preflight.json
EFIVARFS_PREFLIGHT_LOG=$HOST_STATE_ROOT/base-update/efivarfs-preflight.log
DEV_BASE_PROMOTED_FILE=$HOST_STATE_ROOT/base-update/dev-base-promoted-sha
DEV_BASE_PROMOTION_RESULT_FILE=$HOST_STATE_ROOT/base-update/dev-base-promotion-result.json
DEV_BASE_PROMOTION_LOG=$HOST_STATE_ROOT/base-update/dev-postboot-promotion.log
ESP_PROMOTION_MOUNT_ROOT=${ORDAX_BASE_ESP_PROMOTION_MOUNT_ROOT:-/run/ordax-base-owner/esp-promotion}
DEV_BASE_LOG=$HOST_STATE_ROOT/base-update/dev-channel.log
PREPARE_BLOCKER=
LOG_PREFIX=ordax-base-update-agent

case "$INTERVAL" in
    ''|*[!0-9]*) INTERVAL=30 ;;
esac
[ "$INTERVAL" -ge 15 ] 2>/dev/null || INTERVAL=15

log() {
    printf '%s: %s\n' "$LOG_PREFIX" "$*" >&2
}

is_sha() {
    value=${1:-}
    [ "${#value}" -eq 40 ] || return 1
    case "$value" in
        ''|*[!0-9a-f]*) return 1 ;;
    esac
    return 0
}

read_state_value() {
    path=$1
    [ -s "$path" ] || return 0
    /bin/busybox head -n 1 "$path" 2>/dev/null || true
}

write_state_value() {
    path=$1
    value=$2
    directory=${path%/*}
    temporary=$path.tmp.$$
    /bin/busybox mkdir -p "$directory" || return 1
    printf '%s\n' "$value" >"$temporary" || return 1
    /bin/busybox chmod 600 "$temporary" >/dev/null 2>&1 || true
    /bin/busybox mv -f "$temporary" "$path"
}

seed_root_subpath() {
    value=$1
    case "$value" in
        */versions/*)
            suffix=${value##*/versions/}
            prefix=${value%/versions/*}
            if is_sha "$suffix" && [ -n "$prefix" ]; then
                printf '%s' "$prefix"
                return 0
            fi
            ;;
    esac
    printf '%s' "$value"
}

write_preflight_status() {
    blocker=${1:-physical-root-unavailable}
    case "$blocker" in
        runtime-unavailable|owner-source-unavailable|repo-bind-unavailable|root-mount-unavailable|root-subpath-unsafe|root-filesystem-unsupported|root-source-unsafe|mount-stage-conflict|mount-stage-failed|physical-mountpoint-conflict|physical-mount-failed|physical-bind-conflict|physical-bind-failed|development-state-missing|development-state-unsafe)
            ;;
        *) blocker=physical-root-unavailable ;;
    esac

    status_dir=$HOST_STATE_ROOT/base-update
    /bin/busybox mkdir -p "$status_dir" 2>/dev/null || return 0
    temporary=$status_dir/.owner-status.json.preflight.$$
    printf '{"$schema":"ordax.base-update-owner-status/1","status":"blocked","phase":"physical-root-preflight","sourceSha":null,"pendingBootRefreshSha":null,"releaseAgentRefreshState":"blocked","releaseAgentSha256":null,"canonicalTrustPinned":false,"physicalTrustEnrolled":false,"trustEnrollmentState":"blocked","signedReleaseMaterialized":false,"materializedReleaseSha":null,"releaseMaterializationState":"blocked","kernelStaged":false,"candidateArmed":false,"rebootRequested":false,"promotionAttempted":false,"blocker":"%s"}\n' "$blocker" \
        >"$temporary" 2>/dev/null || {
            /bin/busybox rm -f "$temporary" >/dev/null 2>&1 || true
            return 0
        }
    /bin/busybox chmod 600 "$temporary" >/dev/null 2>&1 || true
    /bin/busybox mv -f "$temporary" "$status_dir/owner-status.json" >/dev/null 2>&1 || {
        /bin/busybox rm -f "$temporary" >/dev/null 2>&1 || true
    }
}

[ -n "$RUNTIME_ROOT" ] || {
    log "ORDAX_BASE_RUNTIME_ROOT is empty"
    exit 1
}
[ -n "$HOST_REPO_ROOT" ] || {
    log "ORDAX_BASE_HOST_REPO_ROOT is empty"
    exit 1
}

root_mount_record() {
    /bin/busybox awk '
        $5 == "/" {
            for (i = 6; i <= NF; i++) {
                if ($i == "-") {
                    print $4 "|" $(i + 1) "|" $(i + 2)
                    exit
                }
            }
        }
    ' "$MOUNTINFO_FILE" 2>/dev/null
}

mount_record_for() {
    target=$1
    /bin/busybox awk -v target="$target" '
        $5 == target {
            for (i = 6; i <= NF; i++) {
                if ($i == "-") {
                    print $4 "|" $(i + 1) "|" $(i + 2)
                    exit
                }
            }
        }
    ' "$MOUNTINFO_FILE" 2>/dev/null
}

safe_root_subpath() {
    value=${1:-}
    case "$value" in
        /*) ;;
        *) return 1 ;;
    esac
    case "$value" in
        *'..'*|*'\\'*|*[!A-Za-z0-9_./-]*) return 1 ;;
    esac
    return 0
}

safe_block_source() {
    value=${1:-}
    case "$value" in
        /dev/*) ;;
        *) return 1 ;;
    esac
    case "$value" in
        *'\\'*|*[!A-Za-z0-9_./:+-]*) return 1 ;;
    esac
    return 0
}

ensure_mount_stage() {
    /bin/busybox mkdir -p "$MOUNT_STAGE_HOST" || {
        PREPARE_BLOCKER=mount-stage-failed
        return 1
    }
    stage_record=$(mount_record_for "$MOUNT_STAGE_HOST")
    if [ -n "$stage_record" ]; then
        stage_root=""
        stage_fstype=""
        stage_source=""
        old_ifs=$IFS
        IFS='|'
        read -r stage_root stage_fstype stage_source <<EOF
$stage_record
EOF
        IFS=$old_ifs
        if [ "$stage_root" != "/" ] ||
           [ "$stage_fstype" != "tmpfs" ] ||
           [ "$stage_source" != "tmpfs" ]; then
            PREPARE_BLOCKER=mount-stage-conflict
            log "base-update mount staging path is occupied unexpectedly"
            return 1
        fi
        return 0
    fi

    if ! /bin/busybox mount -t tmpfs -o mode=0700,size=1m tmpfs "$MOUNT_STAGE_HOST"; then
        PREPARE_BLOCKER=mount-stage-failed
        log "cannot create isolated base-update mount staging tmpfs"
        return 1
    fi
    stage_record=$(mount_record_for "$MOUNT_STAGE_HOST")
    [ -n "$stage_record" ] || {
        PREPARE_BLOCKER=mount-stage-failed
        log "base-update mount staging tmpfs was not observable"
        return 1
    }
    return 0
}

prepare_physical_root() {
    PREPARE_BLOCKER=
    record=$(root_mount_record)
    [ -n "$record" ] || {
        PREPARE_BLOCKER=root-mount-unavailable
        log "cannot identify development root mount"
        return 1
    }

    root_subpath=""
    root_fstype=""
    root_source=""
    old_ifs=$IFS
    IFS='|'
    read -r root_subpath root_fstype root_source <<EOF
$record
EOF
    IFS=$old_ifs

    safe_root_subpath "$root_subpath" || {
        PREPARE_BLOCKER=root-subpath-unsafe
        log "development root subpath is unsafe"
        return 1
    }
    [ "$root_fstype" = "ext4" ] || {
        PREPARE_BLOCKER=root-filesystem-unsupported
        log "development root filesystem is not ext4"
        return 1
    }
    safe_block_source "$root_source" || {
        PREPARE_BLOCKER=root-source-unsafe
        log "development root block source is unsafe"
        return 1
    }

    ensure_mount_stage || return 1

    PHYSICAL_MOUNT_HOST=$MOUNT_STAGE_HOST/physical
    /bin/busybox mkdir -p "$PHYSICAL_MOUNT_HOST" || {
        PREPARE_BLOCKER=physical-mount-failed
        return 1
    }

    mounted=$(mount_record_for "$PHYSICAL_MOUNT_HOST")
    if [ -n "$mounted" ]; then
        mounted_root=""
        mounted_fstype=""
        mounted_source=""
        old_ifs=$IFS
        IFS='|'
        read -r mounted_root mounted_fstype mounted_source <<EOF
$mounted
EOF
        IFS=$old_ifs
        if [ "$mounted_root" != "/" ] ||
           [ "$mounted_fstype" != "ext4" ] ||
           [ "$mounted_source" != "$root_source" ]; then
            PREPARE_BLOCKER=physical-mountpoint-conflict
            log "physical root mountpoint is occupied by an unexpected filesystem"
            return 1
        fi
    else
        if ! /bin/busybox mount -t ext4 -o rw "$root_source" "$PHYSICAL_MOUNT_HOST"; then
            PREPARE_BLOCKER=physical-mount-failed
            log "cannot mount full ORDAX filesystem root"
            return 1
        fi
        mounted=$(mount_record_for "$PHYSICAL_MOUNT_HOST")
        [ -n "$mounted" ] || {
            PREPARE_BLOCKER=physical-mount-failed
            log "physical root mount was not observable after mount"
            return 1
        }
    fi

    PHYSICAL_BIND_HOST=$RUNTIME_ROOT$PHYSICAL_MOUNT_CHROOT
    /bin/busybox mkdir -p "$PHYSICAL_BIND_HOST" || {
        PREPARE_BLOCKER=physical-bind-failed
        return 1
    }
    bound=$(mount_record_for "$PHYSICAL_BIND_HOST")
    if [ -n "$bound" ]; then
        bound_root=""
        bound_fstype=""
        bound_source=""
        old_ifs=$IFS
        IFS='|'
        read -r bound_root bound_fstype bound_source <<EOF
$bound
EOF
        IFS=$old_ifs
        if [ "$bound_root" != "/" ] ||
           [ "$bound_fstype" != "ext4" ] ||
           [ "$bound_source" != "$root_source" ]; then
            PREPARE_BLOCKER=physical-bind-conflict
            log "physical ORDAX chroot bind is occupied unexpectedly"
            return 1
        fi
    else
        if ! /bin/busybox mount -o bind "$PHYSICAL_MOUNT_HOST" "$PHYSICAL_BIND_HOST"; then
            PREPARE_BLOCKER=physical-bind-failed
            log "cannot bind physical ORDAX root into graphical runtime"
            return 1
        fi
        bound=$(mount_record_for "$PHYSICAL_BIND_HOST")
        [ -n "$bound" ] || {
            PREPARE_BLOCKER=physical-bind-failed
            log "physical ORDAX chroot bind was not observable"
            return 1
        }
    fi

    seed_subpath=$(seed_root_subpath "$root_subpath")
    safe_root_subpath "$seed_subpath" || {
        PREPARE_BLOCKER=root-subpath-unsafe
        log "development seed root subpath is unsafe"
        return 1
    }

    host_state=$PHYSICAL_MOUNT_HOST$seed_subpath/state/ordax
    if [ ! -d "$host_state" ] || [ -L "$host_state" ]; then
        PREPARE_BLOCKER=development-state-missing
        log "development state alias is unavailable inside physical seed Base"
        return 1
    fi
    if [ -L "$PHYSICAL_MOUNT_HOST$seed_subpath/state" ]; then
        PREPARE_BLOCKER=development-state-unsafe
        log "development state parent is unsafe"
        return 1
    fi

    OWNER_STATE_CHROOT=$PHYSICAL_MOUNT_CHROOT$seed_subpath/state/ordax
    OWNER_BASE_ROOT_CHROOT=$PHYSICAL_MOUNT_CHROOT$seed_subpath
    PHYSICAL_ROOT_SOURCE=$root_source
    return 0
}

discover_esp_read_only() {
    discovery=/srv/ordax-system/services/base-update/esp_discovery.py
    [ -n "$PHYSICAL_ROOT_SOURCE" ] || {
        /bin/busybox rm -f "$ESP_DISCOVERY_FILE" >/dev/null 2>&1 || true
        return 0
    }
    [ -f "$RUNTIME_ROOT$discovery" ] || {
        /bin/busybox rm -f "$ESP_DISCOVERY_FILE" >/dev/null 2>&1 || true
        return 0
    }

    directory=${ESP_DISCOVERY_FILE%/*}
    temporary=$(/bin/busybox mktemp "$directory/.esp-discovery.XXXXXX") || return 0
    /bin/busybox mkdir -p "$directory" >/dev/null 2>&1 || return 0

    if /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$discovery" --root-source "$PHYSICAL_ROOT_SOURCE" >"$temporary" 2>/dev/null
    then
        /bin/busybox chmod 600 "$temporary" >/dev/null 2>&1 || true
        /bin/busybox mv -f "$temporary" "$ESP_DISCOVERY_FILE" >/dev/null 2>&1 || {
            /bin/busybox rm -f "$temporary" >/dev/null 2>&1 || true
        }
    else
        /bin/busybox rm -f "$temporary" "$ESP_DISCOVERY_FILE" >/dev/null 2>&1 || true
    fi
    return 0
}

prepare_efivarfs_preflight_evidence() {
    helper=/srv/ordax-system/services/base-update/efivarfs_preflight.py
    [ -f "$RUNTIME_ROOT$helper" ] || {
        /bin/busybox rm -f "$EFIVARFS_PREFLIGHT_FILE" >/dev/null 2>&1 || true
        return 0
    }

    directory=${EFIVARFS_PREFLIGHT_FILE%/*}
    /bin/busybox mkdir -p "$directory" >/dev/null 2>&1 || return 0
    temporary=$(/bin/busybox mktemp "$directory/.efivarfs-preflight.XXXXXX") || return 0
    /bin/busybox mkdir -p "${EFIVARFS_PREFLIGHT_LOG%/*}" >/dev/null 2>&1 || true

    if /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$helper" \
        >"$temporary" 2>>"$EFIVARFS_PREFLIGHT_LOG"
    then
        if /bin/busybox grep -Fq '"status": "valid"' "$temporary" &&
           /bin/busybox grep -Fq '"uefi_boot_environment_present": true' "$temporary" &&
           /bin/busybox grep -Fq '"writable_mount": true' "$temporary" &&
           /bin/busybox grep -Fq '"direct_mountpoint": true' "$temporary" &&
           /bin/busybox grep -Fq '"probe_only": true' "$temporary" &&
           /bin/busybox grep -Fq '"write_authorized": false' "$temporary" &&
           /bin/busybox grep -Fq '"activation_authorized": false' "$temporary" &&
           /bin/busybox grep -Fq '"variable_written": false' "$temporary" &&
           /bin/busybox grep -Fq '"reboot_requested": false' "$temporary"
        then
            /bin/busybox chmod 600 "$temporary" >/dev/null 2>&1 || true
            if /bin/busybox mv -f "$temporary" "$EFIVARFS_PREFLIGHT_FILE"; then
                log "real efivarfs preflight evidence recorded without activation authorization"
                return 0
            fi
        fi
        log "efivarfs preflight evidence validation failed; activation remains disabled"
    else
        log "efivarfs preflight unavailable on this boot; activation remains disabled"
    fi

    /bin/busybox rm -f "$temporary" "$EFIVARFS_PREFLIGHT_FILE" >/dev/null 2>&1 || true
    return 0
}

prepare_dev_base_candidate() {
    request_sha=$(read_state_value "$DEV_BASE_REQUEST_FILE")
    [ -n "$request_sha" ] || return 0
    if ! is_sha "$request_sha"; then
        log "ignoring invalid development Base request identity"
        /bin/busybox rm -f "$DEV_BASE_REQUEST_FILE" "$DEV_BASE_FETCHING_FILE" >/dev/null 2>&1 || true
        return 0
    fi

    ready_sha=$(read_state_value "$DEV_BASE_READY_FILE")
    if [ "$ready_sha" = "$request_sha" ]; then
        /bin/busybox rm -f "$DEV_BASE_REQUEST_FILE" "$DEV_BASE_FETCHING_FILE" >/dev/null 2>&1 || true
        return 0
    fi

    channel=/srv/ordax-system/services/base-update/dev_channel.py
    if [ ! -f "$RUNTIME_ROOT$channel" ]; then
        log "development Base channel source is unavailable in replaceable runtime"
        return 0
    fi
    [ -n "$OWNER_STATE_CHROOT" ] && [ -n "$OWNER_BASE_ROOT_CHROOT" ] || return 0

    destination=$OWNER_STATE_CHROOT/base-update/dev-candidates
    version_root=$OWNER_BASE_ROOT_CHROOT/versions
    write_state_value "$DEV_BASE_FETCHING_FILE" "$request_sha" || return 0
    /bin/busybox mkdir -p "${DEV_BASE_LOG%/*}" >/dev/null 2>&1 || true

    if /bin/busybox chroot "$RUNTIME_ROOT" \
        /usr/bin/python3 "$channel" \
        --source-commit "$request_sha" \
        --destination-root "$destination" \
        --version-root "$version_root" \
        >>"$DEV_BASE_LOG" 2>&1
    then
        write_state_value "$DEV_BASE_READY_FILE" "$request_sha" || true
        /bin/busybox rm -f "$DEV_BASE_REQUEST_FILE" >/dev/null 2>&1 || true
        log "development Base candidate and versioned rootfs ready: $request_sha"
    else
        rc=$?
        if [ "$rc" -eq 2 ]; then
            log "development Base candidate not published yet for $request_sha; request remains armed"
        else
            log "development Base candidate preparation failed for $request_sha; current runtime remains active"
        fi
    fi
    /bin/busybox rm -f "$DEV_BASE_FETCHING_FILE" >/dev/null 2>&1 || true
    return 0
}

prepare_esp_readonly_preflight() {
    ready_sha=$(read_state_value "$DEV_BASE_READY_FILE")
    if ! is_sha "$ready_sha"; then
        /bin/busybox rm -f "$ESP_READONLY_PREFLIGHT_FILE" "$ESP_READONLY_PREFLIGHT_SHA_FILE" >/dev/null 2>&1 || true
        return 0
    fi

    cached_sha=$(read_state_value "$ESP_READONLY_PREFLIGHT_SHA_FILE")
    if [ "$cached_sha" = "$ready_sha" ] && [ -s "$ESP_READONLY_PREFLIGHT_FILE" ]; then
        return 0
    fi

    helper=/srv/ordax-system/services/base-update/esp_readonly.py
    [ -n "$PHYSICAL_ROOT_SOURCE" ] && [ -f "$RUNTIME_ROOT$helper" ] || {
        /bin/busybox rm -f "$ESP_READONLY_PREFLIGHT_FILE" "$ESP_READONLY_PREFLIGHT_SHA_FILE" >/dev/null 2>&1 || true
        return 0
    }

    directory=${ESP_READONLY_PREFLIGHT_FILE%/*}
    /bin/busybox mkdir -p "$directory" >/dev/null 2>&1 || return 0
    temporary=$(/bin/busybox mktemp "$directory/.esp-readonly-preflight.XXXXXX") || return 0

    if /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$helper" \
        --root-source "$PHYSICAL_ROOT_SOURCE" \
        --mount-root "$ESP_READONLY_MOUNT_ROOT" \
        >"$temporary" 2>/dev/null
    then
        /bin/busybox chmod 600 "$temporary" >/dev/null 2>&1 || true
        if /bin/busybox mv -f "$temporary" "$ESP_READONLY_PREFLIGHT_FILE"; then
            write_state_value "$ESP_READONLY_PREFLIGHT_SHA_FILE" "$ready_sha" || {
                /bin/busybox rm -f "$ESP_READONLY_PREFLIGHT_FILE" "$ESP_READONLY_PREFLIGHT_SHA_FILE" >/dev/null 2>&1 || true
            }
        else
            /bin/busybox rm -f "$temporary" "$ESP_READONLY_PREFLIGHT_FILE" "$ESP_READONLY_PREFLIGHT_SHA_FILE" >/dev/null 2>&1 || true
        fi
    else
        /bin/busybox rm -f "$temporary" "$ESP_READONLY_PREFLIGHT_FILE" "$ESP_READONLY_PREFLIGHT_SHA_FILE" >/dev/null 2>&1 || true
    fi
    return 0
}

prepare_dev_base_physical_stage() {
    ready_sha=$(read_state_value "$DEV_BASE_READY_FILE")
    if ! is_sha "$ready_sha"; then
        /bin/busybox rm -f "$DEV_BASE_STAGED_FILE" "$DEV_BASE_STAGE_RESULT_FILE" >/dev/null 2>&1 || true
        return 0
    fi

    preflight_sha=$(read_state_value "$ESP_READONLY_PREFLIGHT_SHA_FILE")
    if [ "$preflight_sha" != "$ready_sha" ] || [ ! -s "$ESP_READONLY_PREFLIGHT_FILE" ]; then
        return 0
    fi

    staged_sha=$(read_state_value "$DEV_BASE_STAGED_FILE")
    if [ "$staged_sha" = "$ready_sha" ] && [ -s "$DEV_BASE_STAGE_RESULT_FILE" ]; then
        return 0
    fi

    helper=/srv/ordax-system/services/base-update/dev_physical_stage.py
    [ -n "$PHYSICAL_ROOT_SOURCE" ] &&
    [ -n "$OWNER_STATE_CHROOT" ] &&
    [ -n "$OWNER_BASE_ROOT_CHROOT" ] &&
    [ -f "$RUNTIME_ROOT$helper" ] || return 0

    candidate_root=$OWNER_STATE_CHROOT/base-update/dev-candidates
    version_root=$OWNER_BASE_ROOT_CHROOT/versions
    directory=${DEV_BASE_STAGE_RESULT_FILE%/*}
    /bin/busybox mkdir -p "$directory" >/dev/null 2>&1 || return 0
    temporary=$(/bin/busybox mktemp "$directory/.dev-base-stage.XXXXXX") || return 0

    /bin/busybox mkdir -p "${DEV_BASE_STAGE_LOG%/*}" >/dev/null 2>&1 || true
    if /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$helper" \
        --repo-root /srv/ordax-repo \
        --root-source "$PHYSICAL_ROOT_SOURCE" \
        --candidate-root "$candidate_root" \
        --version-root "$version_root" \
        --source-commit "$ready_sha" \
        --mount-root "$ESP_STAGE_MOUNT_ROOT" \
        >"$temporary" 2>>"$DEV_BASE_STAGE_LOG"
    then
        if /bin/busybox grep -Fq "\"source_commit\": \"$ready_sha\"" "$temporary" &&
           /bin/busybox grep -Fq '"activation_performed": false' "$temporary" &&
           /bin/busybox grep -Fq '"efi_variable_written": false' "$temporary" &&
           /bin/busybox grep -Fq '"reboot_requested": false' "$temporary"
        then
            /bin/busybox chmod 600 "$temporary" >/dev/null 2>&1 || true
            if /bin/busybox mv -f "$temporary" "$DEV_BASE_STAGE_RESULT_FILE"; then
                if write_state_value "$DEV_BASE_STAGED_FILE" "$ready_sha"; then
                    log "development Base staged in inactive ESP slot: $ready_sha"
                    return 0
                fi
            fi
        fi
        log "development Base stage result validation failed for $ready_sha"
    else
        log "development Base physical staging failed for $ready_sha; current boot remains unchanged"
    fi

    /bin/busybox rm -f "$temporary" "$DEV_BASE_STAGED_FILE" "$DEV_BASE_STAGE_RESULT_FILE" >/dev/null 2>&1 || true
    return 0
}

prepare_dev_base_activation_readiness() {
    ready_sha=$(read_state_value "$DEV_BASE_READY_FILE")
    staged_sha=$(read_state_value "$DEV_BASE_STAGED_FILE")
    if ! is_sha "$ready_sha" || [ "$staged_sha" != "$ready_sha" ]; then
        /bin/busybox rm -f "$DEV_BASE_ACTIVATION_READINESS_FILE" "$DEV_BASE_ACTIVATION_READINESS_SHA_FILE" >/dev/null 2>&1 || true
        return 0
    fi

    [ -s "$DEV_BASE_STAGE_RESULT_FILE" ] || {
        /bin/busybox rm -f "$DEV_BASE_ACTIVATION_READINESS_FILE" "$DEV_BASE_ACTIVATION_READINESS_SHA_FILE" >/dev/null 2>&1 || true
        return 0
    }

    cached_sha=$(read_state_value "$DEV_BASE_ACTIVATION_READINESS_SHA_FILE")
    if [ "$cached_sha" = "$ready_sha" ] && [ -s "$DEV_BASE_ACTIVATION_READINESS_FILE" ]; then
        return 0
    fi

    helper=/srv/ordax-system/services/base-update/dev_activation_readiness.py
    [ -n "$PHYSICAL_ROOT_SOURCE" ] &&
    [ -n "$OWNER_STATE_CHROOT" ] &&
    [ -n "$OWNER_BASE_ROOT_CHROOT" ] &&
    [ -f "$RUNTIME_ROOT$helper" ] || return 0

    candidate_root=$OWNER_STATE_CHROOT/base-update/dev-candidates
    version_root=$OWNER_BASE_ROOT_CHROOT/versions
    staged_sha_file=$OWNER_STATE_CHROOT/base-update/dev-base-staged-sha
    stage_result_file=$OWNER_STATE_CHROOT/base-update/dev-base-stage-result.json
    directory=${DEV_BASE_ACTIVATION_READINESS_FILE%/*}
    /bin/busybox mkdir -p "$directory" >/dev/null 2>&1 || return 0
    temporary=$(/bin/busybox mktemp "$directory/.dev-base-activation-readiness.XXXXXX") || return 0
    /bin/busybox mkdir -p "${DEV_BASE_ACTIVATION_READINESS_LOG%/*}" >/dev/null 2>&1 || true

    if /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$helper" \
        --root-source "$PHYSICAL_ROOT_SOURCE" \
        --candidate-root "$candidate_root" \
        --version-root "$version_root" \
        --source-commit "$ready_sha" \
        --staged-sha-file "$staged_sha_file" \
        --stage-result-file "$stage_result_file" \
        --mount-root "$ESP_ACTIVATION_READINESS_MOUNT_ROOT" \
        >"$temporary" 2>>"$DEV_BASE_ACTIVATION_READINESS_LOG"
    then
        if /bin/busybox grep -Fq "\"source_commit\": \"$ready_sha\"" "$temporary" &&
           /bin/busybox grep -Fq '"ready_for_activation_gate": true' "$temporary" &&
           /bin/busybox grep -Fq '"activation_authorized": false' "$temporary" &&
           /bin/busybox grep -Fq '"runtime_activation_wiring_enabled": false' "$temporary" &&
           /bin/busybox grep -Fq '"efi_variable_written": false' "$temporary" &&
           /bin/busybox grep -Fq '"reboot_requested": false' "$temporary"
        then
            /bin/busybox chmod 600 "$temporary" >/dev/null 2>&1 || true
            if /bin/busybox mv -f "$temporary" "$DEV_BASE_ACTIVATION_READINESS_FILE"; then
                if write_state_value "$DEV_BASE_ACTIVATION_READINESS_SHA_FILE" "$ready_sha"; then
                    log "development Base activation readiness verified without authorization: $ready_sha"
                    return 0
                fi
            fi
        fi
        log "development Base activation readiness result validation failed for $ready_sha"
    else
        log "development Base activation readiness failed for $ready_sha; current boot remains unchanged"
    fi

    /bin/busybox rm -f "$temporary" "$DEV_BASE_ACTIVATION_READINESS_FILE" "$DEV_BASE_ACTIVATION_READINESS_SHA_FILE" >/dev/null 2>&1 || true
    return 0
}

prepare_dev_base_postboot_promotion() {
    staged_sha=$(read_state_value "$DEV_BASE_STAGED_FILE")
    readiness_sha=$(read_state_value "$DEV_BASE_ACTIVATION_READINESS_SHA_FILE")
    if ! is_sha "$staged_sha" || [ "$readiness_sha" != "$staged_sha" ]; then
        return 0
    fi
    [ -s "$DEV_BASE_ACTIVATION_READINESS_FILE" ] || return 0

    /bin/busybox grep -q 'ordax.base_candidate=' /proc/cmdline 2>/dev/null || return 0
    /bin/busybox grep -q 'ordax.base_slot=' /proc/cmdline 2>/dev/null || return 0
    is_sha "$source_sha" || return 0

    promoted_sha=$(read_state_value "$DEV_BASE_PROMOTED_FILE")
    if [ "$promoted_sha" = "$staged_sha" ] && [ -s "$DEV_BASE_PROMOTION_RESULT_FILE" ]; then
        return 0
    fi

    helper=/srv/ordax-system/services/base-update/dev_postboot_promote.py
    [ -n "$PHYSICAL_ROOT_SOURCE" ] &&
    [ -n "$OWNER_STATE_CHROOT" ] &&
    [ -f "$RUNTIME_ROOT$helper" ] || return 0

    base_heartbeat=$OWNER_STATE_CHROOT/base-update/base-heartbeat.json
    surface_heartbeat=/run/ordax-update/surface-heartbeat.json
    [ -s "$base_heartbeat" ] &&
    [ -s "$RUNTIME_ROOT$surface_heartbeat" ] &&
    [ -s "$RUNTIME_ROOT/run/ordax-update/base-boot-id" ] &&
    [ -s "$RUNTIME_ROOT/run/ordax-update/healthy-sha" ] || return 0

    directory=${DEV_BASE_PROMOTION_RESULT_FILE%/*}
    /bin/busybox mkdir -p "$directory" >/dev/null 2>&1 || return 0
    temporary=$(/bin/busybox mktemp "$directory/.dev-base-promotion.XXXXXX") || return 0
    /bin/busybox mkdir -p "${DEV_BASE_PROMOTION_LOG%/*}" >/dev/null 2>&1 || true

    if /bin/busybox chroot "$RUNTIME_ROOT" /usr/bin/python3 "$helper" \
        --root-source "$PHYSICAL_ROOT_SOURCE" \
        --esp-mount-root "$ESP_PROMOTION_MOUNT_ROOT" \
        --state-root "$OWNER_STATE_CHROOT" \
        --cmdline /proc/cmdline \
        --boot-id /run/ordax-update/base-boot-id \
        --base-heartbeat "$base_heartbeat" \
        --surface-heartbeat "$surface_heartbeat" \
        --healthy-sha /run/ordax-update/healthy-sha \
        --source-sha "$source_sha" \
        --expected-release-sha "$staged_sha" \
        >"$temporary" 2>>"$DEV_BASE_PROMOTION_LOG"
    then
        if /bin/busybox grep -Fq "\"source_commit\": \"$staged_sha\"" "$temporary" &&
           /bin/busybox grep -Fq '"status": "promoted"' "$temporary" &&
           /bin/busybox grep -Fq '"health_verified": true' "$temporary" &&
           /bin/busybox grep -Fq '"postflight_verified": true' "$temporary" &&
           /bin/busybox grep -Fq '"reboot_requested": false' "$temporary" &&
           /bin/busybox grep -Fq '"efi_variable_written": false' "$temporary"
        then
            /bin/busybox chmod 600 "$temporary" >/dev/null 2>&1 || true
            if /bin/busybox mv -f "$temporary" "$DEV_BASE_PROMOTION_RESULT_FILE"; then
                if write_state_value "$DEV_BASE_PROMOTED_FILE" "$staged_sha"; then
                    log "development Base healthy candidate promoted: $staged_sha"
                    return 0
                fi
            fi
        fi
        log "development Base promotion result validation failed for $staged_sha"
    else
        rc=$?
        if [ "$rc" -ne 2 ]; then
            log "development Base postboot promotion not ready for $staged_sha; current boot remains unchanged"
        fi
    fi

    /bin/busybox rm -f "$temporary" >/dev/null 2>&1 || true
    return 0
}

while :; do
    if [ ! -x "$RUNTIME_ROOT/usr/bin/python3" ]; then
        write_preflight_status runtime-unavailable
    elif [ ! -f "$RUNTIME_ROOT/srv/ordax-system/services/base-update/orchestrator.py" ]; then
        write_preflight_status owner-source-unavailable
    elif [ ! -d "$RUNTIME_ROOT/srv/ordax-repo" ]; then
        write_preflight_status repo-bind-unavailable
    elif prepare_physical_root; then
        source_sha=""
        case "$DISTRIBUTION_PROFILE" in
            stable-mvp)
                if is_sha "$SOURCE_SHA_HINT"; then
                    source_sha=$SOURCE_SHA_HINT
                fi
                ;;
            owner-development)
                if [ -x /usr/bin/git ]; then
                    source_sha=$(/usr/bin/git -C "$HOST_REPO_ROOT" rev-parse HEAD 2>/dev/null || true)
                fi
                is_sha "$source_sha" || source_sha=""
                ;;
            *)
                source_sha=""
                ;;
        esac

        ORDAX_BASE_SOURCE_SHA="$source_sha" \
            /bin/busybox chroot "$RUNTIME_ROOT" \
            /usr/bin/python3 /srv/ordax-system/services/base-update/orchestrator.py \
            --repo-root /srv/ordax-repo \
            --state-root "$OWNER_STATE_CHROOT" \
            --physical-root "$PHYSICAL_MOUNT_CHROOT" \
            >/dev/null 2>&1 || true
        discover_esp_read_only
        prepare_efivarfs_preflight_evidence
        if [ "$DISTRIBUTION_PROFILE" = "owner-development" ]; then
            prepare_dev_base_candidate
            prepare_esp_readonly_preflight
            prepare_dev_base_physical_stage
            prepare_dev_base_activation_readiness
            prepare_dev_base_postboot_promotion
        fi
    else
        write_preflight_status "${PREPARE_BLOCKER:-physical-root-unavailable}"
    fi

    /bin/busybox sleep "$INTERVAL"
done
