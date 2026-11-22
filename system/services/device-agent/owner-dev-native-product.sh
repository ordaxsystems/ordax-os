#!/bin/sh
# Owner/Development USB adapter for the EXISTING Native Product lifecycle.
# This is not a second updater, trust root, daemon or installer for Stable.
# Only the Supervisor may call stage_on_mounted_data, using the data partition
# proven to belong to its active root filesystem.
#
# The Git-owned pin is the authority; removable exFAT is untrusted transport.
# No USB-supplied path, executable flag, source commit or manifest is trusted.
# This adapter cannot grant local consent, OAuth tokens or remote capabilities.

owner_dev_native_is_hex() {
    [ "${#1}" -eq "$2" ] || return 1
    case "$1" in ''|*[!0-9a-f]*) return 1 ;; esac
}

owner_dev_native_is_number() {
    case "$1" in ''|0|0*|*[!0-9]*) return 1 ;; esac
    [ "$1" -le "$2" ] 2>/dev/null
}

owner_dev_native_load_pin() {
    ONP_PIN=$SYSTEM_ROOT/services/device-agent/owner-dev-native-product.txt
    [ -f "$ONP_PIN" ] && [ ! -L "$ONP_PIN" ] || return 1
    ONP_PIN_BYTES=$(wc -c <"$ONP_PIN") || return 1
    [ "$ONP_PIN_BYTES" -gt 350 ] && [ "$ONP_PIN_BYTES" -lt 1500 ] || return 1
    ONP_LINES=0
    ONP_SHA=""
    ONP_BASE=""
    ONP_ROOTFS_SHA=""
    ONP_CI_RUN=""
    ONP_PROOF_RUN=""
    ONP_BIN_SHA=""
    ONP_BIN_BYTES=""
    ONP_LOADER_SHA=""
    ONP_LOADER_BYTES=""
    ONP_LIBC_SHA=""
    ONP_LIBC_BYTES=""
    ONP_ZLIB_SHA=""
    ONP_ZLIB_BYTES=""
    while IFS= read -r onp_line || [ -n "$onp_line" ]; do
        ONP_LINES=$((ONP_LINES + 1))
        case "$ONP_LINES:$onp_line" in
            1:schema=ordax.owner-dev-native-product/1) ;;
            2:runtime_source_commit=*) ONP_SHA=${onp_line#*=} ;;
            3:os_base_commit=*) ONP_BASE=${onp_line#*=} ;;
            4:os_base_rootfs_sha256=*) ONP_ROOTFS_SHA=${onp_line#*=} ;;
            5:runtime_ci_run_id=*) ONP_CI_RUN=${onp_line#*=} ;;
            6:offline_base_proof_run_id=*) ONP_PROOF_RUN=${onp_line#*=} ;;
            7:binary_sha256=*) ONP_BIN_SHA=${onp_line#*=} ;;
            8:binary_bytes=*) ONP_BIN_BYTES=${onp_line#*=} ;;
            9:loader_sha256=*) ONP_LOADER_SHA=${onp_line#*=} ;;
            10:loader_bytes=*) ONP_LOADER_BYTES=${onp_line#*=} ;;
            11:libc_sha256=*) ONP_LIBC_SHA=${onp_line#*=} ;;
            12:libc_bytes=*) ONP_LIBC_BYTES=${onp_line#*=} ;;
            13:zlib_sha256=*) ONP_ZLIB_SHA=${onp_line#*=} ;;
            14:zlib_bytes=*) ONP_ZLIB_BYTES=${onp_line#*=} ;;
            *) return 1 ;;
        esac
    done <"$ONP_PIN"
    [ "$ONP_LINES" -eq 14 ] &&
    owner_dev_native_is_hex "$ONP_SHA" 40 &&
    owner_dev_native_is_hex "$ONP_BASE" 40 &&
    owner_dev_native_is_hex "$ONP_ROOTFS_SHA" 64 &&
    owner_dev_native_is_hex "$ONP_BIN_SHA" 64 &&
    owner_dev_native_is_hex "$ONP_LOADER_SHA" 64 &&
    owner_dev_native_is_hex "$ONP_LIBC_SHA" 64 &&
    owner_dev_native_is_hex "$ONP_ZLIB_SHA" 64 &&
    owner_dev_native_is_number "$ONP_CI_RUN" 999999999999999 &&
    owner_dev_native_is_number "$ONP_PROOF_RUN" 999999999999999 &&
    owner_dev_native_is_number "$ONP_BIN_BYTES" 134217728 &&
    owner_dev_native_is_number "$ONP_LOADER_BYTES" 16777216 &&
    owner_dev_native_is_number "$ONP_LIBC_BYTES" 16777216 &&
    owner_dev_native_is_number "$ONP_ZLIB_BYTES" 16777216 &&
    [ "$ONP_LOADER_SHA" = "$ONP_LIBC_SHA" ] &&
    [ "$ONP_LOADER_BYTES" = "$ONP_LIBC_BYTES" ]
}

