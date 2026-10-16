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
      sites/public \
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
    # The Web artifact consumes the Surface plus the exact canonical login
    # dependency closure. Unrelated public portal pages must not rebuild Web.
    if git diff --quiet "$previous" "$current" -- \
      system \
      sites/public/login/index.html \
      sites/public/assets/site.css \
      sites/public/assets/account.css \
      sites/public/assets/ordax-design-tokens.css \
      sites/public/assets/site.js \
      sites/public/i18n/catalog.js \
      sites/public/i18n/runtime.js \
      sites/public/config/public-site.json \
      tools/surface-web \
      tools/public-site \
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
      package.json package-lock.json vercel.json; then
      exit 0
    fi
    ;;
  *)
    # Never skip an unrecognized project. The build dispatcher will fail closed.
    exit 1
    ;;
esac
exit 1
