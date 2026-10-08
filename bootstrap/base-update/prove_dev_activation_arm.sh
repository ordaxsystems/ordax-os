#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROOF="${1:-$ROOT/out/base-update/dev-activation-arm-proof.json}"
SOURCE_SHA="abababababababababababababababababababab"

for command in losetup sfdisk mkfs.vfat mkfs.ext4 fsck.vfat mount umount mountpoint python3 sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "dev-activation-arm-proof: required program not found: $command" >&2
    exit 1
  }
done

mkdir -p "$ROOT/out"
WORK="$(mktemp -d "$ROOT/out/dev-activation-arm.XXXXXX")"
IMAGE="$WORK/disk.raw"
ESP_MOUNT="$WORK/esp"
STAGE_MOUNT="$WORK/stage"
READINESS_MOUNT="$WORK/readiness"
ARM_MOUNT="$WORK/arm"
LABEL_ROOT="$WORK/by-label"
CANDIDATE_ROOT="$WORK/candidates"
VERSION_ROOT="$WORK/versions"
EFI_ROOT="$WORK/sys/firmware/efi"
EFIVARS="$EFI_ROOT/efivars"
EFIVAR_MOUNTINFO="$WORK/efivarfs-mountinfo"
STAGE_RESULT="$WORK/stage-result.json"
STAGED_SHA_FILE="$WORK/staged-sha"
READINESS_SHA_FILE="$WORK/readiness-sha"
READINESS_RESULT="$WORK/readiness.json"
ARM_RESULT="$WORK/arm-result.json"
LOOP=""

cleanup() {
  set +e
  for mountpoint_path in "$ESP_MOUNT" "$STAGE_MOUNT" "$READINESS_MOUNT" "$ARM_MOUNT"; do
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

mkdir -p   "$ESP_MOUNT"   "$STAGE_MOUNT"   "$READINESS_MOUNT"   "$ARM_MOUNT"   "$LABEL_ROOT"   "$CANDIDATE_ROOT"   "$VERSION_ROOT"   "$EFIVARS"   "$(dirname "$PROOF")"

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
  echo "dev-activation-arm-proof: loop partitions did not appear" >&2
  exit 1
}

sudo mkfs.vfat -F 32 -n ORDAX-ESP "$ESP" >/dev/null
sudo mkfs.ext4 -F -L ORDAX-ROOT "$ROOT_PART" >/dev/null 2>&1

sudo mount -t vfat -o rw,umask=0022 "$ESP" "$ESP_MOUNT"
sudo mkdir -p "$ESP_MOUNT/loader/entries" "$ESP_MOUNT/ordax"
printf 'title OrdaX Current\nlinux /ordax/vmlinuz\ninitrd /ordax/initrd.gz\noptions console=tty0 ordax.mode=normal\n'   | sudo tee "$ESP_MOUNT/loader/entries/ordax.conf" >/dev/null
printf 'title OrdaX Recovery\nlinux /ordax/vmlinuz\ninitrd /ordax/initrd.gz\noptions console=tty0 ordax.mode=recovery\n'   | sudo tee "$ESP_MOUNT/loader/entries/ordax-recovery.conf" >/dev/null
printf 'known-good-kernel\n' | sudo tee "$ESP_MOUNT/ordax/vmlinuz" >/dev/null
printf 'known-good-initramfs\n' | sudo tee "$ESP_MOUNT/ordax/initrd.gz" >/dev/null
sync
sudo umount "$ESP_MOUNT"

python3 - "$CANDIDATE_ROOT" "$VERSION_ROOT" "$SOURCE_SHA" <<'PY'
import hashlib
import json
import pathlib
import sys

candidate_root = pathlib.Path(sys.argv[1])
version_root = pathlib.Path(sys.argv[2])
source = sys.argv[3]
candidate = candidate_root / source
candidate.mkdir(parents=True)

kernel = b"development-arm-kernel\n"
initramfs = b"development-arm-initramfs\n"
rootfs = b"development-arm-rootfs-placeholder\n"