owner_dev_native_file_valid() {
    onp_file=$1
    onp_sha=$2
    onp_size=$3
    [ -f "$onp_file" ] && [ ! -L "$onp_file" ] || return 1
    onp_actual_size=$(wc -c <"$onp_file") || return 1
    [ "$onp_actual_size" = "$onp_size" ] || return 1
    onp_digest=$(sha256sum "$onp_file") || return 1
    [ "${onp_digest%% *}" = "$onp_sha" ]
}

owner_dev_native_slot_path() {
    printf '%s\n' "$STATE_DIR/native-state/owner-dev-native/versions/$ONP_SHA"
}

owner_dev_native_slot_valid() {
    onp_slot=$1
    [ -d "$onp_slot" ] && [ ! -L "$onp_slot" ] &&
    [ -d "$onp_slot/portable-lib" ] && [ ! -L "$onp_slot/portable-lib" ] &&
    [ -f "$onp_slot/owner-dev-native-product.txt" ] &&
    [ ! -L "$onp_slot/owner-dev-native-product.txt" ] &&
    cmp -s "$ONP_PIN" "$onp_slot/owner-dev-native-product.txt" &&
    owner_dev_native_file_valid "$onp_slot/ordax-product-agent" "$ONP_BIN_SHA" "$ONP_BIN_BYTES" &&
    owner_dev_native_file_valid "$onp_slot/portable-lib/ld-musl-x86_64.so.1" "$ONP_LOADER_SHA" "$ONP_LOADER_BYTES" &&
    owner_dev_native_file_valid "$onp_slot/portable-lib/libc.musl-x86_64.so.1" "$ONP_LIBC_SHA" "$ONP_LIBC_BYTES" &&
    owner_dev_native_file_valid "$onp_slot/portable-lib/libz.so.1" "$ONP_ZLIB_SHA" "$ONP_ZLIB_BYTES" &&
    [ -x "$onp_slot/ordax-product-agent" ] &&
    [ -x "$onp_slot/portable-lib/ld-musl-x86_64.so.1" ]
}

