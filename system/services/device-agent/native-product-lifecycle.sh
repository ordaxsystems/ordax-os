#!/bin/sh
# Library sourced by the existing OrdaX service Supervisor. Not a daemon, MCP
# server, second polling owner, signing authority or credential parser.
# Absent/unsigned/incompatible Runtime never prevents boot or local usage.
#
# Contract inputs (trusted Supervisor variables): SYSTEM_ROOT, WORKTREE,
# STATE_DIR, DISTRIBUTION_PROFILE, PRODUCT_MODE. Supervisor calls
# native_product_reconcile in its existing event loop and
# native_product_stop before its existing boot/update/power cutovers.
# Runtime owns the private local Connector opt-in and transport; Platform
# owns OAuth/grants/central session; component-channel owns signed slot proof.

NATIVE_PRODUCT_PID=""
NATIVE_PRODUCT_ACTIVE_IDENTITY=""

native_product_stop() {
    [ -n "$NATIVE_PRODUCT_PID" ] || return 0
    native_product_owned=$NATIVE_PRODUCT_PID
    case "$native_product_owned" in ''|*[!0-9]*) return 1 ;; esac
    [ "$native_product_owned" -gt 1 ] 2>/dev/null || return 1
    if kill -0 "$native_product_owned" 2>/dev/null; then
        kill "$native_product_owned" 2>/dev/null || :
        native_product_remaining=3
        while kill -0 "$native_product_owned" 2>/dev/null && [ "$native_product_remaining" -gt 0 ]; do
            native_product_state=$(/bin/busybox awk '$1 == "State:" {print $2; exit}' "/proc/$native_product_owned/status" 2>/dev/null || :)
            [ "$native_product_state" = Z ] && break
            /bin/busybox sleep 1
            native_product_remaining=$((native_product_remaining - 1))
        done
        native_product_state=$(/bin/busybox awk '$1 == "State:" {print $2; exit}' "/proc/$native_product_owned/status" 2>/dev/null || :)
        if kill -0 "$native_product_owned" 2>/dev/null && [ "$native_product_state" != Z ]; then
            kill -KILL "$native_product_owned" 2>/dev/null || :
            native_product_remaining=2
            while kill -0 "$native_product_owned" 2>/dev/null && [ "$native_product_remaining" -gt 0 ]; do
                native_product_state=$(/bin/busybox awk '$1 == "State:" {print $2; exit}' "/proc/$native_product_owned/status" 2>/dev/null || :)
                [ "$native_product_state" = Z ] && break
                /bin/busybox sleep 1
                native_product_remaining=$((native_product_remaining - 1))
            done
        fi
    fi
    native_product_state=$(/bin/busybox awk '$1 == "State:" {print $2; exit}' "/proc/$native_product_owned/status" 2>/dev/null || :)
    if kill -0 "$native_product_owned" 2>/dev/null && [ "$native_product_state" != Z ]; then
        # Never erase ownership while this process can still dispatch.
        return 1
    fi
    # This PID was forked by this Supervisor and cannot be reused before
    # reaping. Never kill by image name, PID file or arbitrary /proc scan.
    wait "$native_product_owned" 2>/dev/null || :
    NATIVE_PRODUCT_PID=""
    NATIVE_PRODUCT_ACTIVE_IDENTITY=""
}

native_product_reap_if_exited() {
    [ -n "$NATIVE_PRODUCT_PID" ] || return 0
    if ! kill -0 "$NATIVE_PRODUCT_PID" 2>/dev/null; then
        wait "$NATIVE_PRODUCT_PID" 2>/dev/null || :
        NATIVE_PRODUCT_PID=""
        NATIVE_PRODUCT_ACTIVE_IDENTITY=""
        return 0
    fi
    native_product_state=$(/bin/busybox awk '$1 == "State:" {print $2; exit}' "/proc/$NATIVE_PRODUCT_PID/status" 2>/dev/null || :)
    if [ "$native_product_state" = Z ]; then
        wait "$NATIVE_PRODUCT_PID" 2>/dev/null || :
        NATIVE_PRODUCT_PID=""
        NATIVE_PRODUCT_ACTIVE_IDENTITY=""
    fi
}

native_product_parse_plan() {
    native_product_plan=$1
    native_product_slot_root=$2
    NATIVE_PRODUCT_EXECUTABLE=""
    native_product_seen=":"
    native_product_count=0
    native_product_identity=""
    native_product_version=""
    native_product_revision=""
    native_product_mark=""
    native_product_started=""
    native_product_attested=""
    while IFS= read -r native_product_line; do
        native_product_key=${native_product_line%%=*}
        native_product_value=${native_product_line#*=}
        [ "$native_product_key" != "$native_product_line" ] || return 1
        case "$native_product_seen" in *":$native_product_key:"*) return 1 ;; esac
        native_product_seen="$native_product_seen$native_product_key:"
        native_product_count=$((native_product_count + 1))
        case "$native_product_key" in
            PRODUCT_RUNTIME_HANDOFF_VERIFIED) native_product_mark=$native_product_value ;;
            SOURCE_COMMIT) native_product_identity=$native_product_value ;;
            VERSION) native_product_version=$native_product_value ;;
            REVISION) native_product_revision=$native_product_value ;;
            EXECUTABLE) NATIVE_PRODUCT_EXECUTABLE=$native_product_value ;;
            RUNTIME_STARTED) native_product_started=$native_product_value ;;
            CENTRAL_SESSION_ATTESTED) native_product_attested=$native_product_value ;;
            *) return 1 ;;
        esac
    done <<EOF
