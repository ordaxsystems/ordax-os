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
NATIVE_PRODUCT_PLAN_KIND=""
NATIVE_PRODUCT_RUNTIME_ROOT=""
NATIVE_PRODUCT_RUNTIME_PYTHON=""
NATIVE_PRODUCT_RUNTIME_SITE=""

native_product_stop() {
    [ -n "$NATIVE_PRODUCT_PID" ] || return 0
    native_product_owned=$NATIVE_PRODUCT_PID
    case "$native_product_owned" in ''|*[!0-9]*) return 1 ;; esac
    [ "$native_product_owned" -gt 1 ] 2>/dev/null || return 1
    if kill -0 "$native_product_owned" 2>/dev/null; then
        kill "$native_product_owned" 2>/dev/null || :
        native_product_remaining=3
        while kill -0 "$native_product_owned" 2>/dev/null && [ "$native_product_remaining" -gt 0 ]; do
            native_product_state=$(native_product_pid_state "$native_product_owned")
            [ "$native_product_state" = Z ] && break
            sleep 1
            native_product_remaining=$((native_product_remaining - 1))
        done
        native_product_state=$(native_product_pid_state "$native_product_owned")
        if kill -0 "$native_product_owned" 2>/dev/null && [ "$native_product_state" != Z ]; then
            kill -KILL "$native_product_owned" 2>/dev/null || :
            native_product_remaining=2
            while kill -0 "$native_product_owned" 2>/dev/null && [ "$native_product_remaining" -gt 0 ]; do
                native_product_state=$(native_product_pid_state "$native_product_owned")
                [ "$native_product_state" = Z ] && break
                sleep 1
                native_product_remaining=$((native_product_remaining - 1))
            done
        fi
    fi
    native_product_state=$(native_product_pid_state "$native_product_owned")
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

native_product_pid_state() {
    native_product_status="/proc/$1/status"
    [ -r "$native_product_status" ] || return 0
    while read -r native_product_state_key native_product_state_value native_product_state_rest; do
        if [ "$native_product_state_key" = State: ]; then
            printf '%s' "$native_product_state_value"
            return 0
        fi
    done <"$native_product_status"
}

native_product_reap_if_exited() {
    [ -n "$NATIVE_PRODUCT_PID" ] || return 0
    if ! kill -0 "$NATIVE_PRODUCT_PID" 2>/dev/null; then
        wait "$NATIVE_PRODUCT_PID" 2>/dev/null || :
        NATIVE_PRODUCT_PID=""
        NATIVE_PRODUCT_ACTIVE_IDENTITY=""
        return 0
    fi
    native_product_state=$(native_product_pid_state "$NATIVE_PRODUCT_PID")
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
        --target linux-amd64 \
        --root "$native_product_slots" 2>/dev/null) || return 1
    native_product_parse_plan "$native_product_verified_output" "$native_product_slots" || return 1
    NATIVE_PRODUCT_VERIFIED_PLAN=$native_product_verified_output
}

native_product_owner_dev_buildroot_plan() {
    # Development USBs may use the same canonical Runtime source through the
    # privately staged Buildroot Python target. This path is deliberately
    # unavailable to Stable/MVP and native-disk; the normal signed component
    # handoff above remains preferred whenever it is ready.
    [ "$DISTRIBUTION_PROFILE" = owner-development ] && [ "$PRODUCT_MODE" = usb ] || return 1
    native_product_dev_root=$STATE_DIR/native-state/owner-dev-runtime
    native_product_dev_python=$native_product_dev_root/usr/bin/python3.14
    native_product_dev_site=$native_product_dev_root/usr/lib/python3.14/site-packages
    native_product_dev_entry=$native_product_dev_site/ordax_dev_agent/native_main.py
    [ -d "$native_product_dev_root" ] && [ ! -L "$native_product_dev_root" ] &&
        [ -d "$native_product_dev_root/usr" ] && [ ! -L "$native_product_dev_root/usr" ] &&
        [ -d "$native_product_dev_root/usr/lib/python3.14" ] &&
        [ ! -L "$native_product_dev_root/usr/lib/python3.14" ] &&
        [ -d "$native_product_dev_site" ] && [ ! -L "$native_product_dev_site" ] &&
        [ -x "$native_product_dev_python" ] && [ -f "$native_product_dev_python" ] &&
        [ ! -L "$native_product_dev_python" ] &&
        [ -f "$native_product_dev_entry" ] && [ ! -L "$native_product_dev_entry" ] || return 1
    NATIVE_PRODUCT_RUNTIME_ROOT=$native_product_dev_root
    NATIVE_PRODUCT_RUNTIME_PYTHON=$native_product_dev_python
    NATIVE_PRODUCT_RUNTIME_SITE=$native_product_dev_site
    NATIVE_PRODUCT_VERIFIED_PLAN="OWNER_DEV_BUILDROOT_RUNTIME=YES
EXECUTABLE=$native_product_dev_python
ENTRYPOINT=$native_product_dev_entry"
}

