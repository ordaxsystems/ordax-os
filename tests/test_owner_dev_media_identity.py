import json
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
        self.assertIn("*'TYPE=\"ext4\"'*", INIT)
        self.assertIn("*'LABEL=\"ORDAX-ESP\"'*", INIT)
        self.assertIn("*'TYPE=\"vfat\"'*", INIT)
        self.assertIn('parent_dev="$(cat "$sys/../dev"', INIT)
        self.assertIn('cat "$esp_sys/../dev"', INIT)
        self.assertIn('ORDAX_DEVICE_MATCHES=$((ORDAX_DEVICE_MATCHES + 1))', INIT)
        self.assertIn('10) rescue "owner-development USB root not found', INIT)
        self.assertIn('multiple owner-development USB roots detected', INIT)

        owner_gate = INIT.index('case "$OWNER_DEVELOPMENT" in')
        rw_mount = INIT.index('mount -t ext4 -o rw,errors=remount-ro "$ORDAX_DEVICE" /ordax')
        self.assertLess(owner_gate, rw_mount)

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
        self.assertIn("'docs/contracts/distribution-profiles.json'", WORKFLOW)
        self.assertIn("owner_profile_id = 'owner-development'", WORKFLOW)
        self.assertIn("owner_profile = profiles['profiles'].get(owner_profile_id)", WORKFLOW)
        self.assertIn("owner_profile_token = f'ordax.distribution_profile={owner_profile_id}'", WORKFLOW)
        self.assertIn("owner_entry_specs", WORKFLOW)
        self.assertIn("out/owner-prototype/boot-entries", WORKFLOW)
        self.assertIn("/loader/entries/ordax.conf", WORKFLOW)
        self.assertIn("/loader/entries/ordax-recovery.conf", WORKFLOW)
        self.assertIn("artifact['source_path'] = owner_path.as_posix()", WORKFLOW)
        self.assertIn("artifact['sha256'] = digest(owner_path)", WORKFLOW)
        self.assertIn("'distribution_profile': owner_profile_id", WORKFLOW)

    def test_distribution_profile_points_to_the_owner_creator(self):
        owner = PROFILES["profiles"]["owner-development"]
        stable = PROFILES["profiles"]["stable-mvp"]
        self.assertEqual(
            owner["creator_workflow"],
            ".github/workflows/creator-owner-dev-git.yml",
        )
        self.assertFalse(stable["internal_disk_destructive_write_allowed"])
        self.assertEqual(stable["normal_update_transport"], "official-signed-release-channel")


if __name__ == "__main__":
    unittest.main()
