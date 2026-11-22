"""Offline contract and fail-closed behavior for Owner Dev local Creator synchronization."""
from __future__ import annotations
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import urllib.error
import zipfile

MODULE_PATH = Path(__file__).with_name("owner_local_sync.py")
SPEC = importlib.util.spec_from_file_location("owner_local_sync_tests", MODULE_PATH)
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


class LocalSyncTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name) / "OrdaX-Creator-Owner-Prototype"
        self.root.mkdir()
        self.old = {
            "$schema": "prototype-ordax.creator-owner-physical/1",
            "creator_source_repository": SYNC.REPO,
            "creator_version": "0.6.4-dev",
            "source_commit": "a" * 40,
            "creator_source_commit": "b" * 40,
        }
        current = self.root / "current" / "OrdaX-Creator"
        current.mkdir(parents=True)
        (current / "provenance.json").write_text(json.dumps(self.old), encoding="utf-8")
        self.manifest = {
            "$schema": "prototype-ordax.creator-owner-bundle-update/2",
            "owner_repository": SYNC.REPO,
            "channel": "owner-prototype",
            "artifact": SYNC.BUNDLE_NAME,
            "download_url": SYNC.BASE + SYNC.BUNDLE_NAME,
            "automatic_in_app_update": False,
            "version": "0.6.5-dev",
            "source_commit": "c" * 40,
            "creator_source_commit": "d" * 40,
            "sha256": "e" * 64,
            "size": 4096,
        }

    @unittest.skipUnless(__import__("os").name == "nt", "Windows-only native process snapshot")
    def test_creator_running_check_is_native_and_never_spawns_tasklist(self):
        with mock.patch.object(SYNC.subprocess, "run",
                               side_effect=AssertionError("unattended task must not spawn tasklist")):
            result = SYNC.creator_process_active()
        self.assertIs(type(result), bool)

    def test_canonical_base_probe_is_read_only_and_uses_os_authority(self):
        import subprocess
        requested, base = "a" * 40, "b" * 40
        commands = []

        def fake_run(argv, **kw):
            commands.append((argv, kw))
            if argv[0] == "/usr/bin/git":
                self.assertEqual(argv[1:4], ["-C", str(self.root), "show"])
                self.assertTrue(argv[4].startswith("HEAD:system/services/base-update/"))
                return subprocess.CompletedProcess(argv, 0, stdout=b"# os owner fixture\n")
            self.assertEqual(argv[0], SYNC.sys.executable)
            self.assertIn("-I", argv)
            self.assertIn("--resolve-only", argv)
            self.assertNotIn("--acquire-only", argv)
            self.assertNotIn("--destination-root", argv)
            self.assertEqual(argv[argv.index("--source-commit")+1], requested)
            self.assertEqual(argv[argv.index("--compatible-worktree")+1], str(self.root))
            self.assertLessEqual(kw["timeout"], 15)
            return subprocess.CompletedProcess(
                argv, 0, stdout=json.dumps({
                    "status": "resolved",
                    "source_commit": base,
                    "requested_source_commit": requested,
                    "exact_source": False,
                }).encode(),
            )

        with mock.patch.object(SYNC.shutil, "which", side_effect=lambda n: "/usr/bin/" + n), \
             mock.patch.object(SYNC.subprocess, "run", side_effect=fake_run):
            receipt = SYNC.inspect_canonical_dev_base(self.root, requested)
        self.assertEqual(receipt, {
            "base_status": "AVAILABLE_NOT_STAGED",
            "base_artifact_commit": base,
        })
        self.assertEqual(len(commands), 4)
        self.assertEqual(len([c for c, _ in commands if c[0] == "/usr/bin/git"]), 3)

    def test_base_probe_fails_closed_without_binary_availability_or_touching_usb(self):
        import subprocess
        requested = "a" * 40
        for resolved in (
            {"status": "ready", "source_commit": requested,
             "requested_source_commit": requested, "exact_source": True},
            {"status": "resolved", "source_commit": "invalid",
             "requested_source_commit": requested, "exact_source": False},
            {"status": "resolved", "source_commit": requested,
             "requested_source_commit": requested, "exact_source": False},
            {"status": "resolved", "source_commit": requested,
             "requested_source_commit": "c" * 40, "exact_source": True},
        ):
            def fake_run(argv, **kw):
                if argv[0] == "/usr/bin/git":
                    return subprocess.CompletedProcess(argv, 0, stdout=b"safe script fixture")
                return subprocess.CompletedProcess(
                    argv, 0, stdout=json.dumps(resolved).encode(),
                )
            with mock.patch.object(SYNC.shutil, "which",
                                   side_effect=lambda n: "/usr/bin/" + n), \
                 mock.patch.object(SYNC.subprocess, "run", side_effect=fake_run):
                self.assertEqual(SYNC.inspect_canonical_dev_base(self.root, requested), {})

        with mock.patch.object(SYNC.shutil, "which", return_value=None), \
             mock.patch.object(SYNC.subprocess, "run") as run:
            self.assertEqual(SYNC.inspect_canonical_dev_base(self.root, requested), {})
            run.assert_not_called()
        self.assertEqual(SYNC.inspect_canonical_dev_base(self.root, "not-a-sha"), {})

    def test_mutable_release_tag_uses_fresh_digest_bound_cache_keys(self):
        url = SYNC.fresh_manifest_url(12345)
        self.assertEqual(url, SYNC.MANIFEST_URL + "?ordax_nocache=12345")
        expected = self.manifest["sha256"]
        self.assertEqual(SYNC.verified_bundle_url(expected),
                         SYNC.BASE + SYNC.BUNDLE_NAME + "?ordax_sha256=" + expected)
        with self.assertRaises(SYNC.SyncError):
            SYNC.verified_bundle_url("not-a-sha")

    def test_manifest_rejects_unsafe_redirect_and_digest(self):
        self.assertIs(SYNC.validate_manifest(self.manifest), self.manifest)
        # Old packages remain readable; the new digest is strictly checked
        # when supplied by the canonical independent Creator publisher.
        current = dict(self.manifest, os_media_payload_sha256="f" * 64)
        self.assertIs(SYNC.validate_manifest(current), current)
        for key, replacement in [
            ("download_url", "https://example.com/Creator.zip"),
            ("automatic_in_app_update", True),
            ("sha256", "not-a-digest"),
            ("os_media_payload_sha256", "not-a-digest"),
            ("os_media_payload_sha256", None),
            ("source_commit", "not-a-commit"),
            ("owner_repository", "ordaxsystems/ordax-os"),
        ]:
            value = dict(self.manifest, **{key: replacement})
            with self.assertRaises(SYNC.SyncError):
                SYNC.validate_manifest(value)

    @unittest.skipUnless(__import__("os").name == "nt", "Windows-only local updater")
    def test_missing_release_does_not_mutate_installed_creator(self):
        with mock.patch.object(SYNC, "request_json", side_effect=urllib.error.HTTPError(
            SYNC.MANIFEST_URL, 404, "Missing", None, None)):
            result = SYNC.sync(self.root)
        self.assertEqual(result, "DEFERRED_NO_PUBLISHED_RELEASE")
        self.assertEqual(SYNC.current_provenance(self.root), self.old)

    @unittest.skipUnless(__import__("os").name == "nt", "Windows-only local updater")
    def test_active_creator_defers_without_downloading_or_writing(self):
        with (
            mock.patch.object(SYNC, "request_json", return_value=self.manifest),
            mock.patch.object(SYNC, "source_relation", return_value=1),
            mock.patch.object(SYNC, "creator_process_active", return_value=True),
            mock.patch.object(SYNC, "download_bundle") as download,
        ):
            self.assertEqual(SYNC.sync(self.root), "DEFERRED_CREATOR_RUNNING")
            download.assert_not_called()
        self.assertEqual(SYNC.current_provenance(self.root), self.old)

    def test_zip_membership_is_exact_and_provenance_matches_two_repositories(self):
        contents = {
            "OrdaX-Creator/OrdaX-Creator.exe": b"MZ" + b"0" * 8,
            "OrdaX-Creator/provenance.json": json.dumps({
                **self.old,
                "source_commit": "c" * 40,
                "creator_source_commit": "d" * 40,
                "creator_version": "0.6.5-dev",
                "physical_write_authorized_in_binary": True,
            }).encode(),
            "OrdaX-Creator/ordax-symbol.png": b"icon",
            "OrdaX-Creator/ordax-design-theme.json": b"{}",
            "OrdaX-Creator/LEIA-ME.txt": b"docs",
        }
        archive = self.root / "fixture.zip"
        with zipfile.ZipFile(archive, "w") as z:
            for name, data in contents.items():
                z.writestr(name, data)
        stage = self.root / "stage"
        observed = []
        actual_copy = SYNC.shutil.copyfileobj
        def capture_copy(source, destination, length):
            observed.append((Path(destination.name).name, length))
            return actual_copy(source, destination, length=length)
        with mock.patch.object(SYNC.shutil, "copyfileobj", side_effect=capture_copy):
            SYNC.verify_extracted(stage, archive, self.manifest, smoke=False)
        self.assertTrue((stage / "OrdaX-Creator/OrdaX-Creator.exe").is_file())
        self.assertIn(("OrdaX-Creator.exe.part", 8 * 1024 * 1024), observed)
        self.assertFalse((stage / "OrdaX-Creator/OrdaX-Creator.exe.part").exists())
        with mock.patch.object(SYNC.shutil, "copyfileobj",
                               side_effect=OSError("interrupted archive extraction")):
            with self.assertRaisesRegex(OSError, "interrupted archive"):
                SYNC.verify_extracted(self.root / "interrupted-stage", archive, self.manifest, smoke=False)
        self.assertFalse((self.root / "interrupted-stage/OrdaX-Creator/OrdaX-Creator.exe.part").exists())
        with zipfile.ZipFile(archive, "a") as z:
            z.writestr("../evil.txt", b"unsafe")
        with self.assertRaisesRegex(SYNC.SyncError, "unexpected files"):
            SYNC.verify_extracted(self.root / "bad-stage", archive, self.manifest, smoke=False)

    def test_swap_recovery_returns_old_current_after_interruption(self):
        current = self.root / "current"
        previous = self.root / ".ordax-previous"
        current.rename(previous)
        SYNC.recover_interrupted_swap(self.root)
        self.assertEqual(SYNC.current_provenance(self.root), self.old)

    @unittest.skipUnless(__import__("os").name == "nt", "Windows-only local updater")
    def test_headless_verified_update_does_not_launch_gui_smoke(self):
        bundle = self.root / "verified.zip"
        bundle.write_bytes(b"already-verified-by-publisher")
        def staged(stage, archive, manifest, *, smoke):
            self.assertFalse(smoke, "Task Scheduler cannot perform interactive Win32 smoke")
            self.assertEqual(archive, bundle)
            target = stage / "OrdaX-Creator"
            target.mkdir()
            (target / "provenance.json").write_text(json.dumps({
                **self.old,
                "source_commit": manifest["source_commit"],
                "creator_source_commit": manifest["creator_source_commit"],
                "creator_version": manifest["version"],
            }), encoding="utf-8")
        with (
            mock.patch.object(SYNC, "request_json", return_value=self.manifest),
            mock.patch.object(SYNC, "source_relation", return_value=1),
            mock.patch.object(SYNC, "creator_process_active", return_value=False),
            mock.patch.object(SYNC, "download_bundle", return_value=bundle),
            mock.patch.object(SYNC, "verify_extracted", side_effect=staged),
        ):
            self.assertEqual(SYNC.sync(self.root), "UPDATED_VERIFIED")
        self.assertEqual(SYNC.current_provenance(self.root)["creator_version"], "0.6.5-dev")

    def test_local_git_lineage_fast_path_never_calls_remote_compare(self):
        import subprocess
        repo = self.root / "git-source"
        subprocess.run(["git", "init", "-b", "main", str(repo)], check=True,
                       capture_output=True)
        def run(*args):
            return subprocess.run(["git", "-C", str(repo), *args], check=True,
                                  capture_output=True, text=True).stdout.strip()
        run("config", "user.email", "ci@example.invalid")
        run("config", "user.name", "CI")
        run("remote", "add", "origin", "https://github.com/ordaxsystems/ordax-os.git")
        (repo / "first.txt").write_text("first", encoding="utf-8")
        run("add", "first.txt")
        run("commit", "-m", "first")
        old = run("rev-parse", "HEAD")
        (repo / "second.txt").write_text("second", encoding="utf-8")
        run("add", "second.txt")
        run("commit", "-m", "second")
        new = run("rev-parse", "HEAD")
        with (
            mock.patch.object(SYNC, "local_repo_path", return_value=repo),
            mock.patch.object(SYNC, "request_json") as remote,
        ):
            self.assertEqual(SYNC.source_relation("ordax-os", old, new), 1)
            remote.assert_not_called()
            with self.assertRaises(SYNC.SyncError):
                SYNC.source_relation("ordax-os", new, old)
            remote.assert_not_called()

    def test_noncanonical_local_source_falls_back_to_remote_authority(self):
        with (
            mock.patch.object(SYNC, "local_repo_path", return_value=self.root / "missing"),
            mock.patch.object(SYNC, "request_json", return_value={
                "status": "ahead", "ahead_by": 2, "behind_by": 0
            }) as remote,
        ):
            self.assertEqual(SYNC.source_relation("ordax-os", "a"*40, "b"*40), 1)
            remote.assert_called_once()

    def test_creator_gui_reuses_single_usb_transport_without_app_replacement(self):
        receipt = {"status": "CURRENT", "source_commit": "a" * 40}
        with (
            mock.patch.object(SYNC.sys, "argv", [
                "owner_local_sync.py", "--creator-ui-stage",
                "--stage-owner-dev-usb-serial", "6699E36B",
                "--trusted-disk-number", "1",
            ]),
            mock.patch.object(SYNC, "stage_owner_usb_dev", return_value=receipt) as stage,
            mock.patch.object(SYNC, "sync") as update_app,
            mock.patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            self.assertEqual(SYNC.main(), 0)
        stage.assert_called_once_with(
            "6699E36B", from_creator_ui=True, expected_disk_number=1,
        )
        update_app.assert_not_called()
        self.assertEqual(json.loads(stdout.getvalue()), receipt)

    def test_creator_gui_rejects_missing_disk_without_staging(self):
        with (
            mock.patch.object(SYNC.sys, "argv", [
                "owner_local_sync.py", "--creator-ui-stage",
                "--stage-owner-dev-usb-serial", "6699E36B",
            ]),
            mock.patch.object(SYNC, "stage_owner_usb_dev") as stage,
            mock.patch.object(SYNC, "sync") as update_app,
            mock.patch("sys.stderr", new_callable=io.StringIO) as stderr,
        ):
            self.assertEqual(SYNC.main(), 2)
        stage.assert_not_called()
        update_app.assert_not_called()
        self.assertIn("missing selected physical USB", stderr.getvalue())

    def test_creator_ui_retries_only_existing_writer_mutex_collision(self):
        busy = SYNC.subprocess.CompletedProcess(
            ["python"], 2, "", "OWNER_USB_GIT_DELIVERY=BLOCKED:Owner USB transport already running")
        ready = SYNC.subprocess.CompletedProcess(["python"], 0, '{"status": "CURRENT"}', "")
        with (
            mock.patch.object(SYNC.subprocess, "run", side_effect=[busy, ready]) as run,
            mock.patch.object(SYNC.time, "sleep") as sleep,
        ):
            actual = SYNC.run_owner_usb_transport(["python", "existing_writer.py"],
                                                  from_creator_ui=True)
        self.assertIs(actual, ready)
        self.assertEqual(run.call_count, 2)
        sleep.assert_called_once()

    def test_scheduled_task_defers_on_existing_writer_mutex(self):
        busy = SYNC.subprocess.CompletedProcess(
            ["python"], 2, "", "OWNER_USB_GIT_DELIVERY=BLOCKED:Owner USB transport already running")
        with (
            mock.patch.object(SYNC.subprocess, "run", return_value=busy) as run,
            mock.patch.object(SYNC.time, "sleep") as sleep,
        ):
            self.assertIsNone(SYNC.run_owner_usb_transport(["python"], from_creator_ui=False))
        run.assert_called_once()
        sleep.assert_not_called()

    def test_invalid_usb_never_retried_as_transient_mutex_collision(self):
        failed = SYNC.subprocess.CompletedProcess(
            ["python"], 2, "", "OWNER_USB_GIT_DELIVERY=BLOCKED:USB serial changed")
        with (
            mock.patch.object(SYNC.subprocess, "run", return_value=failed) as run,
            mock.patch.object(SYNC.time, "sleep") as sleep,
        ):
            self.assertIs(SYNC.run_owner_usb_transport(["python"], from_creator_ui=True), failed)
        run.assert_called_once()
        sleep.assert_not_called()

    @unittest.skipUnless(__import__("os").name == "nt", "Windows native cache lock")
    def test_git_main_stage_lock_serializes_without_removing_lockfile(self):
        with tempfile.TemporaryDirectory() as temp, mock.patch.dict(
                SYNC.os.environ, {"LOCALAPPDATA": temp}):
            with SYNC.owner_usb_stage_gate(0.0) as first:
                self.assertTrue(first)
                with SYNC.owner_usb_stage_gate(0.0) as second:
                    self.assertFalse(second)
            with SYNC.owner_usb_stage_gate(0.0) as third:
                self.assertTrue(third)
            self.assertTrue((Path(temp) / "OrdaX-Creator" / "owner-main-delivery.lock").exists())

    def test_trusted_usb_staging_defers_during_creator_physical_session(self):
        with mock.patch.object(SYNC, "creator_process_active", return_value=True):
            self.assertEqual(SYNC.stage_owner_usb_dev("6699E36B"),
                             "DEFERRED_CREATOR_RUNNING")
    def test_delivery_cache_is_independent_of_developer_checkout(self):
        import os
        import subprocess
        import owner_usb_git_delivery as delivery
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            remote = root / "remote"
            remote.mkdir()
            real_run = subprocess.run
            def git(*args):
                return real_run(["git", "-C", str(remote), *args],
                                text=True, capture_output=True, check=True).stdout.strip()
            git("init", "-b", "main")
            git("config", "user.name", "Fixture")
            git("config", "user.email", "fixture@example.invalid")
            file = remote / "bootstrap/dev-base/ordax-pull"
            file.parent.mkdir(parents=True)
            file.write_text("v1\n")
            git("add", ".")
            git("commit", "-m", "initial")
            # Rewrite only network operations in this fixture. The stored
            # remote URL and the production identity check remain canonical.
            commands = []
            def network_fixture(args, **kwargs):
                commands.append(list(args))
                args = list(args)
                if "clone" in args or "fetch" in args:
                    args[1:1] = ["-c", f"url.{remote.as_uri()}.insteadOf={delivery.REPO_URL}"]
                return real_run(args, **kwargs)
            # Existing alternates-based cache is disposable but preserved
            # until the independent replacement has been verified.
            cache = root / "local" / "OrdaX-Creator" / "owner-main-delivery"
            cache.parent.mkdir(parents=True)
            real_run(["git", "clone", "--shared", str(remote), str(cache)],
                     check=True, capture_output=True)
            real_run(["git", "-C", str(cache), "remote", "set-url", "origin",
                      delivery.REPO_URL], check=True)
            with (mock.patch.dict(os.environ, {"LOCALAPPDATA": str(root / "local")}),
                  mock.patch.object(SYNC.subprocess, "run", side_effect=network_fixture)):
                self.assertEqual(SYNC._owner_main_delivery_checkout(), cache)
                self.assertFalse((cache / ".git/objects/info/alternates").exists())
                self.assertFalse(cache.with_name(cache.name + ".retired").exists())
                self.assertEqual((cache / "bootstrap/dev-base/ordax-pull").read_text(), "v1\n")
                file.write_text("v2\n")
                git("add", ".")
                git("commit", "-m", "new source")
                self.assertEqual(SYNC._owner_main_delivery_checkout(), cache)
                self.assertEqual((cache / "bootstrap/dev-base/ordax-pull").read_text(), "v2\n")
                self.assertEqual(sum("clone" in cmd for cmd in commands), 1)

    def test_absent_trusted_usb_skips_git_and_transport(self):
        import contextlib
        import owner_usb_git_delivery as delivery
        with (
            mock.patch.object(SYNC, "creator_process_active", return_value=False),
            mock.patch.object(SYNC, "owner_usb_stage_gate",
                              return_value=contextlib.nullcontext(True)),
            mock.patch.object(delivery, "discover_trusted_volume", return_value=None),
            mock.patch.object(SYNC, "_owner_main_delivery_checkout") as fetch,
            mock.patch.object(SYNC, "run_owner_usb_transport") as transport,
        ):
            self.assertEqual(SYNC.stage_owner_usb_dev("6699E36B"),
                             "SKIP_TRUSTED_USB_NOT_PRESENT")
            with self.assertRaisesRegex(SYNC.SyncError, "disappeared before staging"):
                SYNC.stage_owner_usb_dev("6699E36B", from_creator_ui=True,
                                        expected_disk_number=1)
        fetch.assert_not_called()
        transport.assert_not_called()

    def test_ambiguous_usb_does_not_fetch_or_stage(self):
        import contextlib
        import owner_usb_git_delivery as delivery
        with (
            mock.patch.object(SYNC, "creator_process_active", return_value=False),
            mock.patch.object(SYNC, "owner_usb_stage_gate",
                              return_value=contextlib.nullcontext(True)),
            mock.patch.object(delivery, "discover_trusted_volume",
                              side_effect=delivery.DeliveryError("multiple volumes")),
            mock.patch.object(SYNC, "_owner_main_delivery_checkout") as fetch,
            mock.patch.object(SYNC, "run_owner_usb_transport") as transport,
        ):
            with self.assertRaisesRegex(SYNC.SyncError, "multiple volumes"):
                SYNC.stage_owner_usb_dev("6699E36B")
        fetch.assert_not_called()
        transport.assert_not_called()

    def test_creator_base_transfer_reuses_pinned_os_policy_and_selected_disk(self):
        import os
        import subprocess
        requested, artifact = "a" * 40, "b" * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            script = root / "dev_channel.py"
            script.write_text("fixture", encoding="utf-8")
            commands = []
            cache = root / "OrdaX-Creator" / "owner-base-delivery" / artifact

            def run(argv, **kwargs):
                commands.append(argv)
                if "--acquire-only" in argv:
                    return {
                        "status": "acquired",
                        "source_commit": artifact,
                        "requested_source_commit": requested,
                        "path": str(cache),
                        "reused": False,
                    }
                self.assertIn("--base-candidate-dir", argv)
                self.assertIn("--trusted-disk-number", argv)
                self.assertEqual(argv[argv.index("--trusted-disk-number")+1], "1")
                return {
                    "status": "BASE_STAGED_NOT_ACTIVATED",
                    "base_artifact_commit": artifact,
                    "reused": False,
                }

            with (
                mock.patch.dict(os.environ, {"LOCALAPPDATA": str(root)}),
                mock.patch.object(SYNC, "_export_canonical_base_policy",
                                  return_value=(script, "git", "awk")),
                mock.patch.object(SYNC, "_run_canonical_base_child", side_effect=run),
            ):
                self.assertEqual(
                    SYNC.stage_canonical_base_for_creator(
                        root, requested, artifact, "6699E36B", 1,
                    ),
                    {"base_status": "STAGED_NOT_ACTIVATED",
                     "base_artifact_commit": artifact},
                )
            self.assertEqual(len(commands), 2)
            self.assertIn("--compatible-worktree", commands[0])
            self.assertIn("--acquire-only", commands[0])
            self.assertIn("--import-only", ["--import-only", *commands[1]])
            self.assertIn("--canonical-base-script", commands[1])

    def test_usb_is_prepared_before_creator_release_network_check(self):
        events = []
        with (
            mock.patch.object(SYNC.sys, "argv",
                              ["owner_local_sync.py", "--stage-owner-dev-usb-serial", "6699E36B"]),
            mock.patch.object(SYNC, "stage_owner_usb_dev",
                              side_effect=lambda serial: events.append(("usb", serial)) or "CURRENT"),
            mock.patch.object(SYNC, "sync",
                              side_effect=lambda *args, **kwargs: events.append(("creator", None)) or "CURRENT"),
        ):
            self.assertEqual(SYNC.main(), 0)
        self.assertEqual(events, [("usb", "6699E36B"), ("creator", None)])


if __name__ == "__main__":
    unittest.main()
