#!/bin/sh
set -eu

WORKTREE=${ORDAX_WORKTREE:-/workspace/ordax}
STATE_DIR=${ORDAX_STATE_DIR:-/state/ordax}
TARGET_ROOT=${ORDAX_DEV_HELPER_TARGET_ROOT:-/}
SOURCE_SHA=${ORDAX_SOURCE_SHA:-}
RUN_DIR=${ORDAX_UPDATE_RUN_DIR:-/run/ordax-update}
MAX_HELPER_BYTES=1048576
HELPER_MANIFEST=$WORKTREE/system/services/base-update/dev-helper-manifest.tsv

bb() {
    if [ -x /bin/busybox ]; then
        /bin/busybox "$@"
    else
        command "$@"
    fi
}

case "$TARGET_ROOT" in
    /*) ;;
    *)
        echo "ordax-dev-helpers: target root must be absolute" >&2
        exit 1
        ;;
esac

is_sha() {
    value=${1:-}
    [ "${#value}" -eq 40 ] || return 1
    case "$value" in
        ''|*[!0-9a-f]*) return 1 ;;
    esac
}

if ! is_sha "$SOURCE_SHA"; then
    SOURCE_SHA=$(git -C "$WORKTREE" rev-parse HEAD 2>/dev/null || true)
fi
is_sha "$SOURCE_SHA" || {
    echo "ordax-dev-helpers: source commit is invalid" >&2
    exit 1
}

root_prefix=${TARGET_ROOT%/}
stage_manifest=$STATE_DIR/.dev-helper-stage.$$
receipt=$STATE_DIR/dev-helpers-sha
receipt_tmp=$receipt.tmp.$$
watcher_source=$WORKTREE/bootstrap/dev-base/ordax-main-watch
watcher_target=$root_prefix/usr/local/bin/ordax-main-watch
watcher_changed=1
if [ -f "$watcher_source" ] && [ ! -L "$watcher_source" ] && \
   [ -f "$watcher_target" ] && [ ! -L "$watcher_target" ] && \
   bb cmp "$watcher_source" "$watcher_target" >/dev/null 2>&1; then
    watcher_changed=0
fi

cleanup() {
    if [ -f "$stage_manifest" ]; then
        while IFS="$(printf '\t')" read -r temporary _target; do
            [ -n "$temporary" ] && bb rm -f "$temporary" 2>/dev/null || true
        done <"$stage_manifest"
    fi
    bb rm -f "$stage_manifest" "$receipt_tmp" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

bb mkdir -p "$STATE_DIR"
: >"$stage_manifest"
bb chmod 600 "$stage_manifest"

stage_helper() {
    source_relative=$1
    target_relative=$2
    source=$WORKTREE/$source_relative
    target=$root_prefix/$target_relative
    parent=${target%/*}
    temporary=$target.ordax-refresh.$$

    [ -f "$source" ] && [ ! -L "$source" ] || {
        echo "ordax-dev-helpers: source is missing or unsafe: $source_relative" >&2
        exit 1
    }
    size=$(bb wc -c <"$source" | bb tr -d ' ')
    case "$size" in
        ''|*[!0-9]*) size=0 ;;
    esac
    [ "$size" -gt 0 ] && [ "$size" -le "$MAX_HELPER_BYTES" ] || {
        echo "ordax-dev-helpers: source size is invalid: $source_relative" >&2
        exit 1
    }
    /bin/sh -n "$source" || {
        echo "ordax-dev-helpers: shell syntax is invalid: $source_relative" >&2
        exit 1
    }

    bb mkdir -p "$parent"
    [ ! -L "$parent" ] || {
        echo "ordax-dev-helpers: target parent is a symlink: $target_relative" >&2
        exit 1
    }
    if [ -e "$target" ] || [ -L "$target" ]; then
        [ -f "$target" ] && [ ! -L "$target" ] || {
            echo "ordax-dev-helpers: target is not a regular file: $target_relative" >&2
            exit 1
        }
    fi

    bb rm -f "$temporary"
    bb cp "$source" "$temporary"
    bb chmod 755 "$temporary"
    /bin/sh -n "$temporary" || {
        bb rm -f "$temporary"
        echo "ordax-dev-helpers: staged shell syntax is invalid: $target_relative" >&2
        exit 1
    }
    printf '%s\t%s\n' "$temporary" "$target" >>"$stage_manifest"
}

schedule_main_watch_refresh() {
    [ "$TARGET_ROOT" = "/" ] || return 0
    [ "$watcher_changed" -eq 1 ] || return 0
    [ -x /usr/local/bin/ordax-main-watch ] || return 0

    bb mkdir -p "$RUN_DIR"
    watcher_pids=""
    for proc in /proc/[0-9]*; do
        [ -r "$proc/cmdline" ] || continue
        pid=${proc#/proc/}
        case "$pid" in
            ''|*[!0-9]*) continue ;;
        esac
        [ "$pid" != "$$" ] || continue
        command_line=$(bb tr '\000' ' ' <"$proc/cmdline" 2>/dev/null || true)
        case "$command_line" in
            *"/usr/local/bin/ordax-main-watch"*) watcher_pids="$watcher_pids $pid" ;;
        esac
    done

    if [ -z "$watcher_pids" ]; then
        if [ -x /bin/setsid ]; then
            /bin/setsid /usr/local/bin/ordax-main-watch >/dev/null 2>&1 </dev/null &
        else
            /usr/local/bin/ordax-main-watch >/dev/null 2>&1 </dev/null &
        fi
        return 0
    fi

    handoff=$RUN_DIR/main-watch-handoff.$$.sh
    cat >"$handoff" <<EOF
#!/bin/sh
set -u
pids="$watcher_pids"
for pid in \$pids; do
    kill -TERM "\$pid" >/dev/null 2>&1 || true
done
remaining=8
while [ "\$remaining" -gt 0 ]; do
    alive=0
    for pid in \$pids; do
        if kill -0 "\$pid" >/dev/null 2>&1; then
            alive=1
            break
        fi
    done
    [ "\$alive" -eq 0 ] && break
    sleep 1
    remaining=\$((remaining - 1))
done
for pid in \$pids; do
    kill -0 "\$pid" >/dev/null 2>&1 && kill -KILL "\$pid" >/dev/null 2>&1 || true
done
# Do not delete the watcher lock here. A TERM-clean exit removes it itself;
# after KILL, the replacement watcher validates the recorded PID and safely
# reclaims only a demonstrably stale lock.
rm -f "$handoff" >/dev/null 2>&1 || true
if [ -x /bin/setsid ]; then
    exec /bin/setsid /usr/local/bin/ordax-main-watch
fi
exec /usr/local/bin/ordax-main-watch
EOF
    bb chmod 700 "$handoff"
    if [ -x /bin/setsid ]; then
        /bin/setsid "$handoff" >/dev/null 2>&1 </dev/null &
    else
        "$handoff" >/dev/null 2>&1 </dev/null &
    fi
}

# Native dependencies belong to the same canonical helper manifest.
# A Git checkout may arrive before an A/B Base boot, but never install a
# shell which needs an absent or incompatible rootfs-owned executable.
# There is no alternate download, local copy, shadow installer or bypass.
require_native_prerequisite() {
    requirement=$1
    [ -n "$requirement" ] || return 0
    case "$requirement" in
        usr/local/bin/ordax-*@*/*) ;;
        *) echo "ordax-dev-helpers: invalid native prerequisite" >&2; return 1 ;;
    esac
    native_relative=${requirement%%@*}
    native_expected_abi=${requirement#*@}
    case "$native_relative:$native_expected_abi" in
        *..*|*//*|*\\*|*' '*|*'?'*|*'#'*|*'%'*) return 1 ;;
    esac
    native_parent=$root_prefix/usr/local/bin
    native_target=$root_prefix/$native_relative
    if [ ! -d "$native_parent" ] || [ -L "$native_parent" ] ||
       [ ! -f "$native_target" ] || [ -L "$native_target" ] ||
       [ ! -x "$native_target" ]; then
        echo "ordax-dev-helpers: required native Base helper unavailable: $native_relative" >&2
        return 1
    fi
    native_actual_abi=$("$native_target" --abi 2>/dev/null) || {
        echo "ordax-dev-helpers: native Base helper ABI probe failed: $native_relative" >&2
        return 1
    }
    if [ "$native_actual_abi" != "$native_expected_abi" ]; then
        echo "ordax-dev-helpers: native Base helper ABI mismatch: $native_relative" >&2
        return 1
    fi
}

