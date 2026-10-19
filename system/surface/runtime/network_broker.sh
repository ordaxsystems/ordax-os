#!/bin/sh
set -eu

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

STATE_DIR=${ORDAX_NETWORK_STATE_DIR:-/state/network}
SESSION_DIR=${ORDAX_NETWORK_SESSION_DIR:-/run/ordax-surface}
CONTROL=$SESSION_DIR/network-control
REQUEST=$SESSION_DIR/network-request
RESPONSE=$SESSION_DIR/network-response
SCAN_RAW=$SESSION_DIR/network-scan.raw
LINK_RAW=$SESSION_DIR/network-link.raw
SAVED_SSID_LINE=$SESSION_DIR/network-saved-ssid
WPA_CONF=$STATE_DIR/wpa.conf
# The boot/Wizard network owner retains the only WPA control socket and PID.
# The Surface broker consumes that owner; it never starts a second namespace.
WPA_CTRL_DIR=/run/ordax-wpa-supplicant
WPA_PID_FILE=/run/ordax-wpa-supplicant.pid
CANDIDATE=$STATE_DIR/wpa.conf.candidate.$$
AUTO_CONNECT_PAUSED=$STATE_DIR/autoconnect-paused
RECONNECT_INTERVAL=15

umask 077
mkdir -p "$STATE_DIR" "$SESSION_DIR"
chmod 700 "$STATE_DIR" "$SESSION_DIR"

IP_BIN=$(command -v ip || true)
IW_BIN=$(command -v iw || true)
WPA_BIN=$(command -v wpa_supplicant || true)
WPA_CLI_BIN=$(command -v wpa_cli || true)
UDHCPC_BIN=$(command -v udhcpc || true)

[ -n "$IP_BIN" ] && [ -n "$UDHCPC_BIN" ] || {
    echo "ordax-network-broker: IP/DHCP host tools are unavailable" >&2
    exit 1
}
WIFI_TOOLS_READY=0
if [ -n "$IW_BIN" ] && [ -n "$WPA_BIN" ] && [ -n "$WPA_CLI_BIN" ]; then
    WIFI_TOOLS_READY=1
fi

cleanup() {
    rm -f "$CONTROL" "$REQUEST" "$RESPONSE" "$SCAN_RAW" "$LINK_RAW" "$SAVED_SSID_LINE" "$CANDIDATE"
}
trap cleanup EXIT
trap 'exit 0' HUP INT TERM

rm -f "$CONTROL" "$REQUEST" "$RESPONSE" "$SCAN_RAW" "$LINK_RAW" "$SAVED_SSID_LINE" "$CANDIDATE"
mkfifo "$CONTROL"
chmod 600 "$CONTROL"

respond() {
    request_id=$1
    outcome=$2
    interface_name=$3
    detail=$4
    temporary=$RESPONSE.tmp.$$
    printf '%s\t%s\t%s\t%s\n' "$request_id" "$outcome" "$interface_name" "$detail" >"$temporary"
    chmod 600 "$temporary"
    mv -f "$temporary" "$RESPONSE"
}

find_wifi_interface() {
    for netpath in /sys/class/net/*; do
        [ -d "$netpath/wireless" ] || continue
        printf '%s\n' "${netpath##*/}"
        return 0
    done
    return 1
}

capture_saved_ssid() {
    temporary=$SAVED_SSID_LINE.tmp.$$
    : >"$temporary"
    if [ -s "$WPA_CONF" ]; then
        /bin/busybox awk '/^[[:space:]]*ssid=/{print; exit}' "$WPA_CONF" >"$temporary" 2>/dev/null || true
    fi
    chmod 600 "$temporary"
    mv -f "$temporary" "$SAVED_SSID_LINE"
}

capture_link() {
    wifi=$1
    temporary=$LINK_RAW.tmp.$$
    if ! "$IW_BIN" dev "$wifi" link >"$temporary" 2>/dev/null; then
        : >"$temporary"
    fi
    chmod 600 "$temporary"
    mv -f "$temporary" "$LINK_RAW"
}

