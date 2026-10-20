#!/bin/sh
# Canonical host->graphical-runtime DNS snapshot for boot and late Wi-Fi DHCP.
# The host owns connectivity; the trusted Surface runtime consumes its resolver.
set -eu
[ "$#" -eq 2 ] || exit 2
runtime_root=$1
log_file=$2
host_resolver=${ORDAX_RESOLVER_SOURCE_PATH:-/etc/resolv.conf}
case "$runtime_root" in /*) ;; *) exit 2 ;; esac
[ -d "$runtime_root" ] && [ ! -L "$runtime_root" ] || exit 1
[ -r "$host_resolver" ] || exit 1
runtime_etc=$runtime_root/etc
[ -d "$runtime_etc" ] && [ ! -L "$runtime_etc" ] || exit 1
runtime_resolver=$runtime_etc/resolv.conf
temporary=$runtime_etc/.resolv.conf.ordax.$$
trap 'rm -f "$temporary"' EXIT HUP INT TERM
/bin/busybox cat "$host_resolver" >"$temporary" || exit 1
resolver_size=$(/bin/busybox stat -c %s "$temporary" 2>/dev/null || printf 0)
case "$resolver_size" in ''|*[!0-9]*) exit 1 ;; esac
[ "$resolver_size" -gt 0 ] && [ "$resolver_size" -le 16384 ] || exit 1
/bin/busybox grep -Eq '^[[:space:]]*nameserver[[:space:]]+[^[:space:]#]+' "$temporary" || exit 1
chmod 644 "$temporary" || exit 1
/bin/busybox mv -f "$temporary" "$runtime_resolver" || exit 1
printf '%s\n' 'ordax-surface: refreshed graphical resolver from current host connectivity' >>"$log_file"
