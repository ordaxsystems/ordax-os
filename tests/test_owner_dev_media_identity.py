import json
import os
import subprocess
import tempfile
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INIT = (ROOT / "bootstrap/initramfs/root/init").read_text(encoding="utf-8")
SOURCE = json.loads((ROOT / "bootstrap/initramfs/source.json").read_text(encoding="utf-8"))
PROFILES = json.loads((ROOT / "docs/contracts/distribution-profiles.json").read_text(encoding="utf-8"))
WORKFLOW = (ROOT / ".github/workflows/creator-owner-dev-git.yml").read_text(encoding="utf-8")
NORMAL_ENTRY = (ROOT / "boot/esp/loader/entries/ordax.conf").read_text(encoding="utf-8")
RECOVERY_ENTRY = (ROOT / "boot/esp/loader/entries/ordax-recovery.conf").read_text(encoding="utf-8")


class OwnerDevelopmentMediaIdentityTests(unittest.TestCase):
    def test_contract_requires_one_complete_removable_owner_media(self):
        discovery = SOURCE["owner_development_media_discovery"]
        self.assertEqual(
            discovery["profile_contract"],
            "docs/contracts/distribution-profiles.json#profiles.owner-development",
        )
        self.assertEqual(
            discovery["cmdline_token"],
            "ordax.distribution_profile=owner-development",
        )
        self.assertEqual(
            discovery["root_partition"],
            {"partition_index": 2, "filesystem": "ext4", "filesystem_label": "ORDAX"},
        )
        self.assertEqual(
            discovery["esp_partition"],
            {"partition_index": 1, "filesystem": "vfat", "filesystem_label": "ORDAX-ESP"},
        )
        self.assertTrue(discovery["same_parent_block_device_required"])
        self.assertTrue(discovery["parent_removable_required"])
        self.assertTrue(discovery["exactly_one_complete_media_required"])
        self.assertEqual(discovery["discovery_retry_seconds"], 10)
        self.assertFalse(discovery["internal_disk_candidate_allowed"])
        self.assertFalse(discovery["writable_mount_before_identity_proof"])
        self.assertFalse(discovery["stable_mvp_path_changed"])

    def test_owner_pid1_proves_media_identity_before_rw_mount(self):
        self.assertIn('ordax.distribution_profile=owner-development', INIT)
        self.assertIn('discover_owner_development_device() {', INIT)
        self.assertIn('cat "$sys/partition"', INIT)
        self.assertIn('cat "$sys/../removable"', INIT)
        self.assertIn("2) ;;", INIT)
        self.assertIn("1) ;;", INIT)
        self.assertIn("*'LABEL=\"ORDAX\"'*", INIT)
        self.assertIn("*'LABEL=\"ORDAX-ESP\"'*", INIT)
        self.assertNotIn("*'TYPE=\"ext4\"'*", INIT)
        self.assertNotIn("*'TYPE=\"vfat\"'*", INIT)
        self.assertIn('probe_read_only_filesystem() {', INIT)
        self.assertIn('ext4) options=ro,noload,nosuid,nodev,noexec ;;', INIT)
        self.assertIn('vfat) options=ro,nosuid,nodev,noexec ;;', INIT)
        self.assertIn('mount -t "$filesystem" -o "$options" "$device" "$target"', INIT)
        self.assertIn('umount "$target"', INIT)
        self.assertIn(
            'probe_read_only_filesystem "/dev/$name" ext4 "$OWNER_ROOT_PROBE"',
            INIT,
        )
        self.assertIn(
            'probe_read_only_filesystem "/dev/$esp_name" vfat "$OWNER_ESP_PROBE"',
            INIT,
        )
        self.assertIn('parent_dev="$(cat "$sys/../dev"', INIT)
        self.assertIn('cat "$esp_sys/../dev"', INIT)
        self.assertIn('case "$ORDAX_DEVICE_MATCHES" in', INIT)
        self.assertIn('0) ORDAX_DEVICE_MATCHES=1 ;;', INIT)
        self.assertIn('*) ORDAX_DEVICE_MATCHES=many ;;', INIT)
        self.assertIn('for attempt in 1 2 3 4 5 6 7 8 9 10; do', INIT)
        self.assertIn('10) rescue "owner-development USB root not found', INIT)
        self.assertIn('multiple owner-development USB roots detected', INIT)

        root_label = INIT.index("*'LABEL=\"ORDAX\"'*")
        root_probe = INIT.index(
            'probe_read_only_filesystem "/dev/$name" ext4 "$OWNER_ROOT_PROBE"'
        )
        esp_label = INIT.index("*'LABEL=\"ORDAX-ESP\"'*")
        esp_probe = INIT.index(
            'probe_read_only_filesystem "/dev/$esp_name" vfat "$OWNER_ESP_PROBE"'
        )
        owner_gate = INIT.index('case "$OWNER_DEVELOPMENT" in')
        rw_mount = INIT.index('mount -t ext4 -o rw,errors=remount-ro "$ORDAX_DEVICE" /ordax')
        self.assertLess(root_label, root_probe)
        self.assertLess(esp_label, esp_probe)
        self.assertLess(owner_gate, rw_mount)
        self.assertLess(root_probe, rw_mount)
        self.assertLess(esp_probe, rw_mount)

    def test_owner_pid1_avoids_optional_ash_arithmetic(self):
        self.assertNotIn("$((", INIT)
        self.assertIn('case "$esp_matches" in', INIT)
        self.assertIn('0) esp_matches=1 ;;', INIT)
        self.assertIn('*) esp_matches=many ;;', INIT)

    def test_non_owner_boot_keeps_legacy_discovery_path(self):
        self.assertIn('ORDAX_DEVICE="$(findfs LABEL=ORDAX 2>/dev/null || true)"', INIT)
        self.assertIn('*)\n        ORDAX_DEVICE="$(findfs LABEL=ORDAX', INIT)

    def test_canonical_boot_entries_remain_profile_neutral(self):
        token = "ordax.distribution_profile=owner-development"
        self.assertNotIn(token, NORMAL_ENTRY)
        self.assertNotIn(token, RECOVERY_ENTRY)
        self.assertIn("ordax.mode=normal", NORMAL_ENTRY)
        self.assertIn("ordax.mode=recovery", RECOVERY_ENTRY)

    def test_owner_creator_derives_profile_specific_boot_entries(self):
        # The standalone manifest builder is the single authority used by
        # local development and CI, not inline workflow Python.
        builder = (ROOT / "tools/creator/owner_dev_manifest.py").read_text(encoding="utf-8")
        self.assertIn("python3 tools/creator/owner_dev_manifest.py", WORKFLOW)
        for marker in (
            "'docs/contracts/distribution-profiles.json'",
            "owner_profile_id = 'owner-development'",
            "owner_profile = profiles['profiles'].get(owner_profile_id)",
            "owner_profile_token = f'ordax.distribution_profile={owner_profile_id}'",
            "owner_entry_specs",
            "out/owner-prototype/boot-entries",
            "/loader/entries/ordax.conf",
            "/loader/entries/ordax-recovery.conf",
            "artifact['source_path'] = owner_path.as_posix()",
            "artifact['sha256'] = digest(owner_path)",
            "'distribution_profile': owner_profile_id",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, builder)

    def test_distribution_profile_points_to_the_owner_creator(self):
        owner = PROFILES["profiles"]["owner-development"]
        stable = PROFILES["profiles"]["stable-mvp"]
        self.assertEqual(
            owner["creator_workflow"],
            ".github/workflows/creator-owner-dev-git.yml",
        )
        self.assertFalse(stable["internal_disk_destructive_write_allowed"])
        self.assertEqual(stable["normal_update_transport"], "official-signed-release-channel")

    def test_corrupt_owner_ext4_is_identified_without_writable_mount(self):
        """Exercise real PID1 discovery against disposable sysfs fixtures."""
        function = INIT.split("discover_owner_development_device() {\n", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('ORDAX_ROOT_PROBE_FAILED=0', function)
        self.assertIn('root_probe_ok=0', function)
        self.assertIn('ORDAX_DEVICE="/dev/$name"', function)
        self.assertIn('ORDAX_ROOT_PROBE_FAILED=1', function)

        with tempfile.TemporaryDirectory(prefix="ordax-corrupt-usb-") as temp:
            root = Path(temp)
            block = root / "sys/block"
            cls = root / "sys/class/block"
            cls.mkdir(parents=True)
            disk = block / "sdb"
            disk.mkdir(parents=True)
            (disk / "removable").write_text("1\n", encoding="ascii")
            (disk / "dev").write_text("8:16\n", encoding="ascii")
            for index in (1, 2):
                part = disk / f"sdb{index}"
                part.mkdir()
                (part / "partition").write_text(f"{index}\n", encoding="ascii")
                (cls / part.name).symlink_to(os.path.relpath(part, cls))

            # The ext4 read-only mount fails; the sibling ESP succeeds.
            # No writable operation is available in this shell fixture.
            script = "\n".join((
                "set -eu",
                "OWNER_ROOT_PROBE=/tmp/ordax-test-root",
                "OWNER_ESP_PROBE=/tmp/ordax-test-esp",
                "blkid() { case \"$1\" in",
                " */sdb1) echo 'LABEL=\"ORDAX-ESP\"' ;;",
                " */sdb2) echo 'LABEL=\"ORDAX\"' ;;",
                " esac; }",
                "probe_read_only_filesystem() { case \"$2\" in ext4) return 1 ;; vfat) return 0 ;; esac; }",
                "discover_owner_development_device() {",
                function.replace("/sys/class/block/*", str(cls) + "/*"),
                "}",
                "discover_owner_development_device",
                "printf '%s|%s|%s\n' \"$ORDAX_DEVICE_MATCHES\" \"$ORDAX_DEVICE\" \"$ORDAX_ROOT_PROBE_FAILED\"",
            ))
            run = subprocess.run(["sh", "-c", script], text=True, capture_output=True, timeout=8)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(run.stdout.strip(), "1|/dev/sdb2|1")
            healthy = script.replace('ext4) return 1', 'ext4) return 0')
            run = subprocess.run(["sh", "-c", healthy], text=True, capture_output=True, timeout=8)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(run.stdout.strip(), "1|/dev/sdb2|0")

    def test_corrupt_owner_usb_recovery_is_before_rw_mount(self):
        reason = 'rescue "ORDAX USB identified, but ext4 read-only probe failed; offline filesystem repair required"'
        self.assertIn(reason, INIT)
        self.assertIn('case "$ORDAX_ROOT_PROBE_FAILED" in', INIT)
        self.assertLess(INIT.index(reason), INIT.index('mount -t ext4 -o rw,errors=remount-ro'))
        self.assertIn('rescue "cannot mount ORDAX ext4 read-write; offline filesystem check required"', INIT)
        self.assertIn('A previous software version cannot fix damaged ext4 metadata.', INIT)
        self.assertNotIn('e2fsck -y', INIT)


if __name__ == "__main__":
    unittest.main()
