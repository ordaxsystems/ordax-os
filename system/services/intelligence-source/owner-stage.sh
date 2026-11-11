#!/bin/sh
# Sole Owner/Development Intelligence stage adapter: the existing Supervisor
# owns stage, activation, health and rollback. This file has no daemon.
set -eu
[ "$#" -ge 3 ] && [ "$#" -le 4 ] || exit 2
cmd=$1
worktree=$2
os_sha=$3
stage_dir=${4:-}
case "$cmd" in status|stage|ready) ;; *) exit 2 ;; esac
case "$worktree" in /*) ;; *) exit 2 ;; esac
case "$os_sha" in *[!0-9a-f]*|'') exit 2 ;; esac
[ "${#os_sha}" -eq 40 ] || exit 2
git_bin=${ORDAX_GIT_BIN:-/usr/bin/git}
[ -x "$git_bin" ] || exit 2
[ -d "$worktree/.git" ] || [ -f "$worktree/.git" ] || exit 2
lock=$("$git_bin" -C "$worktree" show "$os_sha:docs/contracts/intelligence-source.json") || exit 2
field() {
    printf '%s\n' "$lock" | /bin/busybox awk -F '"' -v key="$1" '
      { for(i=2;i+2<=NF;i+=2)
         if($i==key && $(i+1)~/^[[:space:]]*:[[:space:]]*$/){v=$(i+2);n++} }
      END{if(n!=1 || v=="")exit 1; print v}'
}
sha_ok() {
    case "$1" in *[!0-9a-f]*|'') return 1 ;; esac
    [ "${#1}" -eq 40 ]
}
[ "$(field '$schema')" = prototype-ordax.intelligence-source/1 ] || exit 2
[ "$(field source_repository)" = ordaxsystems/ordax-intelligence ] || exit 2
state=$(field status) || exit 2
case "$state" in canonical|integration-candidate) ;; *) exit 2 ;; esac
source_sha=$(field source_commit) || exit 2
sha_ok "$source_sha" || exit 2
source_paths() {
    printf '%s\n' "$lock" | /bin/busybox awk -F '"' '
      BEGIN { inside=0; opened=0; count=0; bad=0 }
      {
        for (i=1;i<=NF;i++) {
          if (i % 2 == 1) {
            if (inside && index($i,"}") != 0) inside=0
            continue
          }
          token=$i
          separator=(i<NF ? $(i+1) : "")
          if (!inside) {
            if (token=="source_paths" && separator~/^[[:space:]]*:[[:space:]]*\{[[:space:]]*$/) {
              if (opened) bad=1
              inside=1
              opened=1
            }
            continue
          }
          if (separator~/^[[:space:]]*:[[:space:]]*$/) {
            if (i+2>NF) { bad=1; continue }
            value=$(i+2)
            if (token!~/^[A-Za-z0-9._\/-]+$/ || length(value)!=40 || value~/[^0-9a-f]/ || seen[token]++) bad=1
            else { print token; count++ }
          }
        }
      }
      END { if (!opened || inside || bad || count<3 || count>64) exit 1 }'
}
files=$(source_paths) || exit 2
files=$(printf '%s\n' "$files" | LC_ALL=C /bin/busybox sort) || exit 2
required_index=0
required_contracts=0
required_builder=0
for src in $files; do
    case "/$src/" in *'/../'*|*'/./'*|*'//'*) exit 2 ;; esac
    case "$src" in
      src/index.mjs) required_index=1 ;;
      src/contract-bindings.mjs) required_contracts=1 ;;
      tools/inference-builder/build.py) required_builder=1 ;;
      src/*.mjs) ;;
      *) exit 2 ;;
    esac
done
[ "$required_index$required_contracts$required_builder" = 111 ] || exit 2
bridges='system/services/intelligence/model-router.mjs:model-router.mjs
system/services/intelligence/runtime.mjs:intelligence-runtime.mjs
system/services/local-ai/runtime.mjs:local-ai-runtime.mjs
system/services/local-ai/completion-stream.mjs:completion-stream.mjs
system/services/local-ai/model-compatibility.mjs:model-compatibility.mjs'
if [ "$cmd" = status ]; then printf '%s\n' "$state"; exit 0; fi
case "$stage_dir" in /*) ;; *) exit 2 ;; esac
[ -d "$stage_dir/system" ] && [ ! -L "$stage_dir/system" ] || exit 2

verify_files() {
    (
      cd "$stage_dir" || exit 1
      [ -f .intelligence-file-hashes ] && [ ! -L .intelligence-file-hashes ] || exit 1
      [ -d system/intelligence-source/src ] && [ -d system/intelligence-source/tools/inference-builder ] || exit 1
      expected=.intelligence-expected.$$
      found=.intelligence-found.$$
      trap 'rm -f "$expected" "$found"' EXIT
      printf '%s\n' "$files" | /bin/busybox awk '{ print "system/intelligence-source/" $0 }' | LC_ALL=C /bin/busybox sort > "$expected"
      /bin/busybox find system/intelligence-source -type f -print | LC_ALL=C /bin/busybox sort > "$found"
      /bin/busybox cmp -s "$expected" "$found" || exit 1
      [ -z "$(/bin/busybox find system/intelligence-source ! -type d ! -type f -print)" ] || exit 1
      /bin/busybox sha256sum -c .intelligence-file-hashes >/dev/null 2>&1 || exit 1
      for src in $files; do
        pinned=$(field "$src") || exit 1
        sha_ok "$pinned" || exit 1
        [ "$("$git_bin" hash-object "system/intelligence-source/$src")" = "$pinned" ] || exit 1
      done
      printf '%s\n' "$bridges" | while IFS= read -r item; do
        [ -n "$item" ] || continue
        target=${item%%:*}
        template=system/services/intelligence-source/wrappers/${item#*:}
        [ -f "$target" ] && [ ! -L "$target" ] || exit 1
        [ -f "$template" ] && [ ! -L "$template" ] || exit 1
        /bin/busybox cmp -s "$template" "$target" || exit 1
        expected_blob=$("$git_bin" -C "$worktree" rev-parse "$os_sha:$template") || exit 1
        [ "$("$git_bin" hash-object "$template")" = "$expected_blob" ] || exit 1
      done
    )
}
if [ "$cmd" = ready ]; then
    [ "$state" = canonical ] || exit 1
    [ -f "$stage_dir/.ready" ] && [ -f "$stage_dir/.sha" ] && [ -f "$stage_dir/.intelligence-source-sha" ] || exit 1
    [ ! -L "$stage_dir/.sha" ] && [ ! -L "$stage_dir/.intelligence-source-sha" ] || exit 1
    [ "$(cat "$stage_dir/.sha")" = "$os_sha" ] || exit 1
    [ "$(cat "$stage_dir/.intelligence-source-sha")" = "$source_sha" ] || exit 1
    verify_files
    exit $?
fi
[ "$cmd" = stage ] || exit 2
[ "$state" = canonical ] || exit 0
[ ! -e "$stage_dir/system/intelligence-source" ] && [ ! -L "$stage_dir/system/intelligence-source" ] || exit 1
git_root=$stage_dir/.intelligence-source-git
archive=$stage_dir/.intelligence-source.tar
[ ! -e "$git_root" ] && [ ! -e "$archive" ] || exit 1
"$git_bin" init -q "$git_root" || exit 1
"$git_bin" -C "$git_root" remote add origin https://github.com/ordaxsystems/ordax-intelligence.git || exit 1
/bin/busybox timeout -k 5 90 "$git_bin" -C "$git_root" fetch --no-tags --depth=1 origin "$source_sha" >/dev/null 2>&1 || exit 1
[ "$("$git_bin" -C "$git_root" rev-parse 'FETCH_HEAD^{commit}')" = "$source_sha" ] || exit 1
listing=$("$git_bin" -C "$git_root" ls-tree -r "$source_sha" -- src tools/inference-builder/build.py) || exit 1
found=$(printf '%s\n' "$listing" | /bin/busybox awk '{ print $4 }' | LC_ALL=C /bin/busybox sort)
expected=$(printf '%s\n' "$files" | LC_ALL=C /bin/busybox sort)
[ "$found" = "$expected" ] || exit 1
for src in $files; do
    line=$(printf '%s\n' "$listing" | /bin/busybox awk -v name="$src" '$4==name { print $1, $2, $3 }')
    set -- $line
    [ "$#" -eq 3 ] && [ "$1" = 100644 ] && [ "$2" = blob ] || exit 1
    [ "$3" = "$(field "$src")" ] || exit 1
done
"$git_bin" -C "$git_root" archive --format=tar "$source_sha" src tools/inference-builder/build.py > "$archive" || exit 1
[ -s "$archive" ] || exit 1
/bin/busybox mkdir -p "$stage_dir/system/intelligence-source"
/bin/busybox tar -xf "$archive" -C "$stage_dir/system/intelligence-source" || exit 1
printf '%s\n' "$bridges" | while IFS= read -r item; do
    [ -n "$item" ] || continue
    target=$stage_dir/${item%%:*}
    template=$stage_dir/system/services/intelligence-source/wrappers/${item#*:}
    [ -f "$template" ] && [ ! -L "$template" ] && [ -f "$target" ] && [ ! -L "$target" ] || exit 1
    /bin/busybox cp "$template" "$target" || exit 1
done
(
    cd "$stage_dir" || exit 1
    : > .intelligence-file-hashes
    for src in $files; do /bin/busybox sha256sum "system/intelligence-source/$src" >> .intelligence-file-hashes || exit 1; done
    printf '%s\n' "$bridges" | while IFS= read -r item; do
        [ -n "$item" ] || continue
        /bin/busybox sha256sum "${item%%:*}" || exit 1
    done >> .intelligence-file-hashes
)
verify_files || exit 1
printf '%s\n' "$source_sha" > "$stage_dir/.intelligence-source-sha"
rm -rf "$git_root"
rm -f "$archive"
printf 'PINNED_OWNER_INTELLIGENCE_STAGED=%s\n' "$source_sha"
