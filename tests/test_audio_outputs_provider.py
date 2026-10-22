from __future__ import annotations

import json
import subprocess
from types import SimpleNamespace
import unittest

from system.surface.runtime import audio_outputs


class FakeRunner:
    def __init__(self) -> None:
        self.default = "alsa_output.pci-0000_00_1f.3.analog-stereo"
        self.sinks = {
            self.default: {"description": "Built-in Audio Analog Stereo", "muted": False, "volume": 68, "api": "alsa", "device_class": "sound"},
            "alsa_output.usb-Headset.analog-stereo": {"description": "USB Headset", "muted": True, "volume": 22, "api": "alsa", "device_class": "sound"},
            "auto_null": {"description": "Dummy Output", "muted": False, "volume": 100, "api": "null", "device_class": "abstract"},
        }
        self.sink_indexes = {sink_id: index for index, sink_id in enumerate(self.sinks, start=1)}
        self.streams = {"17": self.default, "18": self.default}
        self.fail_move_stream_id: str | None = None
        self.calls: list[list[str]] = []

    def __call__(self, command: list[str], **_kwargs):
        args = command[1:]
        self.calls.append(args)
        if args == ["--format=json", "list", "sinks"]:
            report = [{
                "name": sink_id,
                "index": self.sink_indexes[sink_id],
                "description": item["description"],
                "mute": item["muted"],
                "properties": {"device.api": item["api"], "device.class": item["device_class"]},
                "volume": {
                    "front-left": {"value_percent": f"{item['volume']}%"},
                    "front-right": {"value_percent": f"{item['volume']}%"},
                },
            } for sink_id, item in self.sinks.items()]
            return SimpleNamespace(stdout=json.dumps(report), returncode=0)
        if args == ["list", "short", "sink-inputs"]:
            report = "".join(
                f"{stream_id}\t{self.sink_indexes[sink_id]}\tprotocol-native.c\n"
                for stream_id, sink_id in self.streams.items()
            )
            return SimpleNamespace(stdout=report, returncode=0)
        if args == ["get-default-sink"]:
            return SimpleNamespace(stdout=self.default + "\n", returncode=0)
        if len(args) == 2 and args[0] == "set-default-sink" and args[1] in self.sinks:
            self.default = args[1]
            return SimpleNamespace(stdout="", returncode=0)
        if len(args) == 3 and args[0] == "move-sink-input" and args[1] in self.streams and args[2] in self.sinks:
            if args[1] == self.fail_move_stream_id:
                self.fail_move_stream_id = None
                raise subprocess.CalledProcessError(1, command)
            self.streams[args[1]] = args[2]
            return SimpleNamespace(stdout="", returncode=0)
        if len(args) == 3 and args[0] == "set-sink-volume" and args[1] in self.sinks:
            self.sinks[args[1]]["volume"] = int(args[2][:-1])
            return SimpleNamespace(stdout="", returncode=0)
        if len(args) == 3 and args[0] == "set-sink-mute" and args[1] in self.sinks:
            self.sinks[args[1]]["muted"] = args[2] == "1"
            return SimpleNamespace(stdout="", returncode=0)
        raise AssertionError(f"unexpected audio command: {args}")


class AudioOutputsProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = FakeRunner()
        self.provider = audio_outputs.PipeWirePulseOutputProvider(
            binary="pactl",
            runner=self.runner,
            environ={
                "PATH": "/usr/bin",
                "XDG_RUNTIME_DIR": "/run/ordax-surface/audio",
                "PULSE_SERVER": "unix:/run/ordax-surface/audio/pulse/native",
                "DBUS_SESSION_BUS_ADDRESS": "not passed to pactl",
            },
        )

    def test_reads_real_sink_names_default_mute_and_channel_volume(self) -> None:
        snapshot = self.provider.read()
        self.assertTrue(snapshot["available"])
        self.assertEqual(snapshot["defaultOutputId"], self.runner.default)
        self.assertEqual(snapshot["outputs"][0]["name"], "Built-in Audio Analog Stereo")
        self.assertEqual(snapshot["outputs"][0]["volumePercent"], 68)
        self.assertTrue(snapshot["outputs"][1]["muted"])
        self.assertEqual(len(snapshot["outputs"]), 2)
        self.assertNotIn("auto_null", {output["id"] for output in snapshot["outputs"]})

    def test_switch_volume_and_mute_are_verified_by_readback(self) -> None:
        headset = "alsa_output.usb-Headset.analog-stereo"
        routed = self.provider.set_default_output(headset)
        self.assertEqual(routed["defaultOutputId"], headset)
        adjusted = self.provider.set_volume(headset, 47)
        self.assertEqual(next(item for item in adjusted["outputs"] if item["id"] == headset)["volumePercent"], 47)
        muted = self.provider.set_muted(headset, False)
        self.assertFalse(next(item for item in muted["outputs"] if item["id"] == headset)["muted"])
        self.assertIn(["set-default-sink", headset], self.runner.calls)
        self.assertIn(["move-sink-input", "17", headset], self.runner.calls)
        self.assertIn(["move-sink-input", "18", headset], self.runner.calls)
        self.assertIn(["set-sink-volume", headset, "47%"], self.runner.calls)
        self.assertIn(["set-sink-mute", headset, "0"], self.runner.calls)

    def test_missing_service_and_missing_hardware_are_reported_without_fake_outputs(self) -> None:
        missing = audio_outputs.PipeWirePulseOutputProvider(binary=None, runner=self.runner, environ={"PATH": ""})
        self.assertEqual(missing.read()["reason"], "provider-missing")
        self.runner.sinks.clear()
        self.assertEqual(self.provider.read()["reason"], "no-output-device")

    def test_virtual_pipewire_sinks_are_not_reported_as_physical_outputs(self) -> None:
        self.runner.sinks = {"auto_null": self.runner.sinks["auto_null"]}
        self.runner.default = "auto_null"
        snapshot = self.provider.read()
        self.assertFalse(snapshot["available"])
        self.assertEqual(snapshot["reason"], "no-output-device")
        self.assertEqual(snapshot["outputs"], [])

    def test_failed_stream_migration_restores_the_previous_route(self) -> None:
        headset = "alsa_output.usb-Headset.analog-stereo"
        self.runner.fail_move_stream_id = "18"
        with self.assertRaises(audio_outputs.AudioOutputError):
            self.provider.set_default_output(headset)
        self.assertEqual(self.runner.default, "alsa_output.pci-0000_00_1f.3.analog-stereo")
        self.assertEqual(set(self.runner.streams.values()), {self.runner.default})

    def test_stream_migration_limit_is_checked_before_route_mutation(self) -> None:
        self.runner.streams = {str(index): self.runner.default for index in range(65)}
        with self.assertRaises(audio_outputs.AudioOutputError):
            self.provider.set_default_output("alsa_output.usb-Headset.analog-stereo")
        self.assertEqual(self.runner.default, "alsa_output.pci-0000_00_1f.3.analog-stereo")
        self.assertFalse(any(args[0] == "set-default-sink" for args in self.runner.calls))

    def test_actions_reject_unavailable_or_unsafe_targets_and_volume(self) -> None:
        with self.assertRaises(audio_outputs.AudioOutputError):
            self.provider.set_volume("../../etc/passwd", 20)
        with self.assertRaises(audio_outputs.AudioOutputError):
            self.provider.set_volume(self.runner.default, 101)
        with self.assertRaises(audio_outputs.AudioOutputError):
            self.provider.set_volume(self.runner.default, True)
        with self.assertRaises(audio_outputs.AudioOutputError):
            self.provider.set_default_output("alsa_output.unknown")
        self.assertFalse(any(args[0].startswith("set-") for args in self.runner.calls))

    def test_runner_environment_is_minimal_and_subprocess_is_bounded(self) -> None:
        calls = []
        def runner(command, **kwargs):
            calls.append((command, kwargs))
            return self.runner(command, **kwargs)
        provider = audio_outputs.PipeWirePulseOutputProvider(
            binary="pactl", runner=runner, environ=self.provider.environ,
        )
        provider.read()
        command, options = calls[0]
        self.assertEqual(command, ["pactl", "--format=json", "list", "sinks"])
        self.assertEqual(options["timeout"], 3.0)
        self.assertNotIn("DBUS_SESSION_BUS_ADDRESS", options["env"])
        self.assertEqual(options["env"]["PULSE_SERVER"], "unix:/run/ordax-surface/audio/pulse/native")


if __name__ == "__main__":
    unittest.main()
