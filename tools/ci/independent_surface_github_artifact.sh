#!/usr/bin/env bash
# Reuse a canonical producer artifact across GitHub Actions branch/PR cache scopes.
set -euo pipefail
out="$1"
commit="$2"
branch="$3"
github_output="$4"
repo="$GITHUB_REPOSITORY"
: "$GH_TOKEN"
: "$RUNNER_TEMP"
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid integration commit' >&2; exit 1; }
[[ "$branch" =~ ^[a-zA-Z0-9._/-]+$ ]] || { echo 'Invalid producer branch' >&2; exit 1; }
[[ "$repo" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]] || { echo 'Invalid repository' >&2; exit 1; }
command -v gh >/dev/null || { echo 'GitHub CLI is required for artifact reuse' >&2; exit 1; }
scratch=$(mktemp -d "$RUNNER_TEMP/ordax-surface-handoff.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
gh api --method GET "repos/$repo/actions/workflows/independent-surface-runtime.yml/runs" \
  -f branch="$branch" -f event=workflow_dispatch -f per_page=100 > "$scratch/runs.json"
python3 - "$scratch/runs.json" "$commit" "$branch" "$repo" > "$scratch/candidates" <<'PY'
import json
from pathlib import Path
import re
import subprocess
import sys

source, commit, branch, repo = sys.argv[1:]
items = json.loads(Path(source).read_text(encoding="utf-8"))["workflow_runs"]
for item in items:
    sha = item.get("head_sha", "")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        continue
    if item.get("head_branch") != branch or item.get("event") != "workflow_dispatch":
        continue
    if (item.get("head_repository") or {}).get("full_name") != repo:
        continue
    if item.get("status") not in ("in_progress", "completed"):
        continue
    if subprocess.run(["git", "merge-base", "--is-ancestor", sha, commit],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        continue
    run_id = item.get("id")
    if type(run_id) is int and run_id > 0:
        print(run_id)
PY
while IFS= read -r run_id; do
  name="ordax-independent-surface-runtime-$run_id"
  gh api --method GET "repos/$repo/actions/runs/$run_id/artifacts" \
    -f per_page=100 > "$scratch/artifacts.json"
  if ! python3 - "$scratch/artifacts.json" "$name" <<'PY'
import json
from pathlib import Path
import sys
items = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["artifacts"]
valid = [a for a in items if a.get("name") == sys.argv[2] and
         not a.get("expired") and a.get("size_in_bytes", 0) > 0]
sys.exit(0 if len(valid) == 1 else 1)
PY
  then
    continue
  fi
  mkdir -p "$scratch/artifact"
  gh run download "$run_id" --repo "$repo" --name "$name" --dir "$scratch/artifact"
  stage="$scratch/artifact/ordax-independent-surface"
  test -d "$stage" && test ! -L "$stage" || {
    echo 'Canonical Surface producer archive has no expected directory' >&2
    exit 1
  }
  python3 tools/ci/independent_surface_component_cache.py verify \
    --out "$stage" --integration-commit "$commit" --cache-hit true --consumer \
    --receipt "$scratch/verified-before-move.json" >/dev/null
  if [ -e "$out" ] || [ -L "$out" ]; then
    test -d "$out" && test ! -L "$out" && \
      test -z "$(find "$out" -mindepth 1 -maxdepth 1 -print -quit)" || {
      echo 'Refusing to replace an existing Surface output' >&2
      exit 1
    }
    rmdir "$out"
  fi
  mv -- "$stage" "$out"
  python3 tools/ci/independent_surface_component_cache.py verify \
    --out "$out" --integration-commit "$commit" --cache-hit true --consumer \
    --receipt "$scratch/verified-after-move.json" >/dev/null
  printf 'hit=true\nproducer_run_id=%s\n' "$run_id" >> "$github_output"
  echo "Verified canonical Surface restored from GitHub producer run $run_id"
  exit 0
done < "$scratch/candidates"
printf 'hit=false\n' >> "$github_output"
echo 'No exact verified GitHub producer artifact is available; retaining fail-closed gate.'
