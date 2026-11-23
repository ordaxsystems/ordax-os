"""Transport and on-disk state are not active OS version evidence."""
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "owner_usb_installation_evidence", HERE / "owner_dev_usb_installation_evidence.py")
APP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APP)


def physical(state):
    return {
        "status": "pass", "physical_usb_write": False,
        "read_only_mount": "ext4-ro-noload",
        "physical_boot_verified": False,
        "running_revision_verified": False,
        "on_disk_state_commit": state,
        "on_disk_git_main_commit": None,
        "on_disk_revision_consistent": False,
        "usb_serial": "6699E36B", "disk_number": 1, "partition_number": 2,
    }


class OwnerInstallationEvidenceTests(unittest.TestCase):
    def test_staged_main_does_not_update_old_disk_state(self):
        old = "c1484313055bedb136772b90864b1e7f072e0aae"
        staged = "e5aaf8a781a4949b9990946991b57e203e310f9c"
        result = APP.report(physical(old), (staged, "b" * 64, 29773574))
        self.assertEqual(result["status"], "DISK_STATE_DIFFERS_FROM_STAGED_GIT")
        self.assertEqual(result["on_disk_state_commit"], old)
        self.assertEqual(result["staged_git_source_commit"], staged)
        self.assertIsNone(result["installed_source_commit"])
        self.assertIs(result["os_activation_verified"], False)
        self.assertIs(result["physical_boot_verified"], False)

    def test_matching_disk_marker_is_still_not_boot_proof(self):
        sha = "a" * 40
        result = APP.report(physical(sha), (sha, "b" * 64, 4000))
        self.assertEqual(result["status"], "DISK_STATE_MATCHES_STAGED_GIT_BOOT_UNVERIFIED")
        self.assertFalse(result["running_revision_verified"])
        self.assertFalse(result["os_activation_verified"])
        self.assertIsNone(result["installed_source_commit"])

    def test_absent_and_unreadable_are_not_success(self):
        self.assertEqual(APP.report(physical(None), None)["status"], "GIT_TRANSPORT_ABSENT")
        self.assertEqual(APP.report(physical(None), ("a"*40, "b"*64, 4000))["status"],
                         "DISK_STATE_UNVERIFIED")

    def test_forged_boot_or_disk_read_is_rejected(self):
        for key, value in (("physical_boot_verified", True),
                           ("running_revision_verified", True),
                           ("physical_usb_write", True),
                           ("read_only_mount", "rw"),
                           ("on_disk_state_commit", "invalid")):
            doc = physical("a" * 40)
            doc[key] = value
            with self.subTest(key=key):
                with self.assertRaises(APP.InstallationEvidenceError):
                    APP.report(doc, ("a"*40, "b"*64, 4000))


if __name__ == "__main__":
    unittest.main()
