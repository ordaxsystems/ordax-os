#!/bin/sh
# Single canonical ignored-build decision for the public Vercel adapter.
# Vercel: exit 0 skips; exit 1 builds. Uncertain history MUST build.
# The first deployment has no VERCEL_GIT_PREVIOUS_SHA. Shallow clones may
# likewise lack an older commit; neither condition is an error.
previous=${VERCEL_GIT_PREVIOUS_SHA:-}
current=${VERCEL_GIT_COMMIT_SHA:-}
if [ -z "$previous" ] || [ -z "$current" ]; then
  exit 1
fi
if ! git cat-file -e "$previous^{commit}" 2>/dev/null; then
  exit 1
fi
if ! git cat-file -e "$current^{commit}" 2>/dev/null; then
  exit 1
fi

# Only an unchanged public site and its directly imported modules may skip.
# A git error is always treated as 'build', never as 'ignore'.
if git diff --quiet "$previous" "$current" -- \
  sites/public \
  api/account-proxy.mjs \
  infra/supabase/functions/ordax-public-account-gateway/public_request_context.mjs \
  infra/supabase/functions/_shared/bounded_body.mjs \
  package.json \
  package-lock.json \
  vercel.json \
  tools/public-site \
  platform/releases/publications.json \
  docs/contracts/public-site.json \
  docs/contracts/public-site-deployment.json \
  docs/contracts/public-release-catalog.json \
  docs/contracts/release-compliance.json \
  docs/contracts/public-legal-readiness.json; then
  exit 0
fi
exit 1
