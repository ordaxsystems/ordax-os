#!/bin/sh
# Owner Development: exercise the canonical signed Stable v4 acquisition
# without changing the live Git checkout, Supervisor, boot slots or current.
set -eu
umask 077

fail() {
    printf 'ordax-owner-signed-preview: %s\n' "$*" >&2
    exit 2
}

usage() {
    fail 'usage: ordax-owner-signed-preview inspect | stage <exact-lowercase-40-hex-sha>'
}

is_sha() {
    [ "${#1}" -eq 40 ] || return 1
    case "$1" in ''|*[!0-9a-f]*) return 1 ;; esac
}

[ "${ORDAX_DISTRIBUTION_PROFILE:-owner-development}" = owner-development ] ||
    fail 'only Owner/Development may run this opt-in preview'

WORKTREE=${ORDAX_WORKTREE:-/workspace/ordax}
AGENT=${ORDAX_OWNER_SIGNED_AGENT:-/ordax/bootstrap/release-acquisition/ordax-release-agent}
TRUST=${ORDAX_OWNER_SIGNED_TRUST_FILE:-$WORKTREE/bootstrap/trust/release-ed25519.json}
CHANNEL=${ORDAX_OWNER_SIGNED_CHANNEL_FILE:-$WORKTREE/bootstrap/config/release-envelope-url}
REPOSITORY=ordaxsystems/ordax-os

[ -f "$AGENT" ] && [ -x "$AGENT" ] && [ ! -L "$AGENT" ] ||
    fail 'canonical signed release agent is absent or unsafe (never build/download one automatically)'
[ -f "$TRUST" ] && [ -r "$TRUST" ] && [ ! -L "$TRUST" ] ||
    fail 'pinned local release trust anchor is missing or unsafe'
[ -f "$CHANNEL" ] && [ -r "$CHANNEL" ] && [ ! -L "$CHANNEL" ] ||
    fail 'canonical release channel selector is missing or unsafe'

IFS= read -r url < "$CHANNEL" || [ -n "${url:-}" ] ||
    fail 'release channel is empty'
case "$url" in
    https://*) ;;
    *) fail 'release channel must use HTTPS' ;;
esac
case "$url" in *[[:space:]]*) fail 'release channel has whitespace' ;; esac

if [ -x /bin/busybox ]; then
    timeout_exec='/bin/busybox'
    timeout_arg='timeout'
else
    command -v timeout >/dev/null 2>&1 ||
        fail 'required bounded timeout is unavailable'
    timeout_exec='timeout'
    timeout_arg=''
fi

# The Go agent implements all crypto, manifest, artifact and exact-commit
# checks. Never duplicate that implementation in this wrapper.
bounded_agent() {
    if [ -n "$timeout_arg" ]; then
        "$timeout_exec" "$timeout_arg" -k 5 660 "$AGENT" "$@"
    else
        "$timeout_exec" -k 5 660 "$AGENT" "$@"
    fi
}

case "${1:-}" in
    inspect)
        [ "$#" -eq 1 ] || usage
        # Fetches ONLY the signed envelope. Does not stage or activate.
        bounded_agent inspect --envelope-url "$url" \
            --trust "$TRUST" --repository "$REPOSITORY"
        ;;
    stage)
        [ "$#" -eq 2 ] || usage
        is_sha "$2" || fail 'exact signed commit must be lowercase 40-hex'
        expected=$2
        root=${ORDAX_OWNER_SIGNED_STAGE_ROOT:-}
        [ -n "$root" ] || fail 'explicit isolated staging directory is required'
        case "$root" in
            /*) ;;
            *) fail 'staging directory must be absolute' ;;
        esac
        case "$root" in
            '/'|'/state'|'/ordax'|'/ordax/'*|'/ordax-data'|'/ordax-data/'*|'/workspace'|'/workspace/'*|'/boot'|'/boot/'*|'/dev'|'/dev/'*|'/proc'|'/proc/'*|'/sys'|'/sys/'*)
                fail 'staging cannot target a live operating-system path'
                ;;
        esac
        case "$root" in
            "$WORKTREE"|"$WORKTREE"/*) fail 'staging cannot overwrite the Git checkout' ;;
        esac
        [ -d "$root" ] && [ ! -L "$root" ] ||
            fail 'isolated staging directory must already exist as a real directory'
        physical_root=$(cd -P "$root" && pwd -P) ||
            fail 'cannot validate physical staging path'
        [ "$physical_root" = "$root" ] ||
            fail 'staging path must be canonical without traversal or symlink parents'
        # Exact signed v4 artifact acquisition; this NEVER calls install,
        # activate-exact, changes /ordax/current, or touches A/B firmware.
        bounded_agent materialize-portable-v4 --envelope-url "$url" \
            --trust "$TRUST" --root "$root" \
            --repository "$REPOSITORY" --expected-commit "$expected" >/dev/null
        # Require a second exact verification of the persisted candidate.
        bounded_agent verify-portable-v4-exact \
            --trust "$TRUST" --root "$root" \
            --repository "$REPOSITORY" --expected-commit "$expected"
        ;;
    *) usage ;;
esac
