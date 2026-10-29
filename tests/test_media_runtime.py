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


BUILDER_PATH = ROOT / "bootstrap/surface-runtime/build.py"
PROBE = module("media_runtime_probe_test", "system/surface/runtime/media_runtime_probe.py")


class MediaRuntimeTests(unittest.TestCase):
    def test_media_has_one_buildroot_owner_without_apk_or_proot(self):
        source=__import__("json").loads((ROOT/"bootstrap/surface-runtime/source.json").read_text())
        profile=(ROOT/"bootstrap/surface-runtime/configs/ordax_surface_defconfig").read_text()
        required={
            "BR2_PACKAGE_GSTREAMER1=y",
            "BR2_PACKAGE_GST1_PLUGINS_BASE=y",
            "BR2_PACKAGE_GST1_PLUGINS_GOOD=y",
            "BR2_PACKAGE_GST1_LIBAV=y",
            "BR2_PACKAGE_PIPEWIRE=y",
            "BR2_PACKAGE_WIREPLUMBER=y",
            "BR2_PACKAGE_PULSEAUDIO=y",
        }
        self.assertTrue(required.issubset(set(profile.splitlines())))
        self.assertIn("usr/lib/gstreamer-1.0/libgstpipewire.so",source["required_runtime_paths"])
        self.assertFalse(source["package_manager_in_runtime_allowed"])
        self.assertNotIn("apk add",BUILDER_PATH.read_text())
        launcher=(ROOT/"system/surface/bin/ordax-surface").read_text()
        self.assertNotIn("/sbin/apk",launcher)

    def test_pipewire_runtime_does_not_replace_wayland_runtime_directory(self):
        launcher = (ROOT / "system/surface/bin/ordax-surface").read_text()
        session = (ROOT / "system/surface/runtime/audio-session.sh").read_text()
        self.assertIn('export XDG_RUNTIME_DIR="$SESSION_DIR"', launcher)
        self.assertIn('XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/ordax-surface}', session)
        self.assertIn('export PIPEWIRE_RUNTIME_DIR=$audio_session_dir', session)
        self.assertNotIn('XDG_RUNTIME_DIR=$audio_session_dir', session)

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
