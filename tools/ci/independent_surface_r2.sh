#!/usr/bin/env bash
# Canonical SSOT for immutable, verified Surface EROFS transfers to/from R2.
# Both Independent Surface and Creator use this transport and the same
# independent_surface_component_cache.py checksum/fingerprint verifier.
set -euo pipefail
operation=${1:?usage: independent_surface_r2.sh restore|publish}
: "${RUNNER_TEMP:?}"
: "${ORDAX_R2_ACCOUNT_ID:?}"
: "${ORDAX_R2_BUCKET:?}"
: "${ORDAX_SURFACE_FINGERPRINT:?}"
case "$ORDAX_SURFACE_FINGERPRINT" in
  ''|*[!0-9a-f]*) echo 'invalid Surface input fingerprint' >&2; exit 2 ;;
esac
[ "${#ORDAX_SURFACE_FINGERPRINT}" -eq 64 ] || { echo 'invalid Surface input fingerprint length' >&2; exit 2; }
# Read one immutable Surface manifest in the parent shell's exit-status scope.
# Process substitution (mapfile < <(python3 ...)) discards Python failures:
# the caller could otherwise publish a manifest without its two blob objects.
surface_manifest_rows() {
  local manifest_file="$1" mode="$2"
  python3 - "$manifest_file" "$mode" <<'PY'
import hashlib
import json
import os
import re
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
mode = sys.argv[2]
if mode not in ("restore", "publish"):
    raise SystemExit("unsupported Surface manifest operation")
if manifest_path.is_symlink() or not manifest_path.is_file():
    raise SystemExit("unsafe or missing Surface manifest")
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
if not isinstance(manifest, dict):
    raise SystemExit("invalid Surface manifest object")
if manifest.get("$schema") != "prototype-ordax.independent-surface-component-cache/1":
    raise SystemExit("unexpected Surface manifest schema")
if manifest.get("fingerprint_version") != "independent-surface-inputs-v1":
    raise SystemExit("unexpected Surface fingerprint version")
if manifest.get("input_fingerprint") != os.environ["ORDAX_SURFACE_FINGERPRINT"]:
    raise SystemExit("Surface manifest fingerprint mismatch")
expected = ("provenance.json", "native-surface-runtime.erofs")
artifacts = manifest.get("artifacts")
if not isinstance(artifacts, dict) or set(artifacts) != set(expected):
    raise SystemExit("Surface manifest artifact inventory mismatch")
rows = []
for name in expected:
    entry = artifacts[name]
    if not isinstance(entry, dict):
        raise SystemExit(f"invalid Surface artifact metadata: {name}")
    digest = entry.get("sha256")
    size = entry.get("size")
    if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
        raise SystemExit(f"invalid Surface digest: {name}")
    if type(size) is not int or size < 1:
        raise SystemExit(f"invalid Surface artifact size: {name}")
    if mode == "publish":
        path = manifest_path.parent / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size != size:
            raise SystemExit(f"Surface artifact missing, unsafe or changed size: {name}")
        actual = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                actual.update(chunk)
        if actual.hexdigest() != digest:
            raise SystemExit(f"Surface artifact bytes differ from manifest: {name}")
    rows.append(f"{name}\t{digest}")
for row in rows:
    print(row)
PY
}

restore_surface() {
set -euo pipefail
printf 'hit=false\n' >> "$GITHUB_OUTPUT"
if [ -z "${ORDAX_R2_ACCESS_KEY_ID:-}" ] || [ -z "${ORDAX_R2_SECRET_ACCESS_KEY:-}" ]; then
  echo 'Durable R2 store is not configured for this runner; GitHub cache/build fallback remains available.'
  exit 0
fi

out="$RUNNER_TEMP/ordax-independent-surface"
rm -rf "$out"
mkdir -p "$out"
endpoint="https://${ORDAX_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
prefix='ci/surface-runtime/v1'
manifest_key="${prefix}/manifests/${ORDAX_SURFACE_FINGERPRINT}.json"

r2_get() {
  key="$1"
  destination="$2"
  tmp="${destination}.partial"
  rm -f "$tmp"
  code="$(curl --silent --show-error --retry 3 --retry-all-errors \
    --connect-timeout 15 --max-time 600 \
    --aws-sigv4 'aws:amz:auto:s3' \
    --user "${ORDAX_R2_ACCESS_KEY_ID}:${ORDAX_R2_SECRET_ACCESS_KEY}" \
    --output "$tmp" --write-out '%{http_code}' \
    "${endpoint}/${ORDAX_R2_BUCKET}/${key}" || true)"
  case "$code" in
    200)
      mv "$tmp" "$destination"
      return 0
      ;;
    404)
      rm -f "$tmp"
      return 44
      ;;
    *)
      rm -f "$tmp"
      echo "R2 GET failed for ${key}: HTTP ${code}" >&2
      return 1
      ;;
  esac
}

if r2_get "$manifest_key" "$out/.ordax-independent-surface-cache.json"; then
  :
else
  status=$?
  if [ "$status" -eq 44 ]; then
    echo 'Durable R2 Surface artifact miss; a fresh build is required.'
    rm -rf "$out"
    mkdir -p "$out"
    exit 0
  fi
  exit "$status"
fi

# Command substitution propagates the validator's failure to this shell.
if ! rows="$(surface_manifest_rows "$out/.ordax-independent-surface-cache.json" restore)"; then
  echo "Rejecting unverified durable Surface manifest before downloading blobs." >&2
  exit 1
