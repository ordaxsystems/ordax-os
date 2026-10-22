#!/bin/sh
# Owner/Development adapter for an already verified, content-addressed EROFS.
# The signed artifact must be staged by the authorized delivery owner.
# Missing/corrupt AI may never block boot, recovery, update or the Surface.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

WORKTREE=${ORDAX_WORKTREE:-/workspace/ordax}
STATE_DIR=${ORDAX_STATE_DIR:-/state/ordax}
IMAGE_SHA256=b244056dad3609357e8a70433f53f41becacd8f3bd93da3d8b23f9e99d86e11a
IMAGE_SIZE=568061952
IMAGE_DIR=$STATE_DIR/local-ai/sha256/$IMAGE_SHA256
IMAGE=$IMAGE_DIR/local-ai-runtime.erofs
RUNTIME_ROOT=/run/ordax/runtime/local-ai
AUTH_DIR=/run/ordax/local-ai-auth
RUN_DIR=/run/ordax
SERVICE_DIR=$RUN_DIR/local-ai-service
PID_FILE=$SERVICE_DIR/pid
KEY_FILE=$AUTH_DIR/key
LOG_FILE=$SERVICE_DIR/llama-server.log

bb() {
    if [ -x /bin/busybox ]; then /bin/busybox "$@"; else command "$@"; fi
}
report() { printf 'ordax-local-ai-dev: %s\n' "$*" >&2; }
is_pid() {
    case "$1" in ''|*[!0-9]*) return 1 ;; esac
    [ "$1" -gt 1 ] 2>/dev/null
}
owned_process() {
    pid=$1
    is_pid "$pid" || return 1
    [ -r "/proc/$pid/exe" ] || return 1
    executable=$(bb readlink "/proc/$pid/exe" 2>/dev/null || true)
    [ "$executable" = "$RUNTIME_ROOT/bin/llama-server" ] || return 1
    kill -0 "$pid" 2>/dev/null
}
mounted_here() {
    bb awk -v path="$RUNTIME_ROOT" '$2 == path { found=1 } END { exit !found }' /proc/mounts
}
safe_file() { [ -f "$1" ] && [ ! -L "$1" ]; }
remove_private_file() {
    if safe_file "$1"; then bb rm -f "$1"; fi
}
release_partial() {
    if mounted_here; then bb umount "$RUNTIME_ROOT" 2>/dev/null || true; fi
    remove_private_file "$KEY_FILE"
    [ ! -L "$AUTH_DIR" ] && [ -d "$AUTH_DIR" ] && bb rmdir "$AUTH_DIR" 2>/dev/null || true
}
stop() {
    [ -d "$SERVICE_DIR" ] && [ ! -L "$SERVICE_DIR" ] || return 0
    [ "$(bb stat -c '%u:%a' "$SERVICE_DIR" 2>/dev/null)" = 0:700 ] || return 0
    safe_file "$PID_FILE" || return 0
    old_pid=""
    IFS= read -r old_pid <"$PID_FILE" || true
    if owned_process "$old_pid"; then
        kill "$old_pid" 2>/dev/null || true
        attempts=0
        while owned_process "$old_pid" && [ "$attempts" -lt 4 ]; do
            bb sleep 1
            attempts=$((attempts + 1))
        done
        if owned_process "$old_pid"; then
            kill -KILL "$old_pid" 2>/dev/null || true
        fi
    fi
    remove_private_file "$PID_FILE"
    if ! owned_process "$old_pid"; then
        if mounted_here; then
            bb umount "$RUNTIME_ROOT" 2>/dev/null || report "read-only mount is still busy"
        fi
        remove_private_file "$KEY_FILE"
        [ ! -L "$AUTH_DIR" ] && [ -d "$AUTH_DIR" ] && bb rmdir "$AUTH_DIR" 2>/dev/null || true
    fi
}

# Liveness is a Native ownership check, not a claim that the model is
# ready for inference. The existing Intelligence probe owns readiness.
status() {
    [ -d "$SERVICE_DIR" ] && [ ! -L "$SERVICE_DIR" ] || return 1
    [ "$(bb stat -c '%u:%a' "$SERVICE_DIR" 2>/dev/null)" = 0:700 ] || return 1
    safe_file "$PID_FILE" || return 1
    pid=""
    IFS= read -r pid <"$PID_FILE" || return 1
    owned_process "$pid" || return 1
    mounted_here || return 1
    [ -d "$AUTH_DIR" ] && [ ! -L "$AUTH_DIR" ] || return 1
    [ "$(bb stat -c '%u:%a' "$AUTH_DIR" 2>/dev/null)" = 0:700 ] || return 1
    safe_file "$KEY_FILE" || return 1
    [ "$(bb stat -c '%u:%a' "$KEY_FILE" 2>/dev/null)" = 0:600 ] || return 1
}

