#!/bin/sh
set -eu

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

STATE_DIR=${ORDAX_STATE_DIR:-/state/ordax}
AGENT_DIR=$STATE_DIR/device-agent
CREDENTIAL_FILE=${ORDAX_PRODUCT_DEVICE_CREDENTIAL_FILE:-$AGENT_DIR/product-device.json}
LAST_RESULT_FILE=$AGENT_DIR/product-presence-last-result
CONTROL_PLANE_URL=${ORDAX_PRODUCT_CONTROL_PLANE_URL:-}
TIMEOUT=${ORDAX_PRODUCT_PRESENCE_TIMEOUT_SECONDS:-5}
SOURCE_SHA=${ORDAX_SOURCE_SHA:-}
REQUESTED_STATE=${1:-online}

mkdir -p "$AGENT_DIR"
chmod 700 "$AGENT_DIR"
umask 077

is_uuid() {
    value=${1:-}
    case "$value" in ????????-????-????-????-????????????) ;; *) return 1 ;; esac
    compact=$(printf '%s' "$value" | /bin/busybox tr -d '-' | /bin/busybox tr 'A-F' 'a-f')
    [ "${#compact}" -eq 32 ] || return 1
    case "$compact" in *[!0-9a-f]*) return 1 ;; esac
    version=$(printf '%s' "$value" | /bin/busybox cut -c 15)
    variant=$(printf '%s' "$value" | /bin/busybox cut -c 20 | /bin/busybox tr 'A-F' 'a-f')
    case "$version" in 1|2|3|4|5) ;; *) return 1 ;; esac
    case "$variant" in 8|9|a|b) ;; *) return 1 ;; esac
}

is_hex64() {
    value=${1:-}
    [ "${#value}" -eq 64 ] || return 1
    case "$value" in *[!0-9a-f]*) return 1 ;; esac
}

valid_base_url() {
    value=${1:-}
    case "$value" in https://*) ;; *) return 1 ;; esac
    remainder=${value#https://}
    [ -n "$remainder" ] || return 1
    case "$remainder" in *\?*|*\#*|*@*|*[!A-Za-z0-9._:-]*|*/) return 1 ;; esac
}

json_string_field() {
    field=$1
    path=$2
    /bin/busybox sed -n "s/.*\\\"$field\\\":[[:space:]]*\\\"\\([^\\\"]*\\)\\\".*/\\1/p" "$path" 2>/dev/null | /bin/busybox head -n 1
}

credential_file_is_private() {
    [ -f "$CREDENTIAL_FILE" ] && [ ! -L "$CREDENTIAL_FILE" ] || return 1
    mode=$(/bin/busybox stat -c %a "$CREDENTIAL_FILE" 2>/dev/null || true)
    [ "$mode" = "600" ] || return 1
    size=$(/bin/busybox stat -c %s "$CREDENTIAL_FILE" 2>/dev/null || true)
    case "$size" in ''|*[!0-9]*) return 1 ;; esac
    [ "$size" -gt 0 ] 2>/dev/null && [ "$size" -le 2048 ] 2>/dev/null
}

load_credentials() {
    credential_file_is_private || return 1
    DEVICE_ID=$(json_string_field device_id "$CREDENTIAL_FILE")
    DEVICE_TOKEN=$(json_string_field device_token "$CREDENTIAL_FILE")
    is_uuid "$DEVICE_ID" || return 1
    is_hex64 "$DEVICE_TOKEN" || return 1
}

agent_version() {
    if [ "${#SOURCE_SHA}" -eq 40 ]; then
        case "$SOURCE_SHA" in *[!0-9a-f]*) ;; *) printf 'ordax-os@%.12s' "$SOURCE_SHA"; return 0 ;; esac
    fi
    printf 'ordax-os'
}

write_result() {
    value=$1
    temporary=$LAST_RESULT_FILE.tmp.$$
    printf '%s\n' "$value" >"$temporary"
    /bin/busybox mv -f "$temporary" "$LAST_RESULT_FILE"
}

case "$REQUESTED_STATE" in
    online) ONLINE=true ;;
    offline) ONLINE=false ;;
    *) write_result invalid-request; exit 0 ;;
esac

case "$TIMEOUT" in ''|*[!0-9]*) TIMEOUT=5 ;; esac
[ "$TIMEOUT" -ge 1 ] 2>/dev/null || TIMEOUT=5
[ "$TIMEOUT" -le 15 ] 2>/dev/null || TIMEOUT=5

valid_base_url "$CONTROL_PLANE_URL" || { write_result unconfigured; exit 0; }
load_credentials || { write_result unenrolled; exit 0; }

version=$(agent_version)
payload=$(printf '{"online":%s,"runtime_kind":"ordax-os","agent_version":"%s","capability_digest":null}' "$ONLINE" "$version")
endpoint=$CONTROL_PLANE_URL/v3/product/device/presence

if /bin/busybox wget -q -T "$TIMEOUT" -O /dev/null \
    --header="Content-Type: application/json" \
    --header="Accept: application/json" \
    --header="X-Ordax-Device-Id: $DEVICE_ID" \
    --header="X-Ordax-Device-Token: $DEVICE_TOKEN" \
    --post-data="$payload" "$endpoint" >/dev/null 2>&1; then
    write_result ok
else
    # The caller owns scheduling and lifecycle. Reporting failure must never
    # become a boot or Surface-health dependency.
    write_result offline
fi

exit 0
