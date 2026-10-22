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
    fail 'usage: ordax-owner-signed-preview inspect | inspect-offline | stage <exact-40hex-sha> | stage-offline <exact-40hex-sha> | audit-state <exact-40hex-sha>'
}

is_sha() {
    [ "${#1}" -eq 40 ] || return 1
    case "$1" in ''|*[!0-9a-f]*) return 1 ;; esac
}

[ "${ORDAX_DISTRIBUTION_PROFILE:-}" = owner-development ] ||
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
load_https_channel() {
    [ -z "${ORDAX_OWNER_SIGNED_BUNDLE_DIR:-}" ] ||
        fail 'HTTPS and offline bundle sources cannot be combined'
    [ -f "$CHANNEL" ] && [ -r "$CHANNEL" ] && [ ! -L "$CHANNEL" ] ||
        fail 'canonical release channel selector is missing or unsafe'
    url=""
    IFS= read -r url < "$CHANNEL" || [ -n "$url" ] ||
        fail 'release channel is empty'
    case "$url" in https://*) ;; *) fail 'release channel must use HTTPS' ;; esac
    case "$url" in *[[:space:]]*) fail 'release channel has whitespace' ;; esac
}

load_offline_bundle() {
    bundle=${ORDAX_OWNER_SIGNED_BUNDLE_DIR:-}
    case "$bundle" in /*) ;; *) fail 'offline bundle must be an explicit absolute directory' ;; esac
    [ -d "$bundle" ] && [ ! -L "$bundle" ] ||
        fail 'offline bundle must be an existing real directory'
    physical_bundle=$(cd -P "$bundle" && pwd -P) ||
        fail 'cannot validate offline bundle directory'
    [ "$physical_bundle" = "$bundle" ] ||
        fail 'offline bundle path must be canonical without aliases'
    [ -f "$bundle/release-envelope.json" ] &&
        [ ! -L "$bundle/release-envelope.json" ] ||
        fail 'offline bundle needs a real signed release-envelope.json'
    # The canonical Go agent checks every ancestor, signature, source commit
    # and artifact, including source/destination overlap. Never copy the
    # verifier into shell or allow HTTP fallback on failed offline materialize.
}

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
bounded_command() {
    seconds=$1
    shift
    if [ -n "$timeout_arg" ]; then
        "$timeout_exec" "$timeout_arg" -k 5 "$seconds" "$@"
    else
        "$timeout_exec" -k 5 "$seconds" "$@"
    fi
}

bounded_agent() {
    bounded_command 660 "$AGENT" "$@"
}

# Only disposable, explicitly named paths are accepted. Never inspect an
# active boot state or use the live checkout as an isolated release source.
validate_preview_root() {
    root=${ORDAX_OWNER_SIGNED_STAGE_ROOT:-}
    [ -n "$root" ] || fail 'explicit isolated staging directory is required'
    case "$root" in /*) ;; *) fail 'staging directory must be absolute' ;; esac
    case "$root" in
        '/'|'/state'|'/ordax'|'/ordax/'*|'/ordax-data'|'/ordax-data/'*|'/workspace'|'/workspace/'*|'/boot'|'/boot/'*|'/dev'|'/dev/'*|'/proc'|'/proc/'*|'/sys'|'/sys/'*)
            fail 'staging cannot target a live operating-system path' ;;
    esac
    case "$root" in "$WORKTREE"|"$WORKTREE"/*) fail 'staging cannot overwrite the Git checkout' ;; esac
    case "$root" in
        */owner-signed-preview) ;;
        *) fail 'staging root must be a dedicated owner-signed-preview directory' ;;
    esac
    [ -d "$root" ] && [ ! -L "$root" ] ||
        fail 'isolated staging directory must already exist as a real directory'
    physical_root=$(cd -P "$root" && pwd -P) ||
        fail 'cannot validate physical staging path'
    [ "$physical_root" = "$root" ] ||
        fail 'staging path must be canonical without traversal or symlink parents'
}

