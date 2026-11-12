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

host = None


class FakeDisplayProvider:
    def __init__(self) -> None:
        self.snapshot = {
            "schema": "ordax.display-outputs/1",
            "available": False,
            "reason": "provider-missing",
            "outputs": [],
            "preview": None,
        }

    def read(self):
        return self.snapshot

    def preview(self, output_id: str, mode_id: str):
        self.snapshot = {
            "schema": "ordax.display-outputs/1",
            "available": True,
            "reason": None,
            "outputs": [{
                "id": output_id,
                "name": "Primary display",
                "enabled": True,
                "currentModeId": mode_id,
                "modes": [{
                    "id": mode_id,
                    "width": 1920,
                    "height": 1080,
                    "refreshHz": 60,
                    "current": True,
                }],
            }],
            "preview": {
                "id": "a" * 32,
                "outputId": output_id,
                "modeId": mode_id,
                "expiresAt": 1_900_000_000_000,
            },
        }
        return self.snapshot

    def confirm(self, _preview_id: str):
        self.snapshot["preview"] = None
        return self.snapshot

    def revert(self, preview_id: str):
        return self.confirm(preview_id)


@unittest.skipUnless(os.name == "posix", "Native host endpoint requires POSIX runtime modules")
class NativeDisplayOutputsHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        global host
        import native_host_server as native_host
        host = native_host

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        user_root = self.root / "user"
        user_root.mkdir()
        session_dir = self.root / "run"
        session_dir.mkdir()
        self.provider = FakeDisplayProvider()
        self.server = host.NativeHostServer(
            ("127.0.0.1", 0),
            partial(host.NativeHostHandler, directory=str(self.root)),
            user_root=str(user_root),
            power_request_path=str(self.root / "power-request"),
            network_session_dir=str(session_dir),
            display_outputs_provider=self.provider,
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
            headers[host.DISPLAY_OUTPUTS_TOKEN_HEADER] = token
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(f"{self.origin}{path}", data=data, headers=headers, method=method)
        with urlopen(request, timeout=2) as response:
            payload = response.read()
            return response.status, json.loads(payload) if payload else None

    def test_session_scoped_token_protects_display_capability_and_actions(self) -> None:
        _, session = self.request("GET", "/__ordax/native/session")
        token = session["displayOutputsToken"]
        with self.assertRaises(HTTPError) as unauthorized:
            self.request("GET", "/__ordax/native/display-outputs")
        self.assertEqual(unauthorized.exception.code, 403)

        status, unavailable = self.request(
            "GET", "/__ordax/native/display-outputs", token=token,
        )
        self.assertEqual(status, 200)
        self.assertEqual(unavailable["reason"], "provider-missing")

        status, preview = self.request(
            "POST",
            "/__ordax/native/display-outputs",
            token=token,
            body={"action": "preview", "outputId": "DP-1", "modeId": "1920x1080@60"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(preview["preview"]["outputId"], "DP-1")
        with self.assertRaises(HTTPError) as invalid_query:
            self.request(
                "POST",
                "/__ordax/native/display-outputs?unexpected=1",
                token=token,
                body={"action": "confirm", "previewId": "a" * 32},
            )
        self.assertEqual(invalid_query.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
