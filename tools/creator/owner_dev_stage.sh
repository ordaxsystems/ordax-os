#!/usr/bin/env bash
# Canonical Owner/Dev disposable staging shared by local executor and CI.
# Creates no physical writes; the Creator Core owns staging and validation.
set -euo pipefail
if [ "$#" -ne 6 ]; then
  echo "usage: $0 MANIFEST PAYLOAD STAGE CREATOR_CLI ROOTFS_DIR SURFACE_PRODUCER_DIR" >&2
  exit 2
fi
manifest="$1"; payload="$2"; stage="$3"; creator_cli="$4"; rootfs="$5"; surface="$6"
test -x "$creator_cli"
test -d "$rootfs"
test -d "$surface"
python3 tools/creator/assemble.py build --manifest "$manifest" --out-dir "$payload"
python3 tools/creator/assemble.py verify --manifest "$manifest" --payload-root "$payload"
verify_output="$("$creator_cli" verify-payload --manifest "$manifest" --payload-root "$payload")"
printf '%s\n' "$verify_output"
grep -Fxq 'PAYLOAD_VERIFIED=YES' <<<"$verify_output"
grep -Fxq 'PHYSICAL_WRITE_STATUS=blocked' <<<"$verify_output"
stage_output="$("$creator_cli" stage-tree --manifest "$manifest" --payload-root "$payload" --output-root "$stage")"
printf '%s\n' "$stage_output"
grep -Fxq 'DISPOSABLE_TREE_STAGED=YES' <<<"$stage_output"
grep -Fxq 'PHYSICAL_WRITE_STATUS=blocked' <<<"$stage_output"
# Buildroot archive was verified and confined before this step.
# Match existing Owner/Dev materialization: dereference confined symlinks.
sudo mkdir -p "$stage/ORDAX/dev-base"
sudo cp -aL "$rootfs/." "$stage/ORDAX/dev-base/"
sudo python3 tools/creator/verify_owner_dev_offline_runtime.py --stage-root "$stage" --producer-out "$surface"
sudo python3 tools/ci/owner_rootfs_capabilities.py verify-owner-stage --stage-root "$stage"
sudo python3 tools/creator/verify_owner_dev_offline_runtime.py --stage-root "$stage"
if sudo find "$stage" -type l -print -quit | grep -q .; then
  echo 'development seed may not contain symlinks' >&2
  exit 1
fi
sudo python3 tools/creator/verify_owner_dev_offline_runtime.py --stage-root "$stage" --geometry-out "${ORDAX_DEV_GEOMETRY_OUT:?set ORDAX_DEV_GEOMETRY_OUT to an output JSON path}"
echo "ORDAX_DEV_STAGE_VERIFIED=$stage"
