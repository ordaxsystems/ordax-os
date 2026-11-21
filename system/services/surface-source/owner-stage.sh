#!/bin/sh
# OS-owned adapter, invoked only by the existing Supervisor transaction.
set -eu

usage() { echo "surface-source: status|stage|ready WORKTREE SHA [STAGE_DIR [REUSE_SHA]]" >&2; exit 2; }
[ "$#" -ge 3 ] && [ "$#" -le 5 ] || usage
command=$1
worktree=$2
os_sha=$3
stage_dir=""
reuse_sha=""
[ "$#" -eq 3 ] || stage_dir=$4
[ "$#" -ne 5 ] || reuse_sha=$5
case "$command" in status|stage|ready) ;; *) usage ;; esac
if [ "$#" -eq 5 ] && [ "$command" != stage ]; then usage; fi
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
    # Read the fixed string-valued lock keys regardless of pretty-printing.
    # BusyBox is the only available parser on the minimal Owner base; only
    # exactly one matching JSON string key is admissible, never an override.
    printf '%s\n' "$lock" | /bin/busybox awk -F '"' -v key="$1" '
        {
            for (i = 2; i + 2 <= NF; i += 2) {
                if ($i == key && $(i+1) ~ /^[[:space:]]*:[[:space:]]*$/) {
                    value = $(i+2)
                    count++
                }
            }
        }
        END { if (count != 1 || value == "") exit 1; print value }
    '
}
schema=$(field '$schema') || exit 2
status=$(field status) || exit 2
repository=$(field source_repository) || exit 2
source_ref=$(field source_ref) || exit 2
source_policy=$(field source_policy) || exit 2
visual_sha=$os_sha
[ "$schema" = prototype-ordax.surface-source/2 ] || exit 2
[ "$repository" = ordaxsystems/ordax-os ] || exit 2
[ "$source_ref" = same-commit ] || exit 2
[ "$source_policy" = tracked-git-blobs-only ] || exit 2
case "$visual_sha" in ''|*[!0-9a-f]*) exit 2 ;; esac
[ "${#visual_sha}" -eq 40 ] || exit 2
[ "$status" = canonical ] || exit 2

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
        # Compare the complete manifest and real file inventory in memory.
        # A verified release slot may be mounted read-only at cold boot:
        # never create comparison scratch files inside that slot.
        /bin/busybox find system/surface/ui system/surface/workspace -type f -print |
            /bin/busybox awk -v manifest="$expected" '
                BEGIN {
                    while ((getline line < manifest) > 0) {
                        path = substr(line, 67)
                        if (length(line) < 67 || (path in expected_files))
                            invalid = 1
                        expected_files[path] = 1
                        remaining++
                    }
                    close(manifest)
                    if (remaining == 0) invalid = 1
                }
                {
                    if (!($0 in expected_files) || seen[$0]++)
                        invalid = 1
                    remaining--
                }
                END { if (invalid || remaining != 0) exit 1 }
            ' || exit 1
        /bin/busybox sha256sum -c "$expected" >/dev/null 2>&1
    )
}

if [ "$command" = ready ]; then
    [ -f "$stage_dir/.ready" ] && [ ! -L "$stage_dir/.ready" ] || exit 1
    [ -f "$stage_dir/.surface-source-sha" ] && [ ! -L "$stage_dir/.surface-source-sha" ] || exit 1
    [ -f "$stage_dir/.sha" ] && [ ! -L "$stage_dir/.sha" ] || exit 1
    IFS= read -r actual_os_sha < "$stage_dir/.sha" || exit 1
    IFS= read -r actual_visual_sha < "$stage_dir/.surface-source-sha" || exit 1
    [ "$actual_os_sha" = "$os_sha" ] || exit 1
    [ "$actual_visual_sha" = "$visual_sha" ] || exit 1
    # Neither the Surface directory nor the native entrypoint may redirect
    # execution outside the immutable candidate slot through a symlink.
    [ -d "$stage_dir/system/surface" ] && [ ! -L "$stage_dir/system/surface" ] || exit 1
    [ -f "$stage_dir/system/surface/entrypoint" ] &&
        [ ! -L "$stage_dir/system/surface/entrypoint" ] &&
        [ -x "$stage_dir/system/surface/entrypoint" ] || exit 1
    [ -f "$stage_dir/system/surface/ui/surface.mjs" ] || exit 1
    [ -d "$stage_dir/system/surface/workspace" ] || exit 1
    [ ! -L "$stage_dir/system/surface/ui" ] || exit 1
    [ ! -L "$stage_dir/system/surface/workspace" ] || exit 1
    source_integrity || exit 1
    exit 0