validate_audit_state() {
    state_root=${ORDAX_OWNER_SIGNED_STATE_ROOT:-}
    case "$state_root" in
        /*/owner-signed-state) ;;
        *) fail 'audit requires an explicit absolute owner-signed-state directory' ;;
    esac
    case "$state_root" in
        /state/*|/ordax/*|/ordax-data/*|/workspace/*|/boot/*|/dev/*|/proc/*|/sys/*)
            fail 'audit cannot inspect live system state' ;;
    esac
    case "$state_root" in
        "$WORKTREE"|"$WORKTREE"/*|"$root"|"$root"/*)
            fail 'audit state must be isolated from checkout and release staging' ;;
    esac
    case "$root" in "$state_root"/*) fail 'release staging cannot be inside audit state' ;; esac
    [ -d "$state_root" ] && [ ! -L "$state_root" ] ||
        fail 'audit state must be an existing real directory'
    physical_state=$(cd -P "$state_root" && pwd -P) ||
        fail 'cannot validate physical audit state directory'
    [ "$physical_state" = "$state_root" ] ||
        fail 'audit state path must be canonical without aliases'
    helper=${ORDAX_OWNER_SIGNED_STATE_HELPER:-/run/ordax/bootstrap-tools/ordax-portable-state}
    [ -f "$helper" ] && [ -x "$helper" ] && [ ! -L "$helper" ] ||
        fail 'canonical native portable state inspector is missing or unsafe'
}

case "${1:-}" in
    inspect)
        [ "$#" -eq 1 ] || usage
        load_https_channel
        bounded_agent inspect --envelope-url "$url" \
            --trust "$TRUST" --repository "$REPOSITORY"
        ;;
    inspect-offline)
        [ "$#" -eq 1 ] || usage
        load_offline_bundle
        bounded_agent verify-envelope --envelope "$bundle/release-envelope.json" \
            --trust "$TRUST" --repository "$REPOSITORY"
        ;;
    stage|stage-offline)
        [ "$#" -eq 2 ] || usage
        method=$1
        is_sha "$2" || fail 'exact signed commit must be lowercase 40-hex'
        expected=$2
        if [ "$method" = stage-offline ]; then
            load_offline_bundle
        else
            load_https_channel
        fi
        validate_preview_root
        # Both delivery paths reach the exact SAME agent and immutable
        # staging/verification owner; only acquisition input differs.
        if [ "$method" = stage-offline ]; then
            # The Go agent must reject overlapping directories, symlinks,
            # altered signatures and missing objects without going online.
            bounded_agent materialize-portable-v4 --local-bundle "$bundle" \
                --trust "$TRUST" --root "$root" \
                --repository "$REPOSITORY" --expected-commit "$expected" >/dev/null
        else
            bounded_agent materialize-portable-v4 --envelope-url "$url" \
                --trust "$TRUST" --root "$root" \
                --repository "$REPOSITORY" --expected-commit "$expected" >/dev/null
        fi
        # Require a second exact verification of the persisted candidate.
        bounded_agent verify-portable-v4-exact \
            --trust "$TRUST" --root "$root" \
            --repository "$REPOSITORY" --expected-commit "$expected"
        ;;
    audit-state)
        [ "$#" -eq 2 ] || usage
        is_sha "$2" || fail 'audit requires exact lowercase signed 40-hex commit'
        expected=$2
        validate_preview_root
        validate_audit_state
        # The Go agent is the SOLE signature/hash authority for this exact
        # candidate. Native inspect is only a read-only state/shape observer.
        # Neither operation prepares, selects, commits, reboots or changes Git.
        bounded_agent verify-portable-v4-exact \
            --trust "$TRUST" --root "$root" \
            --repository "$REPOSITORY" --expected-commit "$expected" >/dev/null
        bounded_command 30 "$helper" inspect "$state_root" "$root"
        ;;
    *) usage ;;
esac