native_product_resolve_plan() {
    NATIVE_PRODUCT_PLAN_KIND=""
    NATIVE_PRODUCT_VERIFIED_PLAN=""
    NATIVE_PRODUCT_EXECUTABLE=""
    NATIVE_PRODUCT_RUNTIME_ROOT=""
    NATIVE_PRODUCT_RUNTIME_PYTHON=""
    NATIVE_PRODUCT_RUNTIME_SITE=""
    if native_product_verified_plan; then
        NATIVE_PRODUCT_PLAN_KIND=signed
        return 0
    fi
    if native_product_owner_dev_buildroot_plan; then
        NATIVE_PRODUCT_PLAN_KIND=owner-development-buildroot
        return 0
    fi
    return 1
}

native_product_run_private_buildroot() {
    (
        native_product_dev_root=$NATIVE_PRODUCT_RUNTIME_ROOT
        native_product_dev_python=$NATIVE_PRODUCT_RUNTIME_PYTHON
        native_product_dev_site=$NATIVE_PRODUCT_RUNTIME_SITE
        PYTHONHOME=$native_product_dev_root/usr
        PYTHONPATH=$native_product_dev_site
        PYTHONNOUSERSITE=1
        PYTHONDONTWRITEBYTECODE=1
        LD_LIBRARY_PATH=$native_product_dev_root/lib:$native_product_dev_root/usr/lib
        PATH=$native_product_dev_root/usr/bin:/usr/bin:/bin
        export PYTHONHOME PYTHONPATH PYTHONNOUSERSITE PYTHONDONTWRITEBYTECODE LD_LIBRARY_PATH PATH
        exec "$native_product_dev_python" -m ordax_dev_agent.native_main "$@"
    )
}

native_product_run_selected() {
    case "$NATIVE_PRODUCT_PLAN_KIND" in
        signed)
            [ -n "$NATIVE_PRODUCT_EXECUTABLE" ] || return 1
            exec "$NATIVE_PRODUCT_EXECUTABLE" "$@"
            ;;
        owner-development-buildroot)
            [ -n "$NATIVE_PRODUCT_RUNTIME_PYTHON" ] || return 1
            native_product_run_private_buildroot "$@"
            ;;
        *) return 1 ;;
    esac
}

native_product_local_enabled() {
    [ -n "$NATIVE_PRODUCT_PLAN_KIND" ] || return 1
    native_product_consent=$(native_product_run_selected \
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
    if ! native_product_resolve_plan; then
        native_product_stop || return 1
        return 0
    fi
    native_product_first_plan=$NATIVE_PRODUCT_VERIFIED_PLAN
    native_product_first_kind=$NATIVE_PRODUCT_PLAN_KIND
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
    if ! native_product_resolve_plan ||
        [ "$NATIVE_PRODUCT_VERIFIED_PLAN" != "$native_product_first_plan" ] ||
        [ "$NATIVE_PRODUCT_PLAN_KIND" != "$native_product_first_kind" ] ||
        ! native_product_local_enabled; then
        return 0
    fi
    native_product_run_selected \
        --run --full-access --distribution-profile owner-development --product-mode usb \
        --system-root "$SYSTEM_ROOT" --state-root "$STATE_DIR/native-state" \
        --workspace "$WORKTREE" --status-port 8766 >/dev/null 2>&1 &
    NATIVE_PRODUCT_PID=$!
    NATIVE_PRODUCT_ACTIVE_IDENTITY=$NATIVE_PRODUCT_VERIFIED_PLAN
}
