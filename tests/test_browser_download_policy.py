import importlib.util
from pathlib import Path
import tempfile
import unittest
import os
from types import SimpleNamespace
from unittest.mock import patch

POLICY = Path(__file__).resolve().parents[1] / "system/surface/runtime/browser_download_policy.py"
spec = importlib.util.spec_from_file_location("browser_download_policy_test", POLICY)
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

class DownloadPolicyTests(unittest.TestCase):
    def test_sanitized_names_stay_under_downloads(self):
        with tempfile.TemporaryDirectory() as root:
            for name in ("../evil.exe", "report.pdf", r"C:\Users\user\payload.zip", "dados%.txt"):
                path, filename = policy.download_destination(root, "download-0123456789abcdef", name)
                self.assertEqual(os.path.dirname(path), os.path.join(root, "Downloads"))
                self.assertTrue(filename.startswith("download-0123456789abcdef-"))
                self.assertNotIn("/", filename)
                self.assertNotIn("\\", filename)
            self.assertEqual(policy.safe_download_name("../"), "download.bin")

    def test_no_symlink_directory_and_no_collision(self):
        with tempfile.TemporaryDirectory() as root:
            outside = os.path.join(root, "outside")
            os.mkdir(outside)
            os.symlink(outside, os.path.join(root, "Downloads"))
            with self.assertRaisesRegex(ValueError, "unsafe downloads directory"):
                policy.download_destination(root, "download-0123456789abcdef", "a.txt")
        with tempfile.TemporaryDirectory() as root:
            path, _ = policy.download_destination(root, "download-0123456789abcdef", "a.txt")
            Path(path).write_bytes(b"existing")
            with self.assertRaises(FileExistsError):
                policy.download_destination(root, "download-0123456789abcdef", "a.txt")

    def test_large_regular_file_and_permissions(self):
        with tempfile.TemporaryDirectory() as root:
            path, _ = policy.download_destination(root, "download-0123456789abcdef", "a.txt")
            with open(path, "wb") as stream:
                stream.truncate(5 * (1024 ** 3) + 1)  # sparse, no 5 GiB allocation
            self.assertEqual(policy.verified_download(path), 5 * (1024 ** 3) + 1)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
    def test_capacity_depends_on_volume_not_file_size(self):
        gib = 1024 ** 3
        stats = SimpleNamespace(f_frsize=4096, f_bsize=4096,
                                f_blocks=100 * gib // 4096,
                                f_bavail=10 * gib // 4096)
        with patch.object(policy.os, "statvfs", return_value=stats):
            self.assertGreaterEqual(policy.ensure_download_space("/Downloads", 8 * gib), 8 * gib)
            self.assertGreaterEqual(policy.ensure_download_space("/Downloads"), 8 * gib)
            with self.assertRaises(policy.DownloadStorageSpaceError):
                policy.ensure_download_space("/Downloads", 12 * gib)
            for invalid in (-1, 1.5, True):
                with self.assertRaises(ValueError):
                    policy.ensure_download_space("/Downloads", invalid)

    def test_low_space_blocks_unknown_length_stream(self):
        gib = 1024 ** 3
        stats = SimpleNamespace(f_frsize=4096, f_bsize=4096,
                                f_blocks=10 * gib // 4096,
                                f_bavail=1)
        with patch.object(policy.os, "statvfs", return_value=stats):
            with self.assertRaises(policy.DownloadStorageSpaceError):
                policy.ensure_download_space("/Downloads")


    def test_reject_id_and_symlink_payload(self):
        with tempfile.TemporaryDirectory() as root:
            for value in ("../../../", "download-1", "DOWNLOAD-0123456789abcdef"):
                with self.assertRaises(ValueError):
                    policy.download_destination(root, value, "a.txt")
            path, _ = policy.download_destination(root, "download-0123456789abcdef", "a.txt")
            os.symlink("/etc/hosts", path)
            with self.assertRaisesRegex(ValueError, "invalid"):
                policy.verified_download(path)

if __name__ == "__main__":
    unittest.main()
