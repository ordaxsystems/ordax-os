#!/usr/bin/env python3
"""HTTP integration proof for the Native verified Store catalog endpoint."""

from __future__ import annotations

from functools import partial
import importlib
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
if str(RUNTIME) not in sys.path:
    sys.path.insert(0, str(RUNTIME))

host = importlib.import_module("native_host_server")

COMMIT = "a" * 40


def ready_snapshot() -> dict:
    return {
        "schema": "ordax.verified-app-store-catalog/1",
        "state": "ready",
        "sequence": 5,
        "catalogSha256": "f" * 64,
        "source": {
            "repository": "washingtonmsdj/ordax-apps",
            "commit": COMMIT,
        },
        "trust": {
            "domain": "runtime-components",
            "keyId": "ordax-runtime-components-v1",
        },
        "entries": [
            {
                "appId": "notes",
                "title": "Notas",
                "version": "0.4.3",
                "releaseMode": "component-slot",
                "sourceCommit": COMMIT,
                "artifacts": {
                    "package": {"name": "notes.zip", "sha256": "b" * 64, "size": 123},
                    "release": {"name": "notes.release.json", "sha256": "c" * 64, "size": 124},
                    "compatibility": {
                        "name": "notes.compatibility.json",
                        "sha256": "d" * 64,
                        "size": 125,
                    },
                },
            },
        ],
        "reason": None,
        "authority": "none",
    }


class NativeStoreCatalogHostTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.user_root = self.root / "user"
        self.user_root.mkdir()
        self.session_dir = self.root / "run"
        self.session_dir.mkdir()
        self.slots = self.root / "slots"
        self.slots.mkdir()
        self.handler = partial(host.NativeHostHandler, directory=str(self.root))
        self.server = host.NativeHostServer(
            ("127.0.0.1", 0),
            self.handler,
            user_root=str(self.user_root),
            power_request_path=str(self.root / "power-request"),
            network_session_dir=str(self.session_dir),
            product_mode="usb",
            distribution_profile="owner-development",
            native_install_capability="disabled",
            component_channel_bin=str(self.root / "missing-component-channel"),
            component_trust_path=str(self.root / "missing-trust.json"),
            component_slot_root=str(self.slots),
            store_catalog_envelope_path=str(self.root / "missing-catalog-envelope.json"),
            store_catalog_watermark_path=str(self.root / "catalog-watermark.json"),
            account_gateway_origin="",
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

    def get_json(self, path: str) -> tuple[int, dict]:
        with urlopen(f"{self.origin}{path}", timeout=2) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_missing_local_envelope_is_200_unavailable_not_unsigned_fallback(self) -> None:
        status, payload = self.get_json("/__ordax/native/store-catalog")
        self.assertEqual(status, 200)
        self.assertEqual(payload["schema"], "ordax.verified-app-store-catalog/1")
        self.assertEqual(payload["state"], "unavailable")
        self.assertEqual(payload["reason"], "catalog-envelope-unavailable")
        self.assertEqual(payload["authority"], "none")
        self.assertEqual(payload["entries"], [])
        self.assertIsNone(payload["source"])
        self.assertIsNone(payload["trust"])

    def test_ready_snapshot_is_forwarded_from_single_native_owner(self) -> None:
        snapshot = ready_snapshot()
        with mock.patch.object(
            host,
            "read_native_store_catalog_snapshot",
            return_value=snapshot,
        ) as reader:
            status, payload = self.get_json("/__ordax/native/store-catalog")

        self.assertEqual(status, 200)
        self.assertEqual(payload, snapshot)
        reader.assert_called_once()
        kwargs = reader.call_args.kwargs
        self.assertEqual(
            kwargs["envelope_path"],
            Path(self.server.store_catalog_envelope_path),
        )
        self.assertEqual(
            kwargs["watermark_path"],
            Path(self.server.store_catalog_watermark_path),
        )

    def test_configured_remote_refresh_runs_before_local_verified_snapshot(self) -> None:
        self.server.store_catalog_base_origin = "https://store.example.test/catalog/"
        snapshot = ready_snapshot()
        calls = []
        with (
            mock.patch.object(
                host,
                "acquire_and_promote_store_catalog",
                side_effect=lambda **kwargs: calls.append(("refresh", kwargs)) or (snapshot, True),
            ) as refresh,
            mock.patch.object(
                host,
                "read_native_store_catalog_snapshot",
                side_effect=lambda **kwargs: calls.append(("read", kwargs)) or snapshot,
            ) as reader,
        ):
            status, payload = self.get_json("/__ordax/native/store-catalog")

        self.assertEqual(status, 200)
        self.assertEqual(payload, snapshot)
        self.assertEqual([kind for kind, _kwargs in calls], ["refresh", "read"])
        refresh.assert_called_once()
        reader.assert_called_once()
        self.assertEqual(
            refresh.call_args.kwargs["base_origin"],
            "https://store.example.test/catalog/",
        )

    def test_remote_refresh_failure_preserves_local_last_known_good_catalog(self) -> None:
        self.server.store_catalog_base_origin = "https://store.example.test/catalog/"
        snapshot = ready_snapshot()
        with (
            mock.patch.object(
                host,
                "acquire_and_promote_store_catalog",
                side_effect=host.StoreCatalogAcquisitionError("offline"),
            ) as refresh,
            mock.patch.object(
                host,
                "read_native_store_catalog_snapshot",
                return_value=snapshot,
            ) as reader,
        ):
            status, payload = self.get_json("/__ordax/native/store-catalog")

        self.assertEqual(status, 200)
        self.assertEqual(payload, snapshot)
        refresh.assert_called_once()
        reader.assert_called_once()

    def test_query_is_rejected_before_catalog_owner_is_called(self) -> None:
        with mock.patch.object(host, "read_native_store_catalog_snapshot") as reader:
            with self.assertRaises(HTTPError) as context:
                urlopen(f"{self.origin}/__ordax/native/store-catalog?unsafe=1", timeout=2)
        self.assertEqual(context.exception.code, 400)
        reader.assert_not_called()

    def test_foreign_origin_is_rejected_by_native_request_boundary(self) -> None:
        request = Request(
            f"{self.origin}/__ordax/native/store-catalog",
            headers={"Origin": "https://example.invalid"},
        )
        with self.assertRaises(HTTPError) as context:
            urlopen(request, timeout=2)
        self.assertEqual(context.exception.code, 403)


if __name__ == "__main__":
    unittest.main()