fi
mapfile -t artifact_rows <<< "$rows"
if [ "${#artifact_rows[@]}" -ne 2 ]; then
  echo "Durable Surface manifest did not declare both required blobs." >&2
  exit 1
fi
for row in "${artifact_rows[@]}"; do
  name="${row%%$'\t'*}"
  digest="${row#*$'\t'}"
  blob_key="${prefix}/blobs/sha256/${digest}"
  if ! r2_get "$blob_key" "$out/$name"; then
    echo "Durable Surface manifest exists but blob is unavailable: ${name}" >&2
    exit 1
  fi
done

python3 tools/ci/independent_surface_component_cache.py verify \
  --out "$out" \
  --integration-commit "$ORDAX_SOURCE_COMMIT" \
  --cache-hit true \
  --receipt "$RUNNER_TEMP/independent-surface-component-reuse.json"
printf 'hit=true\n' >> "$GITHUB_OUTPUT"
echo 'Restored cryptographically verified Surface bytes from durable R2 store.'

}
publish_surface() {
set -euo pipefail
if [ -z "${ORDAX_R2_ACCESS_KEY_ID:-}" ] || [ -z "${ORDAX_R2_SECRET_ACCESS_KEY:-}" ]; then
  echo 'Durable R2 credentials are unavailable; verified GitHub cache remains usable, but durable publication was skipped.'
  exit 0
fi

out="$RUNNER_TEMP/ordax-independent-surface"
manifest="$out/.ordax-independent-surface-cache.json"
endpoint="https://${ORDAX_R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
prefix='ci/surface-runtime/v1'
manifest_key="${prefix}/manifests/${ORDAX_SURFACE_FINGERPRINT}.json"

r2_status() {
  key="$1"
  curl --silent --show-error --retry 3 --retry-all-errors \
    --connect-timeout 15 --max-time 600 \
    --aws-sigv4 'aws:amz:auto:s3' \
    --user "${ORDAX_R2_ACCESS_KEY_ID}:${ORDAX_R2_SECRET_ACCESS_KEY}" \
    --head --output /dev/null --write-out '%{http_code}' \
    "${endpoint}/${ORDAX_R2_BUCKET}/${key}" || true
}

r2_put_immutable() {
  key="$1"
  file="$2"
  code="$(r2_status "$key")"
  if [ "$code" = 200 ]; then
    echo "Durable object already exists: $key"
    return 0
  fi
  if [ "$code" != 404 ]; then
    echo "R2 HEAD failed for ${key}: HTTP ${code}" >&2
    return 1
  fi
  code="$(curl --silent --show-error --retry 3 --retry-all-errors \
    --connect-timeout 15 --max-time 600 \
    --aws-sigv4 'aws:amz:auto:s3' \
    --user "${ORDAX_R2_ACCESS_KEY_ID}:${ORDAX_R2_SECRET_ACCESS_KEY}" \
    --header 'If-None-Match: *' \
    --upload-file "$file" --output /dev/null --write-out '%{http_code}' \
    "${endpoint}/${ORDAX_R2_BUCKET}/${key}" || true)"
  case "$code" in
    200|201|204)
      return 0
      ;;
    412)
      echo "Durable object won publication race and remains immutable: $key"
      return 0
      ;;
    *)
      echo "R2 immutable PUT failed for ${key}: HTTP ${code}" >&2
      return 1
      ;;
  esac
}

# Validate schema, input fingerprint and both local SHA-256 digests
# before ANY immutable R2 write. An invalid manifest cannot become permanent.
if ! rows="$(surface_manifest_rows "$manifest" publish)"; then
  echo "Refusing durable Surface publication without verified local bytes." >&2
  exit 1
fi
mapfile -t artifact_rows <<< "$rows"
if [ "${#artifact_rows[@]}" -ne 2 ]; then
  echo "Refusing publication with an incomplete Surface blob inventory." >&2
  exit 1
fi
for row in "${artifact_rows[@]}"; do
  name="${row%%$'\t'*}"
  digest="${row#*$'\t'}"
  r2_put_immutable "${prefix}/blobs/sha256/${digest}" "$out/$name"
done

existing_manifest="$RUNNER_TEMP/existing-independent-surface-r2-manifest.json"
manifest_status="$(r2_status "$manifest_key")"
if [ "$manifest_status" = 200 ]; then
  code="$(curl --silent --show-error --retry 3 --retry-all-errors \
    --connect-timeout 15 --max-time 120 \
    --aws-sigv4 'aws:amz:auto:s3' \
    --user "${ORDAX_R2_ACCESS_KEY_ID}:${ORDAX_R2_SECRET_ACCESS_KEY}" \
    --output "$existing_manifest" --write-out '%{http_code}' \
    "${endpoint}/${ORDAX_R2_BUCKET}/${manifest_key}" || true)"
  test "$code" = 200
  if ! cmp -s "$manifest" "$existing_manifest"; then
    echo 'R2 fingerprint manifest already exists with different bytes; refusing overwrite.' >&2
    exit 1
  fi
elif [ "$manifest_status" = 404 ]; then
  r2_put_immutable "$manifest_key" "$manifest"
else
  echo "R2 HEAD failed for manifest: HTTP ${manifest_status}" >&2
  exit 1
fi
echo 'Verified Surface ensured in durable content-addressed R2 store.'

}
case "$operation" in
  restore)
    : "${GITHUB_OUTPUT:?}"
    : "${ORDAX_SOURCE_COMMIT:?}"
    restore_surface
    ;;
  publish) publish_surface ;;
  *) echo 'unsupported R2 operation' >&2; exit 2 ;;
esac