capture_scan() {
    wifi=$1
    temporary=$SCAN_RAW.tmp.$$
    "$IP_BIN" link set "$wifi" up >/dev/null 2>&1 || return 1
    /bin/busybox timeout -k 1 15 "$IW_BIN" dev "$wifi" scan >"$temporary" 2>/dev/null || {
        rm -f "$temporary"
        return 1
    }
    chmod 600 "$temporary"
    mv -f "$temporary" "$SCAN_RAW"
}

stop_wifi() {
    wifi=$1
    # Never kill all supplicants: only the exact network owner's socket
    # for this interface may authorize termination. A stale socket/PID
    # fails closed and preserves the saved network and existing IP.
    if "$WPA_CLI_BIN" -p "$WPA_CTRL_DIR" -i "$wifi" ping 2>/dev/null |
        /bin/busybox grep -qx PONG; then
        "$WPA_CLI_BIN" -p "$WPA_CTRL_DIR" -i "$wifi" terminate >/dev/null 2>&1 || return 1
        remaining=5
        while [ "$remaining" -gt 0 ]; do
            if ! "$WPA_CLI_BIN" -p "$WPA_CTRL_DIR" -i "$wifi" ping 2>/dev/null |
                /bin/busybox grep -qx PONG; then
                break
            fi
            /bin/busybox sleep 1
            remaining=$((remaining - 1))
        done
        [ "$remaining" -gt 0 ] || return 1
    elif [ -s "$WPA_PID_FILE" ]; then
        # A process exists but the control channel cannot prove its owner.
        # Do not disrupt a potentially working OOBE connection.
        owner_pid=""
        IFS= read -r owner_pid <"$WPA_PID_FILE" || true
        case "$owner_pid" in
            ''|*[!0-9]*) return 1 ;;
        esac
        if [ -r "/proc/$owner_pid/comm" ] &&
            [ "$(/bin/busybox cat "/proc/$owner_pid/comm")" = wpa_supplicant ]; then
            return 1
        fi
    fi
    rm -f "$WPA_PID_FILE"
    "$IP_BIN" addr flush dev "$wifi" >/dev/null 2>&1 || true
    return 0
}

wait_for_wifi_link() {
    wifi=$1
    attempts=0
    while [ "$attempts" -lt 8 ]; do
        # Association alone is not authentication; DHCP waits for WPA.
        if "$WPA_CLI_BIN" -p "$WPA_CTRL_DIR" -i "$wifi" status 2>/dev/null |
           /bin/busybox grep -q '^wpa_state=COMPLETED$'; then
            return 0
        fi
        attempts=$((attempts + 1))
        /bin/busybox sleep 1
    done
    return 1
}

have_ipv4() {
    wifi=$1
    "$IP_BIN" -4 -o addr show dev "$wifi" scope global 2>/dev/null | /bin/busybox grep -q ' inet '
}

have_any_ipv4() {
    "$IP_BIN" -4 -o addr show scope global 2>/dev/null | /bin/busybox grep -q ' inet '
}

# One live network broker restores either a wired/USB-tether lease or saved
# Wi-Fi. Dev Base boot only initializes hardware; the Surface must not require
# the interactive first-use script to acquire Ethernet on a later boot.
restore_wired_network_if_needed() {
    have_any_ipv4 && return 0
    for netpath in /sys/class/net/*; do
        [ -e "$netpath" ] || continue
        iface=${netpath##*/}
        [ "$iface" = lo ] && continue
        [ -d "$netpath/wireless" ] && continue
        net_type=$(/bin/busybox cat "$netpath/type" 2>/dev/null || true)
        [ "$net_type" = 1 ] || continue
        # A DOWN Ethernet device may report no readable carrier until it is
        # administratively UP. Probe the actual link before deciding to skip
        # DHCP, without touching Wi-Fi or non-Ethernet interfaces.
        "$IP_BIN" link set "$iface" up >/dev/null 2>&1 || continue
        if [ -r "$netpath/carrier" ]; then
            carrier=$(/bin/busybox cat "$netpath/carrier" 2>/dev/null || true)
            [ "$carrier" = 1 ] || continue
        fi
        if try_dhcp "$iface"; then
            return 0
        fi
    done
    return 1
}