$native_product_plan
EOF
    [ "$native_product_count" -eq 7 ] || return 1
    [ "$native_product_mark" = YES ] && [ "$native_product_started" = NO ] &&
        [ "$native_product_attested" = NO ] || return 1
    [ "${#native_product_identity}" -eq 40 ] || return 1
    case "$native_product_identity" in *[!0-9a-f]*) return 1 ;; esac
    [ -n "$native_product_version" ] || return 1
    case "$native_product_revision" in ''|*[!0-9]*) return 1 ;; esac
    case "$NATIVE_PRODUCT_EXECUTABLE" in
        "$native_product_slot_root"/product-runtime/versions/*/system/components/product-runtime/ordax-product-agent) ;;
        *) return 1 ;;
    esac
    [ -f "$NATIVE_PRODUCT_EXECUTABLE" ] && [ ! -L "$NATIVE_PRODUCT_EXECUTABLE" ] &&
        [ -x "$NATIVE_PRODUCT_EXECUTABLE" ] || return 1
}

native_product_verified_plan() {
    native_product_channel=$SYSTEM_ROOT/bin/ordax-runtime-component-channel
    native_product_policy=$WORKTREE/docs/contracts/runtime-component-trust-policy.json
    native_product_trust=$SYSTEM_ROOT/trust/runtime-components-ed25519.json
    native_product_slots=$STATE_DIR/native-state/components
    [ -x "$native_product_channel" ] && [ -f "$native_product_channel" ] &&
        [ ! -L "$native_product_channel" ] || return 1
    [ -r "$native_product_policy" ] && [ -f "$native_product_policy" ] &&
        [ ! -L "$native_product_policy" ] || return 1
    [ -r "$native_product_trust" ] && [ -f "$native_product_trust" ] &&
        [ ! -L "$native_product_trust" ] || return 1
    native_product_verified_output=$("$native_product_channel" inspect-native-product-handoff \
        --source-lock "$SYSTEM_ROOT/services/device-agent/studio-runtime-source-lock.json" \
        --trust-policy "$native_product_policy" \
        --trust "$native_product_trust" \
        --root "$native_product_slots" 2>/dev/null) || return 1
    native_product_parse_plan "$native_product_verified_output" "$native_product_slots" || return 1
    NATIVE_PRODUCT_VERIFIED_PLAN=$native_product_verified_output
}

native_product_local_enabled() {
    [ -n "$NATIVE_PRODUCT_EXECUTABLE" ] || return 1
    native_product_consent=$("$NATIVE_PRODUCT_EXECUTABLE" \
        --local-access-status --distribution-profile owner-development \
        --product-mode usb --system-root "$SYSTEM_ROOT" \
        --state-root "$STATE_DIR/native-state" --workspace "$WORKTREE" 2>/dev/null) || return 1
    [ "$native_product_consent" = "NATIVE_PRODUCT_LOCAL_ACCESS=ENABLED" ]
}

native_product_reconcile() {
    native_product_reap_if_exited
    if [ "$DISTRIBUTION_PROFILE" != owner-development ] || [ "$PRODUCT_MODE" != usb ]; then
        native_product_stop || return 1
        return 0
    fi
    # Everything below is optional. Fail closed for remote actions, but never
    # degrade OS boot, update, graphics or local filesystem operations.
    if ! native_product_verified_plan; then
        native_product_stop || return 1
        return 0
    fi
    native_product_first_plan=$NATIVE_PRODUCT_VERIFIED_PLAN
    if ! native_product_local_enabled; then
        native_product_stop || return 1
        return 0
    fi
    if [ -n "$NATIVE_PRODUCT_PID" ]; then
        if [ "$NATIVE_PRODUCT_ACTIVE_IDENTITY" = "$native_product_first_plan" ]; then
            return 0
        fi
        native_product_stop || return 1
    fi
    # OS pin/current slot may have changed while local policy was checked.
    # Compare the complete verifier reply before launching. The immutable
    # signed slot remains subject to the canonical component trust protocol.
    if ! native_product_verified_plan ||
        [ "$NATIVE_PRODUCT_VERIFIED_PLAN" != "$native_product_first_plan" ] ||
        ! native_product_local_enabled; then
        return 0
    fi
    "$NATIVE_PRODUCT_EXECUTABLE" \
        --run --full-access --distribution-profile owner-development --product-mode usb \
        --system-root "$SYSTEM_ROOT" --state-root "$STATE_DIR/native-state" \
        --workspace "$WORKTREE" --status-port 8766 >/dev/null 2>&1 &
    NATIVE_PRODUCT_PID=$!
    NATIVE_PRODUCT_ACTIVE_IDENTITY=$NATIVE_PRODUCT_VERIFIED_PLAN
}
