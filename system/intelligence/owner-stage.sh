#!/bin/sh
# Owner Supervisor: no external checkout or source pin, same OS Git commit only.
set -eu
[ "$#" -ge 3 ] && [ "$#" -le 4 ] || exit 2
action=$1
worktree=$2
sha=$3
slot=${4:-}
case "$action" in status|stage|ready) ;; *) exit 2 ;; esac
case "$worktree" in /*) ;; *) exit 2 ;; esac
case "$sha" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#sha}" -eq 40 ] || exit 2
git_bin=${ORDAX_GIT_BIN:-/usr/bin/git}
[ -x "$git_bin" ] || exit 2
[ -d "$worktree/.git" ] || [ -f "$worktree/.git" ] || exit 2
contract=$("$git_bin" -C "$worktree" show "$sha:docs/contracts/intelligence-source.json") || exit 2
printf '%s\n' "$contract" | /bin/busybox grep -q '"prototype-ordax.intelligence-source/2"' || exit 2
printf '%s\n' "$contract" | /bin/busybox grep -q '"source_repository": "ordaxsystems/ordax-os"' || exit 2
printf '%s\n' "$contract" | /bin/busybox grep -q '"source_revision": "same-os-commit"' || exit 2
printf '%s\n' "$contract" | /bin/busybox grep -q '"activation_authorized": false' || exit 2
printf '%s\n' "$contract" | /bin/busybox grep -q '"status": "canonical"' || exit 2
[ "$action" != status ] || { printf '%s\n' canonical; exit 0; }
case "$slot" in /*) ;; *) exit 2 ;; esac
[ -d "$slot/system/intelligence/src" ] && [ ! -L "$slot/system/intelligence" ] || exit 1
paths=$("$git_bin" -C "$worktree" ls-tree -r --name-only "$sha" -- system/intelligence/src system/intelligence/tools/inference-builder/build.py system/services/intelligence/runtime.mjs system/services/intelligence/model-router.mjs system/services/local-ai/runtime.mjs system/services/local-ai/completion-stream.mjs system/services/local-ai/model-compatibility.mjs) || exit 1
[ -n "$paths" ] || exit 1
verify_files() {
    for path in $paths; do
        case "$path" in system/intelligence/src/*.mjs|system/intelligence/src/intelligence/*.mjs|system/intelligence/src/local-ai/*.mjs|system/intelligence/tools/inference-builder/build.py|system/services/intelligence/*.mjs|system/services/local-ai/*.mjs) ;; *) exit 1 ;; esac
        file=$slot/$path
        [ -f "$file" ] && [ ! -L "$file" ] || exit 1
        blob=$("$git_bin" -C "$worktree" rev-parse "$sha:$path") || exit 1
        [ "$("$git_bin" hash-object "$file")" = "$blob" ] || exit 1
    done
}
verify_files || exit 1
if [ "$action" = stage ]; then
    [ ! -e "$slot/.intelligence-source-sha" ] || exit 1
    (
       cd "$slot" || exit 1
       : > .intelligence-file-hashes
       for path in $paths; do /bin/busybox sha256sum "$path" >> .intelligence-file-hashes || exit 1; done
    )
    printf '%s\n' "$sha" > "$slot/.intelligence-source-sha"
    exit 0
fi
[ "$action" = ready ] || exit 2
[ -f "$slot/.ready" ] && [ -f "$slot/.sha" ] || exit 1
[ "$(cat "$slot/.sha")" = "$sha" ] || exit 1
[ -f "$slot/.intelligence-source-sha" ] && [ "$(cat "$slot/.intelligence-source-sha")" = "$sha" ] || exit 1
[ -f "$slot/.intelligence-file-hashes" ] || exit 1
(cd "$slot" && /bin/busybox sha256sum -c .intelligence-file-hashes >/dev/null 2>&1)
