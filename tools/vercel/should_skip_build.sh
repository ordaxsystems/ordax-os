#!/bin/sh
# One fail-closed Vercel policy for the existing public and Web projects.
# The Site's source impact is owned only by site/scripts/build_impact.py.
# Vercel: exit 0 skips the build; exit 1 builds.
previous=$VERCEL_GIT_PREVIOUS_SHA
current=$VERCEL_GIT_COMMIT_SHA
project=$VERCEL_PROJECT_ID

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
# An unexpected checkout cannot prove that the intended revision is unchanged.
if [ "$(git rev-parse --verify HEAD 2>/dev/null)" != "$current" ]; then
  exit 1
fi

case "$project" in
  prj_mA9ew6hOfjdqlBr1cC757iMLPQJC)
    # The actual ordax.com.br project consumes the canonical site/ module.
    # Keep its non-Site inputs separate, not a second mirror of Site paths.
    if git diff --quiet "$previous" "$current" -- \
      tools/brand \
      platform/releases/publications.json \
      docs/contracts \
      vercel.json &&
      python3 site/scripts/build_impact.py --vercel; then
      exit 0
    fi
    ;;
  prj_ftACluUqk6i9DoD9GPIwmgURwckP)
    # Web consumes the shared Site login from the same OS Git revision.
    # Its own native/Web inputs remain additional invalidation sources.
    if git diff --quiet "$previous" "$current" -- \
      system \
      tools/surface-web \
      tools/brand \
      tools/source_graph.py \
      third_party/licenses \
      api \
      docs/contracts \
      docs/evidence/web-layout-reference-2026-10-10.json \
      docs/evidence/web-central-reference-2026-10-11.json \
      vercel.json &&
      python3 site/scripts/build_impact.py --vercel; then
      exit 0
    fi
    ;;
  *)
    # Unknown project never skips a deployment.
    exit 1
    ;;
esac
exit 1
