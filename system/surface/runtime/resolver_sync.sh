#!/bin/sh
# One DNS owner for both Native Surface startup and live Wi-Fi DHCP changes.
# Source is trusted host resolver; destination is the existing runtime chroot.
set -eu

runtime_root=${1:-}
log_path=${2:-}
host_resolver=${3:-/etc/resolv.conf}

case "$runtime_root" in /*) ;; *) exit 2 ;; esac
case "$host_resolver" in /*) ;; *) exit 2 ;; esac
[ -n "$log_path" ] || exit 2
[ -r "$host_resolver" ] || {
    printf 'ordax-resolver: host DNS unavailable\n' >>"$log_path"
    exit 1
}
[ -d "$runtime_root/etc" ] || {
    printf 'ordax-resolver: runtime /etc unavailable\n' >>"$log_path"
    exit 1
}

temporary=$(mktemp "$runtime_root/etc/.resolv.conf.ordax.XXXXXX") || exit 1
trap 'rm -f "$temporary"' EXIT HUP INT TERM

if ! cat "$host_resolver" >"$temporary"; then
    printf 'ordax-resolver: unable to snapshot host DNS\n' >>"$log_path"
    exit 1
fi
resolver_size=$(wc -c <"$temporary" | tr -d ' ')
case "$resolver_size" in ''|*[!0-9]*) resolver_size=0 ;; esac
if [ "$resolver_size" -eq 0 ] || [ "$resolver_size" -gt 16384 ]; then
    printf 'ordax-resolver: resolver size invalid\n' >>"$log_path"
    exit 1
fi

# A resolv.conf copied from the build host may point to 127.0.0.53
# (systemd-resolved), which is NOT running inside the Native chroot.
# Do not replace the last known-good guest DNS with a stub-only source.
if ! awk '
    $1 == "nameserver" && $2 ~ /^[0-9a-fA-F:.]+$/ &&
    $2 !~ /^127[.]/ && $2 != "::1" && $2 != "0.0.0.0" { found = 1 }
    END { exit !found }
' "$temporary"; then
    printf 'ordax-resolver: no routable nameserver in host DNS\n' >>"$log_path"
    exit 1
fi

chmod 644 "$temporary"
mv -f "$temporary" "$runtime_root/etc/resolv.conf"
trap - EXIT HUP INT TERM
printf 'ordax-resolver: synchronized guest DNS with current host DHCP\n' >>"$log_path"