try_dhcp() {
    wifi=$1
    "$IP_BIN" link set "$wifi" up >/dev/null 2>&1 || return 1
    /bin/busybox timeout -k 1 8 "$UDHCPC_BIN" -n -q -t 2 -T 2 -i "$wifi" >/dev/null 2>&1 || return 1
    have_ipv4 "$wifi"
}

connect_conf() {
    wifi=$1
    conf=$2
    [ -s "$conf" ] || return 1
    stop_wifi "$wifi" || return 1
    mkdir -p "$WPA_CTRL_DIR" || return 1
    chmod 700 "$WPA_CTRL_DIR"
    "$WPA_BIN" -B -P"$WPA_PID_FILE" -O"$WPA_CTRL_DIR" -i "$wifi" -c "$conf" >/dev/null 2>&1 || return 1
    if ! wait_for_wifi_link "$wifi"; then
        stop_wifi "$wifi" || true
        return 1
    fi
    try_dhcp "$wifi"
}

restore_saved_network() {
    wifi=$1
    [ -s "$WPA_CONF" ] && [ ! -L "$WPA_CONF" ] || return 1
    connect_conf "$wifi" "$WPA_CONF"
}

# The existing Surface IPC broker is the only reconnection scheduler.
# First Run may already own a WPA supplicant and an IP; preserve its session.
restore_saved_network_if_needed() {
    [ "$WIFI_TOOLS_READY" -eq 1 ] || return 1
    [ ! -e "$AUTO_CONNECT_PAUSED" ] || return 0
    [ -s "$WPA_CONF" ] && [ ! -L "$WPA_CONF" ] || return 1
    wifi=$(find_wifi_interface) || return 1
    if "$WPA_CLI_BIN" -p "$WPA_CTRL_DIR" -i "$wifi" ping 2>/dev/null |
        /bin/busybox grep -qx PONG; then
        # WPA itself handles link loss and re-association. Never kill its
        # running session during an incomplete handshake.
        "$WPA_CLI_BIN" -p "$WPA_CTRL_DIR" -i "$wifi" status 2>/dev/null |
            /bin/busybox grep -qx '^wpa_state=COMPLETED$' || return 1
        have_ipv4 "$wifi" && return 0
        try_dhcp "$wifi"
        return $?
    fi
    restore_saved_network "$wifi"
}

valid_hex() {
    value=$1
    min_length=$2
    max_length=$3
    length=${#value}
    [ "$length" -ge "$min_length" ] 2>/dev/null || return 1
    [ "$length" -le "$max_length" ] 2>/dev/null || return 1
    [ $((length % 2)) -eq 0 ] || return 1
    case "$value" in
        *[!0-9A-Fa-f]*|'') return 1 ;;
    esac
    return 0
}

