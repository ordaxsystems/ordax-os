#!/bin/sh
set -u

audio_session_dir=/run/ordax-surface/audio
if [ "$#" -ge 2 ] && [ "$1" = "--runtime-dir" ]; then
    audio_session_dir=$2
    case "$audio_session_dir" in
        /run/ordax-surface/audio|/run/ordax-media-probe) ;;
        *)
            echo "ordax-audio-session: unsupported runtime directory" >&2
            exit 64
            ;;
    esac
    shift 2
fi

if [ "$#" -lt 2 ] || [ "$1" != "--" ]; then
    echo "ordax-audio-session: expected -- followed by the graphical session command" >&2
    exit 64
fi
shift

# Older verified runtimes remain bootable while they are refreshed. Until the
# one session bus and all PipeWire owners are available, keep native playback's
# normal GStreamer/ALSA fallback and do not block the graphical session.
if [ "${ORDAX_MEDIA_SESSION_BUS:-}" != "ready" ] \
   && [ -x /usr/bin/dbus-run-session ] \
   && [ -x /usr/bin/pipewire ] \
   && [ -x /usr/bin/wireplumber ] \
   && [ -x /usr/bin/pipewire-pulse ] \
   && [ -x /usr/bin/pactl ] \
   && /usr/bin/dbus-run-session -- /bin/busybox true >/dev/null 2>&1; then
    export ORDAX_MEDIA_SESSION_BUS=ready
    exec /usr/bin/dbus-run-session -- /bin/busybox sh "$0" --runtime-dir "$audio_session_dir" -- "$@"
fi

if [ "${ORDAX_MEDIA_SESSION_BUS:-}" != "ready" ] \
   || [ ! -x /usr/bin/pipewire ] \
   || [ ! -x /usr/bin/wireplumber ] \
   || [ ! -x /usr/bin/pipewire-pulse ] \
   || [ ! -x /usr/bin/pactl ]; then
    exec "$@"
fi

umask 077
XDG_RUNTIME_DIR=$audio_session_dir
export XDG_RUNTIME_DIR
mkdir -p "$XDG_RUNTIME_DIR" || exec "$@"
chmod 700 "$XDG_RUNTIME_DIR" || exec "$@"
export PIPEWIRE_RUNTIME_DIR=$XDG_RUNTIME_DIR
export PULSE_RUNTIME_PATH=$XDG_RUNTIME_DIR/pulse
export PULSE_SERVER=unix:$PULSE_RUNTIME_PATH/native
mkdir -p "$PULSE_RUNTIME_PATH" || exec "$@"
chmod 700 "$PULSE_RUNTIME_PATH" || exec "$@"
audio_log=$XDG_RUNTIME_DIR/audio-session.log

pipewire_pid=
wireplumber_pid=
pulse_pid=
surface_pid=

stop_owned_process() {
    pid=${1:-}
    case "$pid" in
        ''|*[!0-9]*) return 0 ;;
    esac
    [ "$pid" -gt 1 ] 2>/dev/null || return 0
    kill -TERM "$pid" >/dev/null 2>&1 || true
    remaining=2
    while kill -0 "$pid" >/dev/null 2>&1 && [ "$remaining" -gt 0 ]; do
        /bin/busybox sleep 1
        remaining=$((remaining - 1))
    done
    if kill -0 "$pid" >/dev/null 2>&1; then
        kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
    wait "$pid" 2>/dev/null || true
}

cleanup_audio_session() {
    stop_owned_process "$surface_pid"
    stop_owned_process "$pulse_pid"
    stop_owned_process "$wireplumber_pid"
    stop_owned_process "$pipewire_pid"
}

trap cleanup_audio_session EXIT
trap 'exit 143' HUP INT TERM

/usr/bin/pipewire >>"$audio_log" 2>&1 &
pipewire_pid=$!
pipewire_ready=0
attempt=0
while [ "$attempt" -lt 5 ]; do
    [ -S "$XDG_RUNTIME_DIR/pipewire-0" ] && { pipewire_ready=1; break; }
    kill -0 "$pipewire_pid" >/dev/null 2>&1 || break
    /bin/busybox sleep 1
    attempt=$((attempt + 1))
done
if [ "$pipewire_ready" -ne 1 ]; then
    echo "ordax-audio-session: PipeWire did not become ready; continuing without session routing" >>"$audio_log"
    cleanup_audio_session
    trap - EXIT HUP INT TERM
    unset PULSE_SERVER PULSE_RUNTIME_PATH PIPEWIRE_RUNTIME_DIR
    exec "$@"
fi

/usr/bin/wireplumber >>"$audio_log" 2>&1 &
wireplumber_pid=$!
/usr/bin/pipewire-pulse >>"$audio_log" 2>&1 &
pulse_pid=$!

pulse_ready=0
attempt=0
while [ "$attempt" -lt 8 ]; do
    if /bin/busybox timeout -k 1 1 /usr/bin/pactl info >/dev/null 2>&1; then
        pulse_ready=1
        break
    fi
    kill -0 "$wireplumber_pid" >/dev/null 2>&1 || break
    kill -0 "$pulse_pid" >/dev/null 2>&1 || break
    /bin/busybox sleep 1
    attempt=$((attempt + 1))
done
if [ "$pulse_ready" -ne 1 ]; then
    echo "ordax-audio-session: Pulse-compatible control socket did not become ready; continuing without session routing" >>"$audio_log"
    cleanup_audio_session
    trap - EXIT HUP INT TERM
    unset PULSE_SERVER PULSE_RUNTIME_PATH PIPEWIRE_RUNTIME_DIR
    exec "$@"
fi

"$@" &
surface_pid=$!
session_status=0
wait "$surface_pid" || session_status=$?
surface_pid=
exit "$session_status"