(candidate / "vmlinuz").write_bytes(kernel)
(candidate / "initrd.gz").write_bytes(initramfs)
(candidate / "rootfs.tar").write_bytes(rootfs)

tag = f"ordax-dev-base-{source}"
def binding(name, payload):
    return {
        "name": name,
        "url": (
            "https://github.com/ordaxsystems/ordax-os/"
            f"releases/download/{tag}/{name}"
        ),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "size": len(payload),
    }

manifest = {
    "$schema": "prototype-ordax.dev-base-candidate/3",
    "status": "development-candidate",
    "source_repository": "ordaxsystems/ordax-os",
    "source_commit": source,
    "tag": tag,
    "activation": "inactive-slot-next-boot",
    "rootfs_activation": "slot-coupled-one-shot-health-gated",
    "manual_usb_rewrite_required": False,
    "kernel": binding("vmlinuz", kernel),
    "initramfs": binding("initrd.gz", initramfs),
    "rootfs": binding("rootfs.tar", rootfs),
}
(candidate / "dev-base.json").write_text(
    json.dumps(manifest, sort_keys=True) + "\n",
    encoding="utf-8",
)

version = version_root / source
for relative in (
    "bin/busybox",
    "bin/sh",
    "usr/bin/git",
    "sbin/ordax-dev-init",
    "usr/local/bin/ordax-network",
    "usr/local/bin/ordax-pull",
    "usr/local/bin/ordax-rollback",
    "usr/local/bin/ordax-run",
):
    target = version / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    target.chmod(0o755)
for relative in (
    "state",
    "workspace",
    "home",
    "proc",
    "sys",
    "dev",
    "run",
    ".ordax-base",
):
    (version / relative).mkdir(parents=True, exist_ok=True)
(version / ".ordax-rootfs-commit").write_text(source + "\n", encoding="ascii")
PY

ln -s "$ESP" "$LABEL_ROOT/ORDAX-ESP"
printf '42 31 0:41 / %s rw,nosuid,nodev - efivarfs efivarfs rw\n' "$EFIVARS" >"$EFIVAR_MOUNTINFO"

sudo python3 "$ROOT/system/services/base-update/dev_physical_stage.py"   --repo-root "$ROOT"   --root-source "$ROOT_PART"   --candidate-root "$CANDIDATE_ROOT"   --version-root "$VERSION_ROOT"   --source-commit "$SOURCE_SHA"   --by-label-root "$LABEL_ROOT"   --mount-root "$STAGE_MOUNT"   >"$STAGE_RESULT"

printf '%s\n' "$SOURCE_SHA" >"$STAGED_SHA_FILE"

sudo python3 "$ROOT/system/services/base-update/dev_activation_readiness.py"   --root-source "$ROOT_PART"   --candidate-root "$CANDIDATE_ROOT"   --version-root "$VERSION_ROOT"   --source-commit "$SOURCE_SHA"   --staged-sha-file "$STAGED_SHA_FILE"   --stage-result-file "$STAGE_RESULT"   --by-label-root "$LABEL_ROOT"   --mount-root "$READINESS_MOUNT"   >"$READINESS_RESULT"

printf '%s\n' "$SOURCE_SHA" >"$READINESS_SHA_FILE"

for mountpoint_path in "$STAGE_MOUNT" "$READINESS_MOUNT"; do
  mountpoint -q "$mountpoint_path" && {
    echo "dev-activation-arm-proof: pre-arm helper left ESP mounted" >&2
    exit 1
  }
done

IMAGE_BEFORE_ARM="$(sha256sum "$IMAGE" | awk '{print $1}')"

