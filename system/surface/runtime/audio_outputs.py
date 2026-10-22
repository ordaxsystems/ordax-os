"""Session-scoped PipeWire/PulseAudio-compatible output controls."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
from typing import Any, Callable


AUDIO_OUTPUTS_SCHEMA = "ordax.audio-outputs/1"
MAX_OUTPUTS = 16
MAX_OUTPUT_JSON_BYTES = 512 * 1024
OUTPUT_ID = re.compile(r"^[A-Za-z0-9_.:@-]{1,192}$")
VOLUME_PERCENT = re.compile(r"^(\d{1,3})(?:\.\d+)?%$")
PHYSICAL_DEVICE_APIS = frozenset({"alsa", "bluez5"})


class AudioOutputError(ValueError):
    """An audio route or output control could not be safely applied."""


class PipeWirePulseOutputProvider:
    """The Pulse compatibility API is the one host authority for output routing."""

    def __init__(
        self,
        *,
        binary: str | None = None,
        runner: Callable[..., Any] = subprocess.run,
        environ: dict[str, str] | None = None,
    ):
        self.environ = dict(os.environ if environ is None else environ)
        self.binary = binary or shutil.which("pactl", path=self.environ.get("PATH"))
        self.runner = runner
        self._lock = threading.RLock()

    def _unavailable(self, reason: str) -> dict[str, Any]:
        return {
            "schema": AUDIO_OUTPUTS_SCHEMA,
            "available": False,
            "reason": reason,
            "defaultOutputId": None,
            "outputs": [],
        }

    def _run(self, args: list[str]) -> Any:
        if not self.binary:
            raise FileNotFoundError("pactl is not installed")
        env = {
            key: value for key, value in self.environ.items()
            if key in {"PATH", "XDG_RUNTIME_DIR", "PIPEWIRE_RUNTIME_DIR", "PULSE_SERVER"}
        }
        env["LC_ALL"] = "C"
        return self.runner(
            [self.binary, *args],
            check=True,
            capture_output=True,
            text=True,
            timeout=3.0,
            env=env,
        )

    @staticmethod
    def _volume_percent(volume: Any) -> int:
        if not isinstance(volume, dict) or not volume:
            raise AudioOutputError("audio sink volume report is malformed")
        values: list[int] = []
        for channel in volume.values():
            if not isinstance(channel, dict):
                raise AudioOutputError("audio sink channel report is malformed")
            match = VOLUME_PERCENT.fullmatch(str(channel.get("value_percent", "")))
            if not match:
                raise AudioOutputError("audio sink volume percentage is malformed")
            value = int(match.group(1))
            if value > 150:
                raise AudioOutputError("audio sink volume percentage exceeds the safe report limit")
            values.append(value)
        # Channels can differ by one rounded percent. The snapshot is one
        # integer because the Settings control changes all channels together.
        return min(values)

    def _read_locked(self) -> dict[str, Any]:
        if not self.binary:
            return self._unavailable("provider-missing")
        try:
            sinks_result = self._run(["--format=json", "list", "sinks"])
            encoded = sinks_result.stdout.encode("utf-8")
            if len(encoded) > MAX_OUTPUT_JSON_BYTES:
                raise AudioOutputError("audio sink report exceeds the size limit")
            raw_sinks = json.loads(sinks_result.stdout)
            if not isinstance(raw_sinks, list) or len(raw_sinks) > MAX_OUTPUTS:
                raise AudioOutputError("audio sink report is malformed")
            if not raw_sinks:
                return self._unavailable("no-output-device")
            result: list[dict[str, Any]] = []
            seen: set[str] = set()
            for sink in raw_sinks:
                if not isinstance(sink, dict):
                    raise AudioOutputError("audio sink entry is malformed")
                properties = sink.get("properties")
                if not isinstance(properties, dict):
                    continue
                if (
                    properties.get("device.class") != "sound"
                    or properties.get("device.api") not in PHYSICAL_DEVICE_APIS
                ):
                    # PipeWire can expose auto_null and other software sinks
                    # when no hardware is present. Settings controls only show
                    # outputs owned by a physical ALSA or Bluetooth device.
                    continue
                sink_id = sink.get("name")
                if not isinstance(sink_id, str) or not OUTPUT_ID.fullmatch(sink_id):
                    raise AudioOutputError("audio sink identity is invalid")
                if sink_id in seen:
                    raise AudioOutputError("audio sink identities are duplicated")
                seen.add(sink_id)
                description = sink.get("description")
                if not isinstance(description, str) or not description.strip():
                    description = sink_id
                result.append({
                    "id": sink_id,
                    "name": description[:160],
                    "muted": sink.get("mute") is True,
                    "volumePercent": self._volume_percent(sink.get("volume")),
                })
            if not result:
                return self._unavailable("no-output-device")
            default_result = self._run(["get-default-sink"])
            default_id = default_result.stdout.strip()
            if default_id not in seen:
                # A server can briefly report a stale route while devices are
                # hot-plugging. Do not expose controls until one is coherent.
                return self._unavailable("output-route-changing")
            return {
                "schema": AUDIO_OUTPUTS_SCHEMA,
                "available": True,
                "reason": None,
                "defaultOutputId": default_id,
                "outputs": result,
            }
        except FileNotFoundError:
            return self._unavailable("provider-missing")
        except (subprocess.SubprocessError, OSError):
            return self._unavailable("service-unavailable")
        except (json.JSONDecodeError, AudioOutputError, UnicodeError):
            return self._unavailable("host-unsupported")

    def read(self) -> dict[str, Any]:
        with self._lock:
            return self._read_locked()

    def _require_output_locked(self, output_id: str) -> dict[str, Any]:
        if not isinstance(output_id, str) or not OUTPUT_ID.fullmatch(output_id):
            raise AudioOutputError("audio output identity is invalid")
        snapshot = self._read_locked()
        if not snapshot["available"]:
            raise AudioOutputError("audio output capability is unavailable")
        output = next((item for item in snapshot["outputs"] if item["id"] == output_id), None)
        if output is None:
            raise AudioOutputError("audio output is not currently available")
        return output

    def set_default_output(self, output_id: str) -> dict[str, Any]:
        with self._lock:
            self._require_output_locked(output_id)
            try:
                self._run(["set-default-sink", output_id])
            except (FileNotFoundError, subprocess.SubprocessError, OSError) as exc:
                raise AudioOutputError("audio output route could not be changed") from exc
            snapshot = self._read_locked()
            if not snapshot["available"] or snapshot["defaultOutputId"] != output_id:
                raise AudioOutputError("audio server did not confirm the selected output")
            return snapshot

    def set_volume(self, output_id: str, volume_percent: int) -> dict[str, Any]:
        if isinstance(volume_percent, bool) or not isinstance(volume_percent, int) or not 0 <= volume_percent <= 100:
            raise AudioOutputError("audio output volume must be an integer from 0 to 100")
        with self._lock:
            self._require_output_locked(output_id)
            try:
                self._run(["set-sink-volume", output_id, f"{volume_percent}%"])
            except (FileNotFoundError, subprocess.SubprocessError, OSError) as exc:
                raise AudioOutputError("audio output volume could not be changed") from exc
            snapshot = self._read_locked()
            output = next((item for item in snapshot.get("outputs", []) if item["id"] == output_id), None)
            if not snapshot["available"] or output is None or output["volumePercent"] != volume_percent:
                raise AudioOutputError("audio server did not confirm the requested output volume")
            return snapshot

    def set_muted(self, output_id: str, muted: bool) -> dict[str, Any]:
        if not isinstance(muted, bool):
            raise AudioOutputError("audio output mute state must be boolean")
        with self._lock:
            self._require_output_locked(output_id)
            try:
                self._run(["set-sink-mute", output_id, "1" if muted else "0"])
            except (FileNotFoundError, subprocess.SubprocessError, OSError) as exc:
                raise AudioOutputError("audio output mute state could not be changed") from exc
            snapshot = self._read_locked()
            output = next((item for item in snapshot.get("outputs", []) if item["id"] == output_id), None)
            if not snapshot["available"] or output is None or output["muted"] is not muted:
                raise AudioOutputError("audio server did not confirm the requested mute state")
            return snapshot

    def close(self) -> None:
        return None