[ -f "$HELPER_MANIFEST" ] && [ ! -L "$HELPER_MANIFEST" ] || {
    echo "ordax-dev-helpers: canonical helper manifest is missing or unsafe" >&2
    exit 1
}

helper_count=0
while IFS="$(printf '\t')" read -r source_relative target_relative native_prerequisite; do
    case "$source_relative" in
        ""|\#*) continue ;;
        /*|*".."*)
            echo "ordax-dev-helpers: invalid source path in helper manifest: $source_relative" >&2
            exit 1
            ;;
        bootstrap/dev-base/*|bootstrap/base-update/owner-development/*|bootstrap/recovery/entrypoint) ;;
        *)
            echo "ordax-dev-helpers: source path is outside the helper policy: $source_relative" >&2
            exit 1
            ;;
    esac
    case "$target_relative" in
        ""|/*|*".."*)
            echo "ordax-dev-helpers: invalid target path in helper manifest: $target_relative" >&2
            exit 1
            ;;
        usr/local/bin/ordax-*|sbin/ordax-dev-init|ordax/bootstrap/recovery/entrypoint) ;;
        *)
            echo "ordax-dev-helpers: target path is outside the helper policy: $target_relative" >&2
            exit 1
            ;;
    esac
    require_native_prerequisite "$native_prerequisite" || exit 1
    stage_helper "$source_relative" "$target_relative"
    helper_count=$((helper_count + 1))
done <"$HELPER_MANIFEST"
[ "$helper_count" -gt 0 ] || {
    echo "ordax-dev-helpers: canonical helper manifest is empty" >&2
    exit 1
}

while IFS="$(printf '\t')" read -r temporary target; do
    [ -n "$temporary" ] && [ -n "$target" ] || exit 1
    bb mv -f "$temporary" "$target"
done <"$stage_manifest"

printf '%s\n' "$SOURCE_SHA" >"$receipt_tmp"
bb chmod 600 "$receipt_tmp"
bb mv -f "$receipt_tmp" "$receipt"

schedule_main_watch_refresh

trap - EXIT HUP INT TERM
bb rm -f "$stage_manifest"
printf 'ORDAX_DEV_HELPERS_SHA=%s\n' "$SOURCE_SHA"