sudo python3 "$ROOT/system/services/base-update/dev_activation_arm.py"   --root-source "$ROOT_PART"   --mount-root "$ARM_MOUNT"   --efivarfs-root "$EFIVARS"   --efi-root "$EFI_ROOT"   --efivarfs-mountinfo "$EFIVAR_MOUNTINFO"   --candidate-root "$CANDIDATE_ROOT"   --version-root "$VERSION_ROOT"   --source-commit "$SOURCE_SHA"   --staged-sha-file "$STAGED_SHA_FILE"   --readiness-sha-file "$READINESS_SHA_FILE"   --readiness-file "$READINESS_RESULT"   --by-label-root "$LABEL_ROOT"   >"$ARM_RESULT"

mountpoint -q "$ARM_MOUNT" && {
  echo "dev-activation-arm-proof: arm helper left ESP mounted" >&2
  exit 1
}

IMAGE_AFTER_ARM="$(sha256sum "$IMAGE" | awk '{print $1}')"
test "$IMAGE_BEFORE_ARM" = "$IMAGE_AFTER_ARM"
sudo fsck.vfat -n "$ESP" >/dev/null

sudo python3 - "$ARM_RESULT" "$EFIVARS" "$PROOF" "$SOURCE_SHA" "$IMAGE_AFTER_ARM" <<'PY'
import json
import pathlib
import struct
import sys

result = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
efivars = pathlib.Path(sys.argv[2])
proof_path = pathlib.Path(sys.argv[3])
source = sys.argv[4]
image_sha = sys.argv[5]

assert result["$schema"] == "prototype-ordax.dev-base-activation-arm/1"
assert result["status"] == "armed"
assert result["source_commit"] == source
assert result["candidate_slot"] == "b"
assert result["entry_id"] == "ordax-candidate.conf"
assert result["selector"] == "LoaderEntryOneShot"
assert result["staged_sha_verified"] is True
assert result["readiness_sha_verified"] is True
assert result["readiness_state_verified"] is True
assert result["candidate_manifest_revalidated"] is True
assert result["versioned_rootfs_revalidated"] is True
assert result["live_esp_revalidated"] is True
assert result["live_kernel_hash_revalidated"] is True
assert result["live_initramfs_hash_revalidated"] is True
assert result["efivarfs_preflight_verified"] is True
assert result["efivarfs_writable_mount_verified"] is True
assert result["efivarfs_preflight_authorized_write"] is False
assert result["esp_mounted_read_only"] is True
assert result["mount_released"] is True
assert result["default_entry_changed"] is False
assert result["efi_variable_written"] is True
assert result["reboot_requested"] is False
assert result["runtime_owner_wiring_enabled"] is False
assert result["automatic_reboot_enabled"] is False

variables = list(efivars.iterdir())
assert len(variables) == 1
variable = variables[0]
assert variable.name == "LoaderEntryOneShot-4a67b082-0a4c-41cf-b6c7-440b29bb8c4f"
payload = variable.read_bytes()
assert struct.unpack("<I", payload[:4])[0] == 0x7
assert payload[4:].decode("utf-16-le") == "ordax-candidate.conf\x00"

proof = {
    "$schema": "prototype-ordax.dev-base-activation-arm-proof/1",
    "status": "pass",
    "source_commit": source,
    "esp_image_sha256_after_arm": image_sha,
    "checks": {
        "exact_staged_sha_required": True,
        "exact_readiness_sha_required": True,
        "readiness_state_required": True,
        "candidate_manifest_revalidated": True,
        "versioned_rootfs_revalidated": True,
        "live_esp_revalidated": True,
        "live_candidate_hashes_revalidated": True,
        "efivarfs_preflight_verified_before_write": True,
        "efivarfs_preflight_remains_non_authoritative": True,
        "esp_read_only_during_arm": True,
        "esp_byte_identical_before_after_arm": True,
        "only_loader_entry_oneshot_written": True,
        "reboot_not_requested": True,
        "runtime_owner_not_wired": True,
    },
    "disposable_efivarfs_only": True,
    "real_efivarfs_touched": False,
    "physical_hardware_touched": False,
    "physical_hardware_proven": False,
}
proof_path.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print("DEV_ACTIVATION_ARM_PROOF=PASS")
PY