fi

[ "$command" = stage ] || usage

surface_root=$stage_dir/system/surface
[ -d "$surface_root" ] && [ ! -L "$surface_root" ] || exit 2
[ ! -L "$surface_root/ui" ] && [ ! -L "$surface_root/workspace" ] || exit 2
archive=$stage_dir/.surface-source.tar
[ ! -e "$archive" ] && [ ! -L "$archive" ] || exit 2

# Reuse a verified slot only when both committed visual Git trees are identical.
# The contract alone is insufficient to prove visual bytes are unchanged.
case "$reuse_sha" in
    ''|*[!0-9a-f]*) reuse_sha="" ;;
esac
if [ "${#reuse_sha}" -eq 40 ] && [ "$reuse_sha" != "$os_sha" ]; then
    reuse_dir=${stage_dir%/*}/$reuse_sha
    reuse_ui=$("$git_bin" -C "$worktree" rev-parse "$reuse_sha:system/surface/ui" 2>/dev/null || true)
    target_ui=$("$git_bin" -C "$worktree" rev-parse "$os_sha:system/surface/ui" 2>/dev/null || true)
    reuse_workspace=$("$git_bin" -C "$worktree" rev-parse "$reuse_sha:system/surface/workspace" 2>/dev/null || true)
    target_workspace=$("$git_bin" -C "$worktree" rev-parse "$os_sha:system/surface/workspace" 2>/dev/null || true)
    if [ -n "$reuse_ui" ] && [ "$reuse_ui" = "$target_ui" ] &&
       [ -n "$reuse_workspace" ] && [ "$reuse_workspace" = "$target_workspace" ] &&
       [ -d "$reuse_dir" ] && [ ! -L "$reuse_dir" ] &&
       /bin/sh "$0" ready "$worktree" "$reuse_sha" "$reuse_dir"; then
        rm -rf "$surface_root/ui" "$surface_root/workspace" || exit 1
        /bin/busybox cp -a "$reuse_dir/system/surface/ui" "$reuse_dir/system/surface/workspace" "$surface_root/" || exit 1
        /bin/busybox cp "$reuse_dir/.surface-file-hashes" "$stage_dir/.surface-file-hashes" || exit 1
        source_integrity || exit 1
        printf '%s\n' "$visual_sha" >"$stage_dir/.surface-source-sha"
        printf 'OS_COMMIT_SURFACE_REUSED=%s\n' "$visual_sha"
        exit 0
    fi
fi

# Read the immutable candidate commit already fetched by the Supervisor.
# No second network connection, source checkout or owner Git repository.
for prefix in system/surface/ui system/surface/workspace; do
    listing=$("$git_bin" -C "$worktree" ls-tree -r "$os_sha" -- "$prefix") || exit 1
    [ -n "$listing" ] || exit 1
    printf '%s\n' "$listing" | /bin/busybox awk '
        { if (($1 != "100644" && $1 != "100755") || $2 != "blob") bad = 1; count++ }
        END { if (bad || count == 0) exit 1 }
    ' || exit 1
done
"$git_bin" -C "$worktree" archive --format=tar "$os_sha"     system/surface/ui system/surface/workspace >"$archive" || exit 1
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
rm -f "$archive"
printf 'OS_COMMIT_SURFACE_STAGED=%s\n' "$visual_sha"
