import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


CONFIG = module("media_package_config_test", "bootstrap/surface-runtime/package_config.py")
BUILDER = module("media_runtime_builder_test", "bootstrap/surface-runtime/build.py")
PROBE = module("media_runtime_probe_test", "system/surface/runtime/media_runtime_probe.py")


class MediaRuntimeTests(unittest.TestCase):
    def test_packages_have_one_owner_for_native_and_offline_builds(self):
        contract = {"packages_file": CONFIG.PACKAGES_FILE}
        packages = CONFIG.requested_packages(contract, ROOT)
        self.assertTrue({
            "dbus", "gst-plugins-good", "gst-libav", "gst-plugin-pipewire",
            "pipewire-alsa", "pipewire-pulse", "webkit2gtk-4.1", "wireplumber",
        }.issubset(packages))
        launcher = (ROOT / "system/surface/bin/ordax-surface").read_text()
        function = launcher[launcher.index("runtime_packages() {"):launcher.index("runtime_media_is_ready() {")]
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(["sh", "-ec", function + '\nSYSTEM_ROOT=$1; runtime_packages', "test", str(ROOT / "system")], capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.splitlines(), packages)

    def test_package_manifest_rejects_shell_syntax_duplicates_and_parallel_lists(self):
        contract = {"packages_file": CONFIG.PACKAGES_FILE}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / CONFIG.PACKAGES_FILE
            path.parent.mkdir(parents=True)
            launcher = (ROOT / "system/surface/bin/ordax-surface").read_text()
            function = launcher[launcher.index("runtime_packages() {"):launcher.index("runtime_media_is_ready() {")]
            for payload in ("", "gst-libav\ngst-libav\n", "gst-libav;evil\n", "gst-libav --untrusted\n", "-bad\n"):
                path.write_text(payload)
                with self.assertRaises(ValueError):
                    CONFIG.requested_packages(contract, root)
                result = subprocess.run(["sh", "-ec", function + '\nSYSTEM_ROOT=$1; runtime_packages', "test", str(root / "system")], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
            path.write_text("gst-libav\n")
            with self.assertRaises(ValueError):
                CONFIG.requested_packages({**contract, "packages": ["other"]}, root)

    def test_builder_runs_guest_visible_probe_and_always_removes_build_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def execute(actual_root, command):
                self.assertEqual(actual_root, root)
                guest_path = command.split()[1]
                self.assertFalse(guest_path.startswith("/tmp/"))
                script = root / guest_path.lstrip("/")
                self.assertEqual(script.read_bytes(), (ROOT / "system/surface/runtime/media_runtime_probe.py").read_bytes())
                raise RuntimeError("decoder failure")
            with mock.patch.object(BUILDER.CORE, "proot_rootfs", side_effect=execute):
                with self.assertRaisesRegex(RuntimeError, "decoder failure"):
                    BUILDER.probe_runtime_media(root)
            self.assertEqual(list(root.iterdir()), [])

    def test_builder_starts_pipewire_session_without_a_physical_device(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def execute(actual_root, command):
                self.assertEqual(actual_root, root)
                self.assertIn("/bin/busybox sh /ordax-audio-session.sh", command)
                self.assertIn("--runtime-dir /run/ordax-media-probe -- /usr/bin/pactl info", command)
                script = root / "ordax-audio-session.sh"
                self.assertEqual(script.read_bytes(), (ROOT / "system/surface/runtime/audio-session.sh").read_bytes())
                raise RuntimeError("audio service failure")
            with mock.patch.object(BUILDER.CORE, "proot_rootfs", side_effect=execute):
                with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "device-less startup probe"):
                    BUILDER.probe_runtime_audio_session(root)
            self.assertEqual(list(root.iterdir()), [])

    def test_probe_tests_container_decoding_and_never_opens_capture_or_speakers(self):
        with mock.patch.object(PROBE.subprocess, "run", return_value=mock.Mock(returncode=0)) as run:
            result = PROBE.probe()
        self.assertTrue(result["passed"])
        self.assertFalse(result["physicalPlaybackProven"])
        self.assertFalse(result["captureActivated"])
        self.assertTrue({"pulsesink", "pipewiresink", "pipewiresrc"}.issubset(PROBE.REQUIRED_ELEMENTS))
        self.assertEqual(len(result["checks"]), len(PROBE.REQUIRED_ELEMENTS) + 2 * len(PROBE.FIXTURES))
        for call in run.call_args_list:
            args = call.args[0]
            self.assertIn(args[0], {"gst-inspect-1.0", "gst-launch-1.0"})
            if args[0] == "gst-launch-1.0":
                self.assertTrue("filesink" in args or "fakesink" in args)
                self.assertFalse({"alsasrc", "pulsesrc", "v4l2src", "autoaudiosink", "alsasink"}.intersection(args))
            self.assertEqual(call.kwargs["timeout"], 20)
            self.assertNotIn("shell", call.kwargs)

    def test_probe_reports_missing_tools_failed_decoders_and_timeouts(self):
        for failure in (OSError("missing"), subprocess.TimeoutExpired("gst-launch-1.0", 20)):
            with mock.patch.object(PROBE.subprocess, "run", side_effect=failure):
                self.assertFalse(PROBE.probe()["passed"])
        with mock.patch.object(PROBE.subprocess, "run", return_value=mock.Mock(returncode=1)):
            self.assertFalse(PROBE.probe()["passed"])
