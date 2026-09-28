#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROOF="${1:-$ROOT/out/base-update/dev-postboot-promotion-proof.json}"
SOURCE_SHA="dddddddddddddddddddddddddddddddddddddddd"
BAD_SHA="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
BOOT_ID="11111111111111111111111111111111"

for command in losetup sfdisk mkfs.vfat mkfs.ext4 fsck.vfat mount umount mountpoint python3 sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "dev-postboot-promotion-proof: required program not found: $command" >&2
    exit 1
  }
done

mkdir -p "$ROOT/out"
WORK="$(mktemp -d "$ROOT/out/dev-postboot-promotion.XXXXXX")"
IMAGE="$WORK/disk.raw"
ESP_MOUNT="$WORK/esp"
PROMOTE_MOUNT="$WORK/promote"
LABEL_ROOT="$WORK/by-label"
STATE_ROOT="$WORK/state"
KERNEL="$WORK/vmlinuz"
INITRAMFS="$WORK/initrd.gz"
CMDLINE="$WORK/cmdline"
BOOT_ID_FILE="$WORK/base-boot-id"
HEALTHY_SHA="$WORK/healthy-sha"
BASE_HEARTBEAT="$STATE_ROOT/base-update/base-heartbeat.json"
SURFACE_HEARTBEAT="$WORK/surface-heartbeat.json"
RESULT="$WORK/promotion-result.json"
ERROR_LOG="$WORK/bad-health.log"
LOOP=""