handle_request() {
    request_id=""
    action=""
    IFS= read -r request_id <"$REQUEST" 2>/dev/null || {
        respond unknown error "" invalid-request
        return 0
    }
    action=$(/bin/busybox sed -n '2p' "$REQUEST" 2>/dev/null || true)
    case "$request_id" in
        ''|*[!A-Za-z0-9._:-]*) respond unknown error "" invalid-request; return 0 ;;
    esac

    [ "$WIFI_TOOLS_READY" -eq 1 ] || {
        respond "$request_id" error "" wifi-tools-unavailable
        return 0
    }
    wifi=$(find_wifi_interface || true)
    [ -n "$wifi" ] || {
        respond "$request_id" error "" no-wifi-interface
        return 0
    }

    case "$action" in
        status)
            capture_link "$wifi"
            capture_saved_ssid
            respond "$request_id" ok "$wifi" status
            ;;
        scan)
            if capture_scan "$wifi"; then
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" ok "$wifi" scanned
            else
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" error "$wifi" scan-failed
            fi
            ;;
        connect)
            ssid_hex=$(/bin/busybox sed -n '3p' "$REQUEST" 2>/dev/null || true)
            psk_hex=$(/bin/busybox sed -n '4p' "$REQUEST" 2>/dev/null || true)
            if ! valid_hex "$ssid_hex" 2 64 || ! valid_hex "$psk_hex" 64 64; then
                respond "$request_id" error "$wifi" invalid-credentials
                return 0
            fi
            {
                printf 'ctrl_interface=%s\n' "$WPA_CTRL_DIR"
                printf 'update_config=0\n'
                printf 'network={\n'
                printf '    ssid=%s\n' "$ssid_hex"
                printf '    psk=%s\n' "$psk_hex"
                printf '}\n'
            } >"$CANDIDATE"
            chmod 600 "$CANDIDATE"

            if connect_conf "$wifi" "$CANDIDATE"; then
                # Candidate is chmod 0600 before same-directory rename.
                # Persist the file and its directory before reporting success.
                if ! mv -f "$CANDIDATE" "$WPA_CONF" ||
                   ! rm -f "$AUTO_CONNECT_PAUSED" ||
                   ! /bin/busybox sync; then
                    respond "$request_id" error "$wifi" credential-save-failed
                    return 0
                fi
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" ok "$wifi" connected
            else
                rm -f "$CANDIDATE"
                if [ ! -e "$AUTO_CONNECT_PAUSED" ]; then
                    restore_saved_network_if_needed >/dev/null 2>&1 || true
                fi
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" error "$wifi" connect-failed
            fi
            ;;
        disconnect)
            # Durably record the explicit user intent BEFORE touching the
            # connection. Otherwise power loss between WPA termination and
            # this receipt would reconnect an intentionally disabled network.
            # Keep the saved credential so later Reconnect requires no password.
            pause_tmp=$AUTO_CONNECT_PAUSED.tmp.$$
            if ! : >"$pause_tmp" || ! chmod 600 "$pause_tmp" ||
               ! mv -f "$pause_tmp" "$AUTO_CONNECT_PAUSED" ||
               ! /bin/busybox sync; then
                rm -f "$pause_tmp"
                respond "$request_id" error "$wifi" disconnect-state-failed
                return 0
            fi
            if ! stop_wifi "$wifi"; then
                # Pause survives an unavailable WPA owner and a forced reboot.
                respond "$request_id" error "$wifi" network-owner-unavailable
                return 0
            fi
            capture_link "$wifi"
            capture_saved_ssid
            respond "$request_id" ok "$wifi" disconnected
            ;;
        forget)
            if ! stop_wifi "$wifi"; then
                respond "$request_id" error "$wifi" network-owner-unavailable
                return 0
            fi
            rm -f "$WPA_CONF" "$AUTO_CONNECT_PAUSED"
            if ! /bin/busybox sync; then
                respond "$request_id" error "$wifi" credential-delete-failed
                return 0
            fi
            capture_link "$wifi"
            capture_saved_ssid
            respond "$request_id" ok "$wifi" forgotten
            ;;
        reconnect)
            if ! rm -f "$AUTO_CONNECT_PAUSED" || ! /bin/busybox sync; then
                respond "$request_id" error "$wifi" reconnect-state-failed
                return 0
            fi
            if restore_saved_network_if_needed; then
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" ok "$wifi" reconnected
            else
                capture_link "$wifi"
                capture_saved_ssid
                respond "$request_id" error "$wifi" reconnect-failed
            fi
            ;;
        *)
            respond "$request_id" error "$wifi" unsupported-action
            ;;
    esac
}

exec 9<>"$CONTROL"
# Boot and reconnect reuse this IPC owner, never a parallel WPA daemon.
restore_wired_network_if_needed >/dev/null 2>&1 || true
restore_saved_network_if_needed >/dev/null 2>&1 || true
while :; do
    signal=""
    if IFS= read -r -t "$RECONNECT_INTERVAL" signal <&9; then
        [ "$signal" = request ] && handle_request
    else
        restore_wired_network_if_needed >/dev/null 2>&1 || true
        restore_saved_network_if_needed >/dev/null 2>&1 || true
    fi
done
