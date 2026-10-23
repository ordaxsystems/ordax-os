#!/bin/sh
# OS-owned adapter, invoked only by the existing Supervisor transaction.
set -eu

usage() { echo "surface-source: status|stage|ready WORKTREE SHA [STAGE_DIR]" >&2; exit 2; }
[ "$#" -ge 3 ] && [ "$#" -le 4 ] || usage
command=$1
worktree=$2
os_sha=$3
stage_dir=""
[ "$#" -eq 3 ] || stage_dir=$4
case "$command" in status|stage|ready) ;; *) usage ;; esac
case "$os_sha" in ''|*[!0-9a-f]*) exit 2 ;; esac
[ "${#os_sha}" -eq 40 ] || exit 2
case "$worktree" in /*) ;; *) exit 2 ;; esac
git_bin=${ORDAX_GIT_BIN:-/usr/bin/git}
[ -x "$git_bin" ] || exit 2
[ -d "$worktree/.git" ] || [ -f "$worktree/.git" ] || exit 2

# Inspect only the immutable candidate OS commit, not mutable workspace files.
lock=$("$git_bin" -C "$worktree" show "$os_sha:docs/contracts/surface-source.json") || exit 2
[ -n "$lock" ] || exit 2
field() {
    printf '%s\n' "$lock" | /bin/busybox awk -F '"' -v key="$1" '
        $2 == key { value = $4; count++ }
        END { if (count != 1 || value == "") exit 1; print value }
    '
}
schema=$(field '$schema') || exit 2
status=$(field status) || exit 2
repository=$(field source_repository) || exit 2
visual_sha=$(field source_commit) || exit 2
[ "$schema" = prototype-ordax.surface-source/1 ] || exit 2
[ "$repository" = ordaxsystems/ordax-surface ] || exit 2
case "$visual_sha" in ''|*[!0-9a-f]*) exit 2 ;; esac
[ "${#visual_sha}" -eq 40 ] || exit 2
case "$status" in integration-candidate|canonical) ;; *) exit 2 ;; esac

if [ "$command" = status ]; then
    printf '%s\n' "$status"
    exit 0
fi
[ -n "$stage_dir" ] || usage
case "$stage_dir" in /*) ;; *) exit 2 ;; esac
[ -d "$stage_dir" ] && [ ! -L "$stage_dir" ] || exit 2
[ -d "$stage_dir/system" ] && [ ! -L "$stage_dir/system" ] || exit 2

# Detect changed, missing, injected or linked files on every canonical start.
# The manifest records the exact staged *relative* paths so a slot may be
# atomically moved from .staging to releases/<SHA> without invalidating it.
source_integrity() {
    expected=$stage_dir/.surface-file-hashes
    [ -f "$expected" ] && [ ! -L "$expected" ] || return 1
    (
        cd "$stage_dir" || exit 1
        for part in system/surface/ui system/surface/workspace; do
            [ -d "$part" ] && [ ! -L "$part" ] || exit 1
            [ -z "$(/bin/busybox find "$part" ! -type d ! -type f -print)" ] || exit 1
        done
        expected_paths=.surface-expected-paths.$
        found_paths=.surface-actual-paths.$
        trap 'rm -f "$expected_paths" "$found_paths"' EXIT
        /bin/busybox awk '{ print substr($0, 67) }' "$expected" |
            LC_ALL=C /bin/busybox sort > "$expected_paths" || exit 1
        /bin/busybox find system/surface/ui system/surface/workspace -type f -print |
            LC_ALL=C /bin/busybox sort > "$found_paths" || exit 1
        /bin/busybox cmp -s "$expected_paths" "$found_paths" || exit 1
        /bin/busybox sha256sum -c "$expected" >/dev/null 2>&1
    )
}

if [ "$command" = ready ]; then
    [ "$status" = canonical ] || exit 1
    [ -f "$stage_dir/.ready" ] && [ ! -L "$stage_dir/.ready" ] || exit 1
    [ -f "$stage_dir/.surface-source-sha" ] && [ ! -L "$stage_dir/.surface-source-sha" ] || exit 1
    [ -f "$stage_dir/.sha" ] && [ ! -L "$stage_dir/.sha" ] || exit 1
    IFS= read -r actual_os_sha < "$stage_dir/.sha" || exit 1
    IFS= read -r actual_visual_sha < "$stage_dir/.surface-source-sha" || exit 1
    [ "$actual_os_sha" = "$os_sha" ] || exit 1
    [ "$actual_visual_sha" = "$visual_sha" ] || exit 1
    [ -x "$stage_dir/system/surface/entrypoint" ] || exit 1
    [ -f "$stage_dir/system/surface/ui/surface.mjs" ] || exit 1
    [ -d "$stage_dir/system/surface/workspace" ] || exit 1
    [ ! -L "$stage_dir/system/surface/ui" ] || exit 1
    [ ! -L "$stage_dir/system/surface/workspace" ] || exit 1
    source_integrity || exit 1
    exit 0
fi

[ "$command" = stage ] || usage
[ "$status" = canonical ] || exit 0

surface_root=$stage_dir/system/surface
[ -d "$surface_root" ] && [ ! -L "$surface_root" ] || exit 2
[ ! -L "$surface_root/ui" ] && [ ! -L "$surface_root/workspace" ] || exit 2
git_root=$stage_dir/.surface-source-git
archive=$stage_dir/.surface-source.tar
[ ! -e "$git_root" ] && [ ! -L "$git_root" ] || exit 2
[ ! -e "$archive" ] && [ ! -L "$archive" ] || exit 2
fetch_seconds=90

# One immutable source fetch inside the Supervisor candidate stage. Failure
# leaves the active checkout and previous release unchanged.
"$git_bin" init -q "$git_root" || exit 1
"$git_bin" -C "$git_root" remote add origin https://github.com/ordaxsystems/ordax-surface.git || exit 1
/bin/busybox timeout -k 5 "$fetch_seconds" "$git_bin" -C "$git_root" fetch \
    --no-tags --depth=1 origin "$visual_sha" >/dev/null 2>&1 || exit 1
fetched=$("$git_bin" -C "$git_root" rev-parse 'FETCH_HEAD^{commit}') || exit 1
[ "$fetched" = "$visual_sha" ] || exit 1

# Reject linked, special and missing visual blobs before extraction.
for prefix in system/surface/ui system/surface/workspace; do
    listing=$("$git_bin" -C "$git_root" ls-tree -r "$visual_sha" -- "$prefix") || exit 1
    [ -n "$listing" ] || exit 1
    printf '%s\n' "$listing" | /bin/busybox awk '
        { if (($1 != "100644" && $1 != "100755") || $2 != "blob") bad = 1; count++ }
        END { if (bad || count == 0) exit 1 }
    ' || exit 1
done

"$git_bin" -C "$git_root" archive --format=tar "$visual_sha" \
    system/surface/ui system/surface/workspace >"$archive" || exit 1
[ -s "$archive" ] || exit 1

# Mutate the disposable staged candidate only; never the live OS checkout.
rm -rf "$surface_root/ui" "$surface_root/workspace" || exit 1
/bin/busybox tar -xf "$archive" -C "$stage_dir" || exit 1
[ -f "$surface_root/ui/surface.mjs" ] || exit 1
[ -d "$surface_root/workspace" ] || exit 1
(
    cd "$stage_dir" || exit 1
    /bin/busybox find system/surface/ui system/surface/workspace -type f -print |
        LC_ALL=C /bin/busybox sort |
        while IFS= read -r visual_file; do
            /bin/busybox sha256sum "$visual_file" || exit 1
        done > .surface-file-hashes
) || exit 1
source_integrity || exit 1
printf '%s\n' "$visual_sha" >"$stage_dir/.surface-source-sha"
rm -rf "$git_root"
rm -f "$archive"
printf 'PINNED_OWNER_SURFACE_STAGED=%s\n' "$visual_sha"
