#!/bin/sh
# One CPU-scheduling boundary for both Stable and Owner/Development Local AI.
# A lower scheduling priority protects Surface responsiveness under CPU contention.
# Do not modify the signed model, engine, context size, or verified artifact.
set -eu
[ "$#" -ge 1 ] || exit 2

# Positive niceness is an optional kernel scheduling hint, not a memory budget.
# Exec preserves the backend PID and makes the existing lifecycle owner accurate.
if command -v nice >/dev/null 2>&1; then
    exec nice -n 10 "$@"
fi
exec "$@"
