#!/bin/sh
# ACPI input adapter, not a second power controller.
# BusyBox acpid dispatches only the mapped physical KEY_POWER press here.
# The existing root Guardian remains the sole owner of shutdown/restart.
set -eu

request=${ORDAX_HOST_POWER_REQUEST:-/run/ordax-update/host-power-request}
[ "$#" -eq 0 ] || exit 2
[ -p "$request" ] && [ ! -L "$request" ] || exit 1
# The Guardian has the only long-lived read/write descriptor. A missing reader
# is an error; never call poweroff/reboot directly from an ACPI event.
printf 'shutdown\n' >"$request"