cleanup() {
  set +e
  for mountpoint_path in "$ESP_MOUNT" "$PROMOTE_MOUNT"; do
    if [[ -d "$mountpoint_path" ]] && mountpoint -q "$mountpoint_path"; then
      sudo umount "$mountpoint_path" >/dev/null 2>&1 || true
    fi
  done
  if [[ -n "$LOOP" ]]; then
    sudo losetup -d "$LOOP" >/dev/null 2>&1 || true
  fi
  sudo rm -rf "$WORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

mkdir -p   "$ESP_MOUNT"   "$PROMOTE_MOUNT"   "$LABEL_ROOT"   "$STATE_ROOT/base-update"   "$(dirname "$PROOF")"
truncate -s 96M "$IMAGE"

sudo sfdisk "$IMAGE" >/dev/null <<'EOF'
label: gpt
size=65536, type=C12A7328-F81F-11D2-BA4B-00A0C93EC93B
type=0FC63DAF-8483-4772-8E79-3D69D8477DE4
EOF

LOOP="$(sudo losetup --find --show --partscan "$IMAGE")"
ESP="${LOOP}p1"
ROOT_PART="${LOOP}p2"

for _ in $(seq 1 40); do
  [[ -b "$ESP" && -b "$ROOT_PART" ]] && break
  sleep 0.1
done
[[ -b "$ESP" && -b "$ROOT_PART" ]] || {
  echo "dev-postboot-promotion-proof: loop partitions did not appear" >&2
  exit 1
}

sudo mkfs.vfat -F 32 -n ORDAX-ESP "$ESP" >/dev/null
sudo mkfs.ext4 -F -L ORDAX-ROOT "$ROOT_PART" >/dev/null 2>&1
printf 'candidate-kernel\n' >"$KERNEL"
printf 'candidate-initramfs\n' >"$INITRAMFS"

sudo mount -t vfat -o rw,umask=0022 "$ESP" "$ESP_MOUNT"
sudo mkdir -p "$ESP_MOUNT/loader/entries" "$ESP_MOUNT/ordax"
printf 'title OrdaX Current\nlinux /ordax/vmlinuz\ninitrd /ordax/initrd.gz\noptions console=tty0 ordax.mode=normal\n' \
  | sudo tee "$ESP_MOUNT/loader/entries/ordax.conf" >/dev/null
printf 'title OrdaX Recovery\nlinux /ordax/vmlinuz\ninitrd /ordax/initrd.gz\noptions console=tty0 ordax.mode=recovery\n' \
  | sudo tee "$ESP_MOUNT/loader/entries/ordax-recovery.conf" >/dev/null
printf 'known-good-kernel\n' | sudo tee "$ESP_MOUNT/ordax/vmlinuz" >/dev/null
printf 'known-good-initramfs\n' | sudo tee "$ESP_MOUNT/ordax/initrd.gz" >/dev/null

sudo python3 - "$ROOT" "$ESP_MOUNT" "$KERNEL" "$INITRAMFS" "$SOURCE_SHA" <<'PY'
import hashlib
import importlib.util
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
esp = pathlib.Path(sys.argv[2])
kernel = pathlib.Path(sys.argv[3])
initramfs = pathlib.Path(sys.argv[4])
release = sys.argv[5]
module_path = root / "bootstrap/base-update/stage.py"
spec = importlib.util.spec_from_file_location("ordax_postboot_stage_fixture", module_path)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

candidate = {
    "release_sha": release,
    "kernel_sha256": hashlib.sha256(kernel.read_bytes()).hexdigest(),
    "initramfs_sha256": hashlib.sha256(initramfs.read_bytes()).hexdigest(),
}
result = module.stage(esp, "legacy", candidate, kernel, initramfs)
assert result["candidate_slot"] == "b"
assert result["activation_ready"] is True
assert result["efi_variable_written"] is False
assert result["reboot_requested"] is False
PY
sync
sudo umount "$ESP_MOUNT"
sudo fsck.vfat -n "$ESP" >/dev/null

ln -s "$ESP" "$LABEL_ROOT/ORDAX-ESP"
printf 'quiet splash ordax.mode=normal ordax.base_slot=b ordax.base_candidate=%s\n' "$SOURCE_SHA" >"$CMDLINE"
printf '%s\n' "$BOOT_ID" >"$BOOT_ID_FILE"
printf '%s\n' "$BAD_SHA" >"$HEALTHY_SHA"
printf 'pending\n' >"$STATE_ROOT/boot-refresh-required"
printf '{"$schema":"prototype-ordax.base-heartbeat/1","candidateSha":"%s","sourceSha":"%s","slot":"b","bootId":"%s"}\n' \
  "$SOURCE_SHA" "$SOURCE_SHA" "$BOOT_ID" >"$BASE_HEARTBEAT"
printf '{"sourceSha":"%s","bootId":"%s","observedEpoch":1}\n' \
  "$SOURCE_SHA" "$BOOT_ID" >"$SURFACE_HEARTBEAT"

IMAGE_BEFORE_BAD="$(sha256sum "$IMAGE" | awk '{print $1}')"
set +e
sudo python3 "$ROOT/system/services/base-update/dev_postboot_promote.py" \
  --root-source "$ROOT_PART" \
  --esp-mount-root "$PROMOTE_MOUNT" \
  --state-root "$STATE_ROOT" \
  --cmdline "$CMDLINE" \
  --boot-id "$BOOT_ID_FILE" \
  --base-heartbeat "$BASE_HEARTBEAT" \
  --surface-heartbeat "$SURFACE_HEARTBEAT" \
  --healthy-sha "$HEALTHY_SHA" \
  --source-sha "$SOURCE_SHA" \
  --expected-release-sha "$SOURCE_SHA" \
  --by-label-root "$LABEL_ROOT" \
  >"$WORK/bad-result.json" 2>"$ERROR_LOG"
BAD_RC=$?
set -e
[[ "$BAD_RC" -ne 0 ]] || {
  echo "dev-postboot-promotion-proof: mismatched health unexpectedly promoted" >&2
  exit 1
}
IMAGE_AFTER_BAD="$(sha256sum "$IMAGE" | awk '{print $1}')"
test "$IMAGE_BEFORE_BAD" = "$IMAGE_AFTER_BAD"
grep -Fq 'surface_health_release' "$ERROR_LOG"
mountpoint -q "$PROMOTE_MOUNT" && {
  echo "dev-postboot-promotion-proof: failed health left ESP mounted" >&2
  exit 1
}

printf '%s\n' "$SOURCE_SHA" >"$HEALTHY_SHA"

sudo python3 "$ROOT/system/services/base-update/dev_postboot_promote.py" \
  --root-source "$ROOT_PART" \
  --esp-mount-root "$PROMOTE_MOUNT" \
  --state-root "$STATE_ROOT" \
  --cmdline "$CMDLINE" \
  --boot-id "$BOOT_ID_FILE" \
  --base-heartbeat "$BASE_HEARTBEAT" \
  --surface-heartbeat "$SURFACE_HEARTBEAT" \
  --healthy-sha "$HEALTHY_SHA" \
  --source-sha "$SOURCE_SHA" \
  --expected-release-sha "$SOURCE_SHA" \
  --by-label-root "$LABEL_ROOT" \
  >"$RESULT"

mountpoint -q "$PROMOTE_MOUNT" && {
  echo "dev-postboot-promotion-proof: promotion left ESP mounted" >&2
  exit 1
}

sudo mount -t vfat -o ro,nosuid,nodev,noexec "$ESP" "$ESP_MOUNT"
sudo grep -Fq 'linux /ordax/base/b/vmlinuz' "$ESP_MOUNT/loader/entries/ordax.conf"
sudo grep -Fq 'initrd /ordax/base/b/initrd.gz' "$ESP_MOUNT/loader/entries/ordax.conf"
sudo grep -Fq 'ordax.mode=normal ordax.base_slot=b' "$ESP_MOUNT/loader/entries/ordax.conf"
! sudo grep -Fq 'ordax.base_candidate=' "$ESP_MOUNT/loader/entries/ordax.conf"
sudo grep -Fq 'linux /ordax/base/a/vmlinuz' "$ESP_MOUNT/loader/entries/ordax-recovery.conf"
sudo grep -Fq 'initrd /ordax/base/a/initrd.gz' "$ESP_MOUNT/loader/entries/ordax-recovery.conf"
sudo grep -Fq 'ordax.mode=recovery ordax.base_slot=a' "$ESP_MOUNT/loader/entries/ordax-recovery.conf"
test ! -e "$ESP_MOUNT/loader/entries/ordax-candidate+01-00.conf"
sudo umount "$ESP_MOUNT"
sudo fsck.vfat -n "$ESP" >/dev/null

test ! -e "$STATE_ROOT/boot-refresh-required"
test -s "$STATE_ROOT/base/active-slot.json"

sudo python3 - "$RESULT" "$STATE_ROOT/base/active-slot.json" "$PROOF" "$SOURCE_SHA" "$BOOT_ID" <<'PY'
import json
import pathlib
import sys

result = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
active = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
proof_path = pathlib.Path(sys.argv[3])
source = sys.argv[4]
boot_id = sys.argv[5]

assert result["$schema"] == "prototype-ordax.dev-base-postboot-promotion/1"
assert result["status"] == "promoted"
assert result["source_commit"] == source
assert result["boot_id"] == boot_id
assert result["active_slot"] == "b"
assert result["recovery_slot"] == "a"
assert result["health_verified"] is True
assert result["current_entry_promoted"] is True
assert result["recovery_entry_preserved_previous_slot"] is True
assert result["candidate_entry_removed"] is True
assert result["postflight_verified"] is True
assert result["mount_released"] is True
assert result["reboot_requested"] is False
assert result["efi_variable_written"] is False

assert active["$schema"] == "prototype-ordax.base-active-slot/1"
assert active["releaseSha"] == source
assert active["activeSlot"] == "b"
assert active["recoverySlot"] == "a"
assert active["bootId"] == boot_id

proof = {
    "$schema": "prototype-ordax.dev-base-postboot-promotion-proof/1",
    "status": "pass",
    "source_commit": source,
    "checks": {
        "mismatched_health_blocks_before_esp_mutation": True,
        "candidate_cmdline_identity_required": True,
        "base_heartbeat_same_boot_required": True,
        "surface_health_same_release_required": True,
        "surface_heartbeat_same_boot_required": True,
        "live_candidate_entry_required": True,
        "known_good_previous_slot_preserved_as_recovery": True,
        "candidate_becomes_current_only_after_health": True,
        "candidate_entry_removed_after_promotion": True,
        "active_slot_record_written": True,
        "boot_refresh_marker_cleared_after_promotion": True,
        "postflight_readonly_validation_passed": True,
        "filesystem_passes_read_only_fsck": True,
        "reboot_not_requested": True,
        "efi_variable_not_written": True,
    },
    "physical_hardware_touched": False,
    "physical_hardware_proven": False,
}
proof_path.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print("DEV_POSTBOOT_PROMOTION_PROOF=PASS")
PY
