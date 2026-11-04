#!/bin/sh
# Vercel ignored-build decision shared by the two canonical public projects.
# Vercel: exit 0 skips, exit 1 builds. Missing or uncertain history MUST build.
previous=${VERCEL_GIT_PREVIOUS_SHA:-}
current=${VERCEL_GIT_COMMIT_SHA:-}
project=${VERCEL_PROJECT_ID:-}

if [ -z "$previous" ] || [ -z "$current" ]; then
  exit 1
fi
if ! git cat-file -e "$previous^{commit}" 2>/dev/null; then
  exit 1
fi
if ! git cat-file -e "$current^{commit}" 2>/dev/null; then
  exit 1
fi
if [ "$previous" = "$current" ]; then
  exit 1
fi

case "$project" in
  prj_mA9ew6hOfjdqlBr1cC757iMLPQJC)
    if git diff --quiet "$previous" "$current" -- \
      tools/public-site \
      tools/brand \
      tools/vercel \
      api \
      lib/account-proxy-core.mjs \
      infra/supabase/functions/ordax-public-account-gateway \
      infra/supabase/functions/_shared \
      platform/releases/publications.json \
      docs/contracts \
      package.json package-lock.json vercel.json; then
      exit 0
    fi
    ;;
  prj_ftACluUqk6i9DoD9GPIwmgURwckP)
    # Web composes the pinned independent Site login and Surface source.
    # Neither source is copied into OS Git; their lock changes are watched
    # through docs/contracts and the resolver through tools/vercel.
    # The checked-in autonomy contract owns the exact Linux-only excludes.
    # Failure to inspect or validate ANY source means BUILD, not silent skip.
    script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
    linux_excludes=$(python3 "$script_dir/web_linux_exclusions.py" 2>/dev/null) || exit 1
    [ -n "$linux_excludes" ] || exit 1
    set -f
    set -- system \
      tools/surface-web \
      tools/brand \
      tools/source_graph.py \
      tools/vercel \
      third_party/licenses \
      api \
      lib/account-proxy-core.mjs \
      infra/supabase/functions/ordax-public-account-gateway \
      infra/supabase/functions/_shared \
      docs/contracts \
      docs/evidence/web-layout-reference-2026-10-10.json \
      docs/evidence/web-central-reference-2026-10-11.json \
      package.json package-lock.json vercel.json
    for excluded in $linux_excludes; do
      set -- "$@" "$excluded"
    done
    set +f
    if git diff --quiet "$previous" "$current" -- "$@"; then
      exit 0
    fi
    ;;
  *)
    # Never skip an unrecognized project. The build dispatcher will fail closed.
    exit 1
    ;;
esac
exit 1