# Called at most once per boot, INSIDE the existing Owner Git cache's
# read-only, noexec mount. Never mount/select another drive by label.
owner_dev_native_stage_on_mounted_data() {
    [ "$DISTRIBUTION_PROFILE" = owner-development ] &&
    [ "$PRODUCT_MODE" = usb ] || return 1
    owner_dev_native_load_pin || return 1
    onp_mount=$1
    case "$onp_mount" in /*) ;; *) return 1 ;; esac
    [ -d "$onp_mount" ] && [ ! -L "$onp_mount" ] || return 1
    onp_source=$onp_mount/.ordax/updates/owner-native-product
    [ -d "$onp_source" ] && [ ! -L "$onp_source" ] &&
    [ -d "$onp_source/portable-lib" ] && [ ! -L "$onp_source/portable-lib" ] || return 1
    [ -f "$onp_source/owner-dev-native-product.txt" ] &&
    [ ! -L "$onp_source/owner-dev-native-product.txt" ] &&
    cmp -s "$ONP_PIN" "$onp_source/owner-dev-native-product.txt" || return 1
    owner_dev_native_file_valid "$onp_source/ordax-product-agent" "$ONP_BIN_SHA" "$ONP_BIN_BYTES" &&
    owner_dev_native_file_valid "$onp_source/portable-lib/ld-musl-x86_64.so.1" "$ONP_LOADER_SHA" "$ONP_LOADER_BYTES" &&
    owner_dev_native_file_valid "$onp_source/portable-lib/libc.musl-x86_64.so.1" "$ONP_LIBC_SHA" "$ONP_LIBC_BYTES" &&
    owner_dev_native_file_valid "$onp_source/portable-lib/libz.so.1" "$ONP_ZLIB_SHA" "$ONP_ZLIB_BYTES" || return 1

    onp_state=$STATE_DIR/native-state
    [ -d "$onp_state" ] && [ ! -L "$onp_state" ] || return 1
    onp_root=$onp_state/owner-dev-native
    [ ! -L "$onp_root" ] || return 1
    mkdir -p "$onp_root/versions" || return 1
    [ -d "$onp_root/versions" ] && [ ! -L "$onp_root/versions" ] || return 1
    onp_destination=$(owner_dev_native_slot_path)
    if [ -e "$onp_destination" ] || [ -L "$onp_destination" ]; then
        owner_dev_native_slot_valid "$onp_destination"
        return $?
    fi

    onp_stage=$onp_root/versions/.stage.$$
    [ ! -e "$onp_stage" ] && [ ! -L "$onp_stage" ] || return 1
    (umask 077; mkdir -p "$onp_stage/portable-lib") || return 1
    onp_ready=0
    if cp "$onp_source/ordax-product-agent" "$onp_stage/ordax-product-agent" &&
       cp "$onp_source/portable-lib/ld-musl-x86_64.so.1" "$onp_stage/portable-lib/ld-musl-x86_64.so.1" &&
       cp "$onp_source/portable-lib/libc.musl-x86_64.so.1" "$onp_stage/portable-lib/libc.musl-x86_64.so.1" &&
       cp "$onp_source/portable-lib/libz.so.1" "$onp_stage/portable-lib/libz.so.1" &&
       cp "$ONP_PIN" "$onp_stage/owner-dev-native-product.txt" &&
       chmod 500 "$onp_stage/ordax-product-agent" "$onp_stage/portable-lib/ld-musl-x86_64.so.1" &&
       chmod 400 "$onp_stage/owner-dev-native-product.txt" "$onp_stage/portable-lib/libc.musl-x86_64.so.1" "$onp_stage/portable-lib/libz.so.1" &&
       owner_dev_native_slot_valid "$onp_stage" &&
       mv "$onp_stage" "$onp_destination" &&
       owner_dev_native_slot_valid "$onp_destination"; then
        onp_ready=1
    fi
    [ "$onp_ready" -eq 1 ] || {
        [ ! -e "$onp_stage" ] || rm -rf "$onp_stage"
        return 1
    }
    return 0
}

# Re-check all four hashes only on first use of this immutable slot per
# Supervisor lifetime or when the Git-owned pin changes; avoid a 20 MB hash
# pass every five-second lifecycle tick.
owner_dev_native_verified_plan() {
    [ "$DISTRIBUTION_PROFILE" = owner-development ] &&
    [ "$PRODUCT_MODE" = usb ] || return 1
    owner_dev_native_load_pin || return 1
    [ "${ORDAX_DEV_ROOT_COMMIT:-seed}" = "$ONP_BASE" ] || return 1
    onp_slot=$(owner_dev_native_slot_path)
    onp_pin_digest=$(sha256sum "$ONP_PIN") || return 1
    onp_pin_digest=${onp_pin_digest%% *}
    [ -d "$onp_slot" ] && [ ! -L "$onp_slot" ] || return 1
    if [ "${ONP_VERIFIED_SLOT:-}" != "$onp_slot:$onp_pin_digest" ]; then
        owner_dev_native_slot_valid "$onp_slot" || return 1
        ONP_VERIFIED_SLOT=$onp_slot:$onp_pin_digest
    fi
    NATIVE_PRODUCT_EXECUTABLE=$onp_slot/ordax-product-agent
    NATIVE_PRODUCT_OWNER_LIB=$onp_slot/portable-lib
    NATIVE_PRODUCT_VERIFIED_PLAN="OWNER_DEV_NATIVE_RUNTIME=VERIFIED
SOURCE_COMMIT=$ONP_SHA
OS_BASE_COMMIT=$ONP_BASE
BINARY_SHA256=$ONP_BIN_SHA
PORTABLE_LOADER_SHA256=$ONP_LOADER_SHA"
}

owner_dev_native_run_verified() {
    [ -n "${NATIVE_PRODUCT_EXECUTABLE:-}" ] &&
    [ -n "${NATIVE_PRODUCT_OWNER_LIB:-}" ] || return 1
    (
        LD_LIBRARY_PATH=$NATIVE_PRODUCT_OWNER_LIB
        export LD_LIBRARY_PATH
        exec "$NATIVE_PRODUCT_OWNER_LIB/ld-musl-x86_64.so.1" --library-path "$NATIVE_PRODUCT_OWNER_LIB" \
            "$NATIVE_PRODUCT_EXECUTABLE" "$@"
    )
}
