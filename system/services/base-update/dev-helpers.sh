#!/bin/sh
set -eu

WORKTREE=${ORDAX_WORKTREE:-/workspace/ordax}
STATE_DIR=${ORDAX_STATE_DIR:-/state/ordax}
TARGET_ROOT=${ORDAX_DEV_HELPER_TARGET_ROOT:-/}
SOURCE_SHA=${ORDAX_SOURCE_SHA:-}
RUN_DIR=${ORDAX_UPDATE_RUN_DIR:-/run/ordax-update}
MAX_HELPER_BYTES=1048576
HELPER_GIT_TIMEOUT=${ORDAX_DEV_HELPER_GIT_TIMEOUT_SECONDS:-30}

case "$HELPER_GIT_TIMEOUT" in
    ''|*[!0-9]*) HELPER_GIT_TIMEOUT=30 ;;
esac
[ "$HELPER_GIT_TIMEOUT" -ge 5 ] 2>/dev/null || HELPER_GIT_TIMEOUT=30

GIT_TERMINAL_PROMPT=0
export GIT_TERMINAL_PROMPT

bb() {
    if [ -x /bin/busybox ]; then
        /bin/busybox "$@"
    else
        command "$@"
    fi
}

run_bounded_git() {
    if [ -x /bin/busybox ]; then
        /bin/busybox timeout -k 2 "$HELPER_GIT_TIMEOUT" \
            git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=15 "$@"
        return $?
    fi
    timeout -k 2 "$HELPER_GIT_TIMEOUT" \
        git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=15 "$@"
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
    SOURCE_SHA=$(run_bounded_git -C "$WORKTREE" rev-parse HEAD 2>/dev/null || true)
fi
is_sha "$SOURCE_SHA" || {
    echo "ordax-dev-helpers: source commit is invalid" >&2
    exit 1
}

for required in bootstrap/dev-base/ordax-dev-init bootstrap/dev-base/ordax-pull bootstrap/dev-base/ordax-main-watch; do
    run_bounded_git -C "$WORKTREE" cat-file -e "$SOURCE_SHA:$required" 2>/dev/null || {
        echo "ordax-dev-helpers: required helper is absent from source commit: $required" >&2
        exit 1
    }
done

root_prefix=${TARGET_ROOT%/}
stage_manifest=$STATE_DIR/.dev-helper-stage.$$
target_registry=$STATE_DIR/.dev-helper-targets.$$
source_stage_root=$STATE_DIR/.dev-helper-sources.$$
receipt=$STATE_DIR/dev-helpers-sha
receipt_tmp=$receipt.tmp.$$
watcher_changed=0
watcher_seen=0

cleanup() {
    if [ -f "$stage_manifest" ]; then
        while IFS="$(printf '\t')" read -r temporary _target; do
            [ -n "$temporary" ] && bb rm -f "$temporary" 2>/dev/null || true
        done <"$stage_manifest"
    fi
    bb rm -rf "$source_stage_root" 2>/dev/null || true
    bb rm -f "$stage_manifest" "$target_registry" "$receipt_tmp" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

bb mkdir -p "$STATE_DIR" "$source_stage_root"
: >"$stage_manifest"
: >"$target_registry"
bb chmod 600 "$stage_manifest" "$target_registry"

materialize_source() {
    source_relative=$1
    source=$WORKTREE/$source_relative
    if [ -f "$source" ] && [ ! -L "$source" ]; then
        printf '%s\n' "$source"
        return 0
    fi

    tree_entry=$(run_bounded_git -C "$WORKTREE" ls-tree "$SOURCE_SHA" -- "$source_relative" 2>/dev/null || true)
    set -- $tree_entry
    mode=${1:-}
    object_type=${2:-}
    case "$mode:$object_type" in
        100644:blob|100755:blob) ;;
        *)
            echo "ordax-dev-helpers: source is missing or unsafe at exact commit: $source_relative" >&2
            return 1
            ;;
    esac

    staged_source=$source_stage_root/$source_relative
    bb mkdir -p "${staged_source%/*}"
    run_bounded_git -C "$WORKTREE" show "$SOURCE_SHA:$source_relative" >"$staged_source" 2>/dev/null || {
        bb rm -f "$staged_source"
        echo "ordax-dev-helpers: could not materialize exact helper source: $source_relative" >&2
        return 1
    }
    [ -f "$staged_source" ] && [ ! -L "$staged_source" ] || return 1
    printf '%s\n' "$staged_source"
}

stage_helper() {
    source_relative=$1
    target_relative=$2
    target=$root_prefix/$target_relative
    parent=${target%/*}

    if bb grep -F -x "$target" "$target_registry" >/dev/null 2>&1; then
        echo "ordax-dev-helpers: duplicate target discovered: $target_relative" >&2
        exit 1
    fi
    printf '%s\n' "$target" >>"$target_registry"

    source=$(materialize_source "$source_relative") || exit 1
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

    if [ "$target_relative" = "usr/local/bin/ordax-main-watch" ]; then
        watcher_seen=1
    fi

    if [ -f "$target" ] && bb cmp "$source" "$target" >/dev/null 2>&1; then
        return 0
    fi

    if [ "$target_relative" = "usr/local/bin/ordax-main-watch" ]; then
        watcher_changed=1
    fi

    temporary=$target.ordax-refresh.$$
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
    [ "$watcher_seen" -eq 1 ] || return 0
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

helper_paths=$(run_bounded_git -C "$WORKTREE" ls-tree -r --name-only "$SOURCE_SHA" -- \
    bootstrap/dev-base bootstrap/base-update/owner-development 2>/dev/null \
    | while IFS= read -r source_relative; do
        case "$source_relative" in
            bootstrap/dev-base/ordax-*|bootstrap/base-update/owner-development/ordax-*)
                printf '%s\n' "$source_relative"
                ;;
        esac
    done)
[ -n "$helper_paths" ] || {
    echo "ordax-dev-helpers: exact commit contains no runtime helpers" >&2
    exit 1
}

while IFS= read -r source_relative; do
    [ -n "$source_relative" ] || continue
    case "$source_relative" in
        bootstrap/dev-base/ordax-dev-init)
            target_relative=sbin/ordax-dev-init
            ;;
        bootstrap/dev-base/ordax-*|bootstrap/base-update/owner-development/ordax-*)
            target_relative=usr/local/bin/${source_relative##*/}
            ;;
        *)
            echo "ordax-dev-helpers: unexpected discovered helper: $source_relative" >&2
            exit 1
            ;;
    esac
    stage_helper "$source_relative" "$target_relative"
done <<EOF
$helper_paths
EOF

if run_bounded_git -C "$WORKTREE" cat-file -e "$SOURCE_SHA:bootstrap/recovery/entrypoint" 2>/dev/null; then
    stage_helper bootstrap/recovery/entrypoint ordax/bootstrap/recovery/entrypoint
fi

while IFS="$(printf '\t')" read -r temporary target; do
    [ -n "$temporary" ] && [ -n "$target" ] || continue
    bb mv -f "$temporary" "$target"
done <"$stage_manifest"

printf '%s\n' "$SOURCE_SHA" >"$receipt_tmp"
bb chmod 600 "$receipt_tmp"
bb mv -f "$receipt_tmp" "$receipt"

schedule_main_watch_refresh

trap - EXIT HUP INT TERM
bb rm -rf "$source_stage_root" 2>/dev/null || true
bb rm -f "$stage_manifest" "$target_registry"
printf 'ORDAX_DEV_HELPERS_SHA=%s\n' "$SOURCE_SHA"
