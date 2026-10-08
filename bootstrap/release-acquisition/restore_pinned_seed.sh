#!/usr/bin/env bash
# Restore the immutable historical Release Agent seed from THIS repository.
# Repo ID, release tag and SHA-256 are pinned. The current GitHub namespace is
# supplied exclusively by the GitHub Actions runner (not a user argument).
# This is artifact retrieval, not signing, release promotion or owner authority.
set -euo pipefail

readonly expected_repository_id='1371063347'
# The repository was renamed in place; its immutable GitHub repository ID
# and the historical seed's SHA-256 remain unchanged.
readonly expected_repository='ordaxsystems/ordax-os'
readonly seed_sha256='550df685679f1bf15a636729960fe6fc3ffc1afda1a346214ce96716f7170a66'

if [[ "${GITHUB_REPOSITORY_ID:-}" != "$expected_repository_id" ]]; then
  echo 'RELEASE_AGENT_SEED_REPOSITORY_ID=REJECTED' >&2
  exit 1
fi
if [[ "${GITHUB_REPOSITORY:-}" != "$expected_repository" ]]; then
  echo 'RELEASE_AGENT_SEED_REPOSITORY_NAME=REJECTED' >&2
  exit 1
fi

readonly url="https://github.com/${GITHUB_REPOSITORY}/releases/download/ordax-release-agent-${seed_sha256}/ordax-release-agent"
readonly destination='bootstrap/release-acquisition/ordax-release-agent'
if [[ -L "$destination" ]]; then
  echo 'RELEASE_AGENT_SEED_DESTINATION_SYMLINK=REJECTED' >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl --proto '=https' --proto-redir '=https' --tlsv1.2 --fail --location \
  --silent --show-error --retry 2 --max-time 120 "$url" --output "$tmp"
actual="$(sha256sum "$tmp" | awk '{print $1}')"
if [[ "$actual" != "$seed_sha256" ]]; then
  echo "canonical release-agent seed hash mismatch: expected=$seed_sha256 actual=$actual" >&2
  exit 1
fi

install -m 0755 "$tmp" "$destination"
test "$(sha256sum "$destination" | awk '{print $1}')" = "$seed_sha256"
echo "RELEASE_AGENT_BOOTSTRAP_SEED_SHA256=$seed_sha256"
echo 'RELEASE_AGENT_SEED_REPOSITORY_ID_VERIFIED=YES'
echo 'RELEASE_AGENT_REFRESH_TARGET_REMAINS_SEPARATE=YES'