start() {
    [ "${ORDAX_DISTRIBUTION_PROFILE:-}" = owner-development ] || {
        report "unsupported distribution profile"
        return 0
    }
    [ "${ORDAX_PRODUCT_MODE:-}" = usb ] || {
        report "unsupported product mode"
        return 0
    }
    case "$(uname -m)" in x86_64|amd64) ;; *)
        report "verified x86_64 runtime does not match hardware"
        return 0
    esac
    if [ -L "$SERVICE_DIR" ] || { [ -e "$SERVICE_DIR" ] && [ ! -d "$SERVICE_DIR" ]; }; then
        report "unsafe local AI service directory"
        return 0
    fi
    if [ -e "$PID_FILE" ] || [ -L "$PID_FILE" ]; then
        if ! safe_file "$PID_FILE"; then
            report "unsafe service PID path"
            return 0
        fi
        old_pid=""
        IFS= read -r old_pid <"$PID_FILE" || true
        if owned_process "$old_pid"; then
            report "verified local inference already running"
            return 0
        fi
        report "stale service ownership; declining ambiguous startup"
        return 0
    fi
    if mounted_here || [ -e "$KEY_FILE" ] || [ -L "$KEY_FILE" ]; then
        report "previous inference session not cleanly released"
        return 0
    fi
    if [ ! -d "$IMAGE_DIR" ] || [ -L "$IMAGE_DIR" ] || ! safe_file "$IMAGE"; then
        report "verified runtime artifact not staged; Aura remains unavailable"
        return 0
    fi
    if [ "$(bb stat -c '%u:%a' "$IMAGE_DIR" 2>/dev/null)" != 0:700 ] ||
       [ "$(bb stat -c '%u:%a' "$IMAGE" 2>/dev/null)" != 0:600 ]; then
        report "untrusted local AI artifact ownership or permissions"
        return 0
    fi
    if [ "$(bb stat -c '%s' "$IMAGE" 2>/dev/null)" != "$IMAGE_SIZE" ]; then
        report "local AI artifact size mismatch"
        return 0
    fi
    actual=$(bb sha256sum "$IMAGE" 2>/dev/null | bb awk '{print $1}')
    if [ "$actual" != "$IMAGE_SHA256" ]; then
        report "local AI artifact digest mismatch"
        return 0
    fi

    # /run/ordax is shared with other Native services: never tighten its
    # permissions as a side-effect of starting optional Intelligence.
    [ ! -L "$RUN_DIR" ] || { report "unsafe shared runtime directory"; return 0; }
    [ ! -L "$RUN_DIR/runtime" ] || {
        report "unsafe runtime mount parent"
        return 0
    }
    bb mkdir -p /run/ordax/runtime
    if [ -e "$SERVICE_DIR" ]; then
        [ -d "$SERVICE_DIR" ] && [ ! -L "$SERVICE_DIR" ] || {
            report "unsafe local AI service directory"
            return 0
        }
    else
        (umask 077; bb mkdir -m 700 "$SERVICE_DIR") || {
            report "cannot create local AI private service directory"
            return 0
        }
    fi
    if [ "$(bb stat -c '%u:%a' "$SERVICE_DIR" 2>/dev/null)" != 0:700 ] ||
       [ -L "$LOG_FILE" ] || { [ -e "$LOG_FILE" ] && ! safe_file "$LOG_FILE"; }; then
        report "unsafe local AI service ownership or log"
        return 0
    fi
    if [ -e "$RUNTIME_ROOT" ] || [ -L "$RUNTIME_ROOT" ]; then
        [ -d "$RUNTIME_ROOT" ] && [ ! -L "$RUNTIME_ROOT" ] || {
            report "unsafe mount point"
            return 0
        }
    else
        bb mkdir -m 700 "$RUNTIME_ROOT"
    fi
    if ! bb mount -t erofs -o ro,loop,nosuid,nodev "$IMAGE" "$RUNTIME_ROOT"; then
        report "verified local AI EROFS could not be mounted"
        return 0
    fi
    if [ ! -x "$RUNTIME_ROOT/bin/llama-server" ] ||
       [ ! -x "$RUNTIME_ROOT/bin/ordax-local-ai" ] ||
       ! bb cmp -s "$WORKTREE/system/services/local-ai/source-lock.json" "$RUNTIME_ROOT/metadata/source-lock.json"; then
        report "local AI image does not match active model/source contract"
        bb umount "$RUNTIME_ROOT" || true
        return 0
    fi

    bb mkdir -m 700 "$AUTH_DIR" || {
        bb umount "$RUNTIME_ROOT" || true
        report "ephemeral credential directory unavailable"
        return 0
    }
    key=$(bb od -An -tx1 -N32 /dev/urandom | bb tr -d '[:space:]')
    case "$key" in *[!0-9a-f]*|'') key="" ;; esac
    if [ "${#key}" -ne 64 ]; then
        unset key
        release_partial
        report "ephemeral credential generation failed"
        return 0
    fi
    (umask 077; printf '%s\n' "$key" >"$KEY_FILE") || {
        unset key
        release_partial
        report "could not write ephemeral key"
        return 0
    }
    unset key
    LLAMA_ARG_API_KEY_FILE="$KEY_FILE" \
      ORDAX_LOCAL_AI_RUNTIME_ROOT="$RUNTIME_ROOT" \
      "$RUNTIME_ROOT/bin/ordax-local-ai" >"$LOG_FILE" 2>&1 &
    launched=$!
    if ! is_pid "$launched"; then
        release_partial
        report "backend did not return a valid process identity"
        return 0
    fi
    (umask 077; printf '%s\n' "$launched" >"$PID_FILE") || {
        kill "$launched" 2>/dev/null || true
        release_partial
        report "could not record service ownership"
        return 0
    }
    report "verified inference launched; readiness is determined by Native health probes"
}

case "${1:-}" in
    start) start ;;
    stop) stop ;;
    status) status ;;
    *) report "usage: owner-dev-runtime.sh start|stop|status"; exit 2 ;;
esac
