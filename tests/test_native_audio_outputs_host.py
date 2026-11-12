from __future__ import annotations

from functools import partial
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))


class FakeAudioProvider:
    def __init__(self) -> None:
        self.snapshot = {
            "schema": "ordax.audio-outputs/1",
            "available": True,
            "reason": None,
            "defaultOutputId": "alsa_output.default",
            "outputs": [
                {"id": "alsa_output.default", "name": "Built-in speakers", "muted": False, "volumePercent": 62},
                {"id": "alsa_output.headset", "name": "USB headset", "muted": True, "volumePercent": 30},
            ],
        }
        self.actions: list[tuple] = []

    def read(self):
        return self.snapshot

    def set_default_output(self, output_id: str):
        self.actions.append(("route", output_id))
        self.snapshot["defaultOutputId"] = output_id
        return self.snapshot

    def set_volume(self, output_id: str, volume_percent: int):
        self.actions.append(("volume", output_id, volume_percent))
        for output in self.snapshot["outputs"]:
            if output["id"] == output_id:
                output["volumePercent"] = volume_percent
        return self.snapshot

    def set_muted(self, output_id: str, muted: bool):
        self.actions.append(("mute", output_id, muted))
        for output in self.snapshot["outputs"]:
            if output["id"] == output_id:
                output["muted"] = muted
        return self.snapshot


@unittest.skipUnless(os.name == "posix", "Native host endpoint requires POSIX runtime modules")
class NativeAudioOutputsHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        import native_host_server as native_host
        cls.host = native_host

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        user_root = self.root / "user"
        user_root.mkdir()
        session_dir = self.root / "run"
        session_dir.mkdir()
        self.provider = FakeAudioProvider()
        self.server = self.host.NativeHostServer(
            ("127.0.0.1", 0),
            partial(self.host.NativeHostHandler, directory=str(self.root)),
            user_root=str(user_root),
            power_request_path=str(self.root / "power-request"),
            network_session_dir=str(session_dir),
            audio_outputs_provider=self.provider,
        )
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            kwargs={"poll_interval": 0.01},
            daemon=True,
        )
        self.thread.start()
        host_name, port = self.server.server_address[:2]
        self.origin = f"http://{host_name}:{port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()
        self.temp.cleanup()

    def request(self, method: str, path: str, *, token: str | None = None, body=None):
        headers = {}
        if token is not None:
            headers[self.host.AUDIO_OUTPUTS_TOKEN_HEADER] = token
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(f"{self.origin}{path}", data=data, headers=headers, method=method)
        with urlopen(request, timeout=2) as response:
            payload = response.read()
            return response.status, json.loads(payload) if payload else None

    def test_session_token_protects_audio_status_and_output_actions(self) -> None:
        _, session = self.request("GET", "/__ordax/native/session")
        token = session["audioOutputsToken"]
        with self.assertRaises(HTTPError) as unauthorized:
            self.request("GET", "/__ordax/native/audio-outputs")
        self.assertEqual(unauthorized.exception.code, 403)

        status, snapshot = self.request(
            "GET", "/__ordax/native/audio-outputs", token=token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(snapshot["defaultOutputId"], "alsa_output.default")

        _, routed = self.request(
            "POST",
            "/__ordax/native/audio-outputs",
            token=token,
            body={"action": "set-default-output", "outputId": "alsa_output.headset"},
        )
        self.assertEqual(routed["defaultOutputId"], "alsa_output.headset")
        _, adjusted = self.request(
            "POST",
            "/__ordax/native/audio-outputs",
            token=token,
            body={"action": "set-volume", "outputId": "alsa_output.headset", "volumePercent": 41},
        )
        self.assertEqual(adjusted["outputs"][1]["volumePercent"], 41)
        _, muted = self.request(
            "POST",
            "/__ordax/native/audio-outputs",
            token=token,
            body={"action": "set-muted", "outputId": "alsa_output.headset", "muted": False},
        )
        self.assertFalse(muted["outputs"][1]["muted"])
        self.assertEqual(self.provider.actions, [
            ("route", "alsa_output.headset"),
            ("volume", "alsa_output.headset", 41),
            ("mute", "alsa_output.headset", False),
        ])

    def test_query_and_unbounded_volume_requests_are_rejected(self) -> None:
        _, session = self.request("GET", "/__ordax/native/session")
        token = session["audioOutputsToken"]
        with self.assertRaises(HTTPError) as query:
            self.request("GET", "/__ordax/native/audio-outputs?unexpected=1", token=token)
        self.assertEqual(query.exception.code, 400)
        with self.assertRaises(HTTPError) as volume:
            self.request(
                "POST", "/__ordax/native/audio-outputs", token=token,
                body={"action": "set-volume", "outputId": "alsa_output.default", "volumePercent": 101},
            )
        self.assertEqual(volume.exception.code, 400)
        self.assertEqual(self.provider.actions, [])

    def test_unknown_action_fields_fail_closed(self) -> None:
        _, session = self.request("GET", "/__ordax/native/session")
        with self.assertRaises(HTTPError) as unknown:
            self.request(
                "POST", "/__ordax/native/audio-outputs", token=session["audioOutputsToken"],
                body={"action": "set-volume", "outputId": "alsa_output.default", "volumePercent": 20, "persist": True},
            )
        self.assertEqual(unknown.exception.code, 400)
        self.assertEqual(self.provider.actions, [])


if __name__ == "__main__":
    unittest.main()
