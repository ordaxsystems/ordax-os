"""Targeted non-destructive tests for Owner USB Git transfer."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("owner_usb_git_delivery", HERE / "owner_usb_git_delivery.py")
APP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APP)


def git(repo, *args):
    proc = subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True, check=True, timeout=30)
    return proc.stdout.strip()


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        git(self.source, "init", "-b", "main")
        git(self.source, "config", "user.name", "Test")
        git(self.source, "config", "user.email", "test@example.invalid")
        (self.source / "sample.txt").write_text("a\n")
        git(self.source, "add", "sample.txt")
        git(self.source, "commit", "-m", "base")
        self.sha = git(self.source, "rev-parse", "HEAD")
        self.delivery = self.root / "data" / APP.SUBDIR
        self.bundle = self.root / APP.BUNDLE

    def make_bundle(self):
        return APP.build_bundle(self.source, self.bundle, self.sha)

    def test_remote_main_advancing_during_bundle_blocks_stale_usb_write(self):
        import argparse
        import contextlib
        import io
        args = argparse.Namespace(
            repo=self.source, volume="E", auto_volume=False,
            trusted_serial="6699E36B", trusted_disk_number=1,
            inspect=False, apply=True,
        )
        identity = {"serial": "6699E36B", "disk": 1}
        with (
            mock.patch.object(APP, "checked_volume", return_value=identity),
            mock.patch.object(APP, "ensure_real_ancestors"),
            mock.patch.object(APP, "existing_current", return_value=False),
            mock.patch.object(APP, "source_commit",
                              side_effect=[self.sha, "f" * 40]) as source,
            mock.patch.object(APP, "build_bundle", return_value=("a" * 64, 123)),
            mock.patch.object(APP, "install_bundle") as install,
            contextlib.redirect_stderr(io.StringIO()) as error,
        ):
            self.assertEqual(APP.deliver(args), 2)
        install.assert_not_called()
        self.assertEqual(source.call_count, 2)
        self.assertIn("main advanced", error.getvalue())

    def test_remote_main_advancing_after_readback_never_reports_current(self):
        import argparse
        import contextlib
        import io
        args = argparse.Namespace(
            repo=self.source, volume="E", auto_volume=False,
            trusted_serial="6699E36B", trusted_disk_number=1,
            inspect=False, apply=True,
        )
        identity = {"serial": "6699E36B", "disk": 1}
        with (
            mock.patch.object(APP, "checked_volume", return_value=identity),
            mock.patch.object(APP, "ensure_real_ancestors"),
            mock.patch.object(APP, "existing_current", return_value=False),
            mock.patch.object(APP, "source_commit",
                              side_effect=[self.sha, self.sha, "f" * 40]),
            mock.patch.object(APP, "build_bundle", return_value=("a" * 64, 123)),
            mock.patch.object(APP, "install_bundle") as install,
            contextlib.redirect_stderr(io.StringIO()) as error,
            contextlib.redirect_stdout(io.StringIO()) as output,
        ):
            self.assertEqual(APP.deliver(args), 2)
        install.assert_called_once()
        self.assertNotIn("STAGED_NOT_ACTIVATED", output.getvalue())
        self.assertIn("not latest", error.getvalue())

    def test_bundles_only_exact_main_with_matching_sha(self):
        digest, size = self.make_bundle()
        self.assertGreater(size, 0)
        self.assertEqual(digest, APP.sha256_file(self.bundle))
        self.assertEqual(git(self.source, "bundle", "list-heads", self.bundle),
                         self.sha + " refs/heads/main")

    def test_atomic_install_stages_without_changing_git_checkout(self):
        digest, size = self.make_bundle()
        APP.install_bundle(self.delivery, self.bundle, self.sha, digest, size)
        self.assertTrue(APP.existing_current(self.delivery, self.sha))
        self.assertEqual(git(self.source, "rev-parse", "HEAD"), self.sha)
        self.assertFalse((self.delivery / (APP.MANIFEST + ".pending")).exists())
        self.assertFalse((self.delivery / (APP.BUNDLE + ".pending")).exists())

    def test_update_request_only_arms_after_verified_bundle(self):
        digest, size = self.make_bundle()
        with self.assertRaisesRegex(APP.DeliveryError, "verified Git bundle"):
            APP.arm_update_request(self.delivery, self.sha, digest, size)
        self.assertFalse((self.delivery / APP.UPDATE_REQUEST).exists())
        APP.install_bundle(self.delivery, self.bundle, self.sha, digest, size)
        APP.arm_update_request(self.delivery, self.sha, digest, size)
        expected = APP.update_request_bytes(self.sha)
        self.assertEqual((self.delivery / APP.UPDATE_REQUEST).read_bytes(), expected)
        APP.arm_update_request(self.delivery, self.sha, digest, size)
        self.assertEqual((self.delivery / APP.UPDATE_REQUEST).read_bytes(), expected)
        self.assertFalse((self.delivery / (APP.UPDATE_REQUEST + ".pending")).exists())
        self.assertTrue(APP.existing_current(self.delivery, self.sha))

    def test_update_request_rejects_wrong_sha_and_symlink(self):
        digest, size = self.make_bundle()
        APP.install_bundle(self.delivery, self.bundle, self.sha, digest, size)
        with self.assertRaisesRegex(APP.DeliveryError, "verified Git bundle"):
            APP.arm_update_request(self.delivery, "f" * 40, digest, size)
        with self.assertRaisesRegex(APP.DeliveryError, "SHA is invalid"):
            APP.update_request_bytes("invalid")
        pending = self.delivery / (APP.UPDATE_REQUEST + ".pending")
        try:
            pending.symlink_to(self.root / "victim")
        except OSError:
            self.skipTest("Windows symlink creation not permitted")
        with self.assertRaisesRegex(APP.DeliveryError, "linked"):
            APP.arm_update_request(self.delivery, self.sha, digest, size)

    def test_read_only_inspection_verifies_local_bundle_without_activation(self):
        self.assertIsNone(APP.verified_local_bundle(self.delivery))
        digest, size = self.make_bundle()
        APP.install_bundle(self.delivery, self.bundle, self.sha, digest, size)
        self.assertEqual(APP.verified_local_bundle(self.delivery),
                         (self.sha, digest, size))
        self.assertEqual(git(self.source, "rev-parse", "HEAD"), self.sha)

    def test_read_only_inspection_rejects_forged_manifest_head(self):
        digest, size = self.make_bundle()
        APP.install_bundle(self.delivery, self.bundle, self.sha, digest, size)
        wrong_commit = "f" * 40
        (self.delivery / APP.MANIFEST).write_bytes(
            APP.manifest_bytes(wrong_commit, digest, size))
        with self.assertRaisesRegex(APP.DeliveryError, "head disagrees"):
            APP.verified_local_bundle(self.delivery)

    def test_read_only_inspection_rejects_local_tampering_and_partial_transport(self):
        digest, size = self.make_bundle()
        APP.install_bundle(self.delivery, self.bundle, self.sha, digest, size)
        (self.delivery / APP.BUNDLE).write_bytes(b"tampered")
        with self.assertRaisesRegex(APP.DeliveryError, "integrity"):
            APP.verified_local_bundle(self.delivery)
        (self.delivery / APP.BUNDLE).unlink()
        with self.assertRaisesRegex(APP.DeliveryError, "incomplete"):
            APP.verified_local_bundle(self.delivery)

    def test_inspection_does_not_access_remote_main_or_write_usb(self):
        import argparse
        import contextlib
        import io
        args = argparse.Namespace(repo=None, volume="E", auto_volume=False,
                                  trusted_serial="6699E36B", trusted_disk_number=1,
                                  inspect=True, apply=False)
        sample = (self.sha, "a" * 64, 789)
        with (
            mock.patch.object(APP, "checked_volume", return_value={
                "serial": "6699E36B", "disk": 1}) as checked,
            mock.patch.object(APP, "ensure_real_ancestors"),
            mock.patch.object(APP, "verified_local_bundle", return_value=sample),
            mock.patch.object(APP, "source_commit") as git_lookup,
            mock.patch.object(APP, "install_bundle") as writer,
            contextlib.redirect_stdout(io.StringIO()) as output,
        ):
            self.assertEqual(APP.deliver(args), 0)
        self.assertIn("GIT_BUNDLE_LOCAL_VERIFIED", output.getvalue())
        self.assertIn(self.sha, output.getvalue())
        self.assertEqual(checked.call_count, 2)
        git_lookup.assert_not_called()
        writer.assert_not_called()

    def test_rejects_tampering_with_existing_bundle(self):
        digest, size = self.make_bundle()
        APP.install_bundle(self.delivery, self.bundle, self.sha, digest, size)
        with (self.delivery / APP.BUNDLE).open("ab") as handle:
            handle.write(b"bad")
        self.assertFalse(APP.existing_current(self.delivery, self.sha))

    def test_rejects_mismatched_digest_without_publishing_manifest(self):
        digest, size = self.make_bundle()
        with self.assertRaisesRegex(APP.DeliveryError, "readback"):
            APP.install_bundle(self.delivery, self.bundle, self.sha, "0" * 64, size)
        self.assertFalse((self.delivery / APP.MANIFEST).exists())

    def test_rejects_invalid_manifest_values(self):
        for value in ("INVALID", "F" * 40):
            with self.assertRaises(APP.DeliveryError):
                APP.manifest_bytes(value, "a" * 64, 1)
        with self.assertRaises(APP.DeliveryError):
            APP.manifest_bytes(self.sha, "a" * 64, APP.MAX_BUNDLE + 1)

    def test_rejects_uncanonical_local_origin(self):
        git(self.source, "remote", "add", "origin", "https://evil.invalid/repo.git")
        with self.assertRaisesRegex(APP.DeliveryError, "canonical"):
            APP.source_commit(self.source)

    def test_safe_volume_gate_does_not_accept_wrong_letters(self):
        for bad in ("E:", "C\\", "EE", "1"):
            with self.assertRaises(APP.DeliveryError):
                APP.checked_volume(bad)

    def test_unsafe_pending_link_is_rejected(self):
        digest, size = self.make_bundle()
        self.delivery.mkdir(parents=True)
        link = self.delivery / (APP.BUNDLE + ".pending")
        try:
            link.symlink_to(self.root / "victim")
        except OSError:
            self.skipTest("Windows symlink creation not permitted")
        with self.assertRaisesRegex(APP.DeliveryError, "unsafe USB pending path"):
            APP.install_bundle(self.delivery, self.bundle, self.sha, digest, size)

    def test_auto_discovery_stages_only_local_serial_match(self):
        with (
            mock.patch.object(APP, "available_ordax_data_letters", return_value=["E", "F"]),
            mock.patch.object(APP, "checked_volume",
                              side_effect=[{"serial": "UNTRUSTED"}, {"serial": "6699E36B"}]) as checked,
        ):
            self.assertEqual(APP.discover_trusted_volume("6699e36b"), "F")
        self.assertEqual(checked.call_count, 2)

    def test_auto_discovery_with_no_trusted_usb_is_read_only(self):
        with mock.patch.object(APP, "available_ordax_data_letters", return_value=[]):
            self.assertIsNone(APP.discover_trusted_volume("6699E36B"))
        with self.assertRaisesRegex(APP.DeliveryError, "malformed"):
            APP.discover_trusted_volume("bad serial; injection")

    def test_auto_discovery_rejects_ambiguous_authorized_serial(self):
        with (
            mock.patch.object(APP, "available_ordax_data_letters", return_value=["E", "F"]),
            mock.patch.object(APP, "checked_volume",
                              side_effect=[{"serial": "6699E36B"}, {"serial": "6699E36B"}]),
        ):
            with self.assertRaisesRegex(APP.DeliveryError, "multiple volumes"):
                APP.discover_trusted_volume("6699E36B")

    def test_selected_creator_disk_number_is_an_independent_gate(self):
        APP.enforce_selected_disk({"disk": 1}, 1)
        APP.enforce_selected_disk({"disk": 1}, None)  # Scheduled task: serial only
        for bad in (0, -1, 2, True):
            with self.assertRaisesRegex(APP.DeliveryError, "disk number"):
                APP.enforce_selected_disk({"disk": 1}, bad)
        with self.assertRaisesRegex(APP.DeliveryError, "disk number"):
            APP.enforce_selected_disk({"disk": "1"}, 1)

class BaseMediaBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.volume = root / "data"
        self.volume.mkdir()
        self.sha = "b" * 40
        self.candidate = root / self.sha
        self.candidate.mkdir()
        for name in APP.BASE_FILES:
            (self.candidate / name).write_bytes(b"test:" + name.encode())
        self.script = root / "dev_channel.py"
        self.script.write_text("# exact OS-owned helper test", encoding="utf-8")
        self.before = {"disk": 1, "serial": "6699E36B"}
        self.args = __import__("argparse").Namespace(
            apply=True, inspect=False, repo=None,
            base_candidate_dir=self.candidate,
            canonical_base_script=self.script, base_artifact_commit=self.sha,
        )

    def test_base_copy_invokes_os_import_only_and_checks_exact_device_twice(self):
        receipt = json.dumps({
            "status": "imported-not-activated", "source_commit": self.sha,
            "path": str(self.volume / APP.BASE_SUBDIR / self.sha), "reused": False,
        }).encode()
        with (
            mock.patch.object(APP, "checked_volume", return_value=self.before) as identity,
            mock.patch.object(APP.subprocess, "run",
                              return_value=subprocess.CompletedProcess([], 0, stdout=receipt)) as run,
        ):
            result = APP.stage_canonical_base(self.args, self.volume, "E", self.before)
        self.assertEqual(result["status"], "BASE_STAGED_NOT_ACTIVATED")
        self.assertEqual(identity.call_count, 2)
        command = run.call_args.args[0]
        self.assertEqual(command[1], "-I")
        self.assertIn("--import-only", command)
        self.assertNotIn("--resolve-only", command)
        self.assertNotIn("--ready-pair", command)
        self.assertEqual(command[command.index("--destination-root")+1],
                         str(self.volume / APP.BASE_SUBDIR))
        self.assertEqual(command[command.index("--source-commit")+1], self.sha)

    def test_base_copy_fails_closed_on_device_or_receipt_mismatch(self):
        with (
            mock.patch.object(APP, "checked_volume", return_value={"disk": 2}) as _identity,
            mock.patch.object(APP.subprocess, "run") as run,
        ):
            with self.assertRaisesRegex(APP.DeliveryError, "identity changed"):
                APP.stage_canonical_base(self.args, self.volume, "E", self.before)
            run.assert_not_called()
        untrusted = json.dumps({
            "status": "imported-not-activated", "source_commit": "f" * 40,
            "path": str(self.volume / APP.BASE_SUBDIR / self.sha), "reused": False,
        }).encode()
        with (
            mock.patch.object(APP, "checked_volume", return_value=self.before),
            mock.patch.object(APP.subprocess, "run",
                              return_value=subprocess.CompletedProcess([], 0, stdout=untrusted)),
        ):
            with self.assertRaisesRegex(APP.DeliveryError, "did not attest"):
                APP.stage_canonical_base(self.args, self.volume, "E", self.before)


class WindowsBoundedGitTests(unittest.TestCase):
    @unittest.skipUnless(__import__("os").name == "nt", "native Windows Job Object")
    def test_git_timeout_does_not_leave_pack_child_running(self):
        import ctypes
        import os
        import sys
        with tempfile.TemporaryDirectory() as temporary:
            pid_file = Path(temporary) / "descendant.pid"
            child = "import time; time.sleep(60)"
            parent = (
                "import subprocess,sys,time; "
                "p=subprocess.Popen([sys.executable,'-c',"
                + repr(child)
                + "]); open("
                + repr(str(pid_file))
                + ",'w').write(str(p.pid)); time.sleep(60)"
            )
            with self.assertRaises(subprocess.TimeoutExpired):
                APP._windows_git_job([sys.executable, "-c", parent], timeout=1)
            self.assertTrue(pid_file.is_file(), "test descendant never started")
            pid = int(pid_file.read_text(encoding="utf-8"))
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.OpenProcess.argtypes = (
                ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32,
            )
            kernel.OpenProcess.restype = ctypes.c_void_p
            kernel.WaitForSingleObject.argtypes = (ctypes.c_void_p, ctypes.c_uint32)
            kernel.WaitForSingleObject.restype = ctypes.c_uint32
            kernel.CloseHandle.argtypes = (ctypes.c_void_p,)
            handle = kernel.OpenProcess(0x00100000, 0, pid)  # SYNCHRONIZE
            if handle:
                try:
                    self.assertEqual(
                        kernel.WaitForSingleObject(handle, 2500), 0,
                        "Git timeout orphaned a child process",
                    )
                finally:
                    kernel.CloseHandle(handle)


class ExclusiveTransportTests(unittest.TestCase):
    def test_one_transport_lock_rejects_concurrent_windows_writers(self):
        import os
        if os.name != "nt":
            self.skipTest("Windows mandatory byte-range lock")
        with tempfile.TemporaryDirectory() as temporary:
            with mock.patch.object(Path, "home", return_value=Path(temporary)):
                with APP.exclusive_transport():
                    with self.assertRaisesRegex(APP.DeliveryError, "already running"):
                        with APP.exclusive_transport():
                            pass
                with APP.exclusive_transport():
                    pass  # Kernel lock released after completion.


if __name__ == "__main__":
    unittest.main()
