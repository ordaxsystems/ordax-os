#!/usr/bin/env python3
"""HTTP integration proof for the private Native Store lifecycle delegate."""

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


def artifact(name: str, char: str) -> dict:
    return {"name": name, "sha256": char * 64, "size": 123}


def plan(operation: str = "install") -> dict:
    return {
        "schema": "ordax.app-lifecycle-plan/1",
        "request": {
            "schema": "ordax.app-lifecycle-request/1",
            "requestId": f"store:{operation}:notes:host-test",
            "appId": "notes",
            "operation": operation,
            "source": "store",
            "authority": "none",
        },
        "catalogSequence": 9,
        "catalogSha256": "f" * 64,
        "catalogSourceCommit": COMMIT,
        "candidate": (
            {
                "appId": "notes",
                "version": "0.4.3",
                "sourceCommit": COMMIT,
                "artifacts": {
                    "package": artifact("notes.zip", "b"),
                    "release": artifact("notes.release.json", "c"),
                    "compatibility": artifact("notes.compatibility.json", "d"),
                    "componentEnvelope": artifact(
                        "notes.runtime-component-envelope.json",
                        "e",
                    ),
                },
            }
            if operation != "remove"
            else None
        ),
        "authority": "none",
    }


class NativeStoreLifecycleHostTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.user_root = self.root / "user"
        self.user_root.mkdir()
        self.session_dir = self.root / "run"
        self.session_dir.mkdir()
        self.slots = self.root / "slots"
        self.slots.mkdir()
        self.artifacts = self.root / "artifacts"
        self.watermark = self.root / "store" / "catalog-watermark.json"
        self.watermark.parent.mkdir(mode=0o700)
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
            component_channel_bin=str(self.root / "component-channel"),
            component_trust_path=str(self.root / "trust.json"),
            component_slot_root=str(self.slots),
            store_catalog_envelope_path=str(self.root / "catalog-envelope.json"),
            store_catalog_watermark_path=str(self.watermark),
            store_artifact_root=str(self.artifacts),
            store_artifact_base_origin="https://store.example.test/artifacts/",
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

    def post(self, value: dict, path: str = "/__ordax/native/store-lifecycle"):
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        request = Request(
            f"{self.origin}{path}",
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=2) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_install_acquires_then_executes_and_returns_authority_free_result(self) -> None:
        value = plan("install")
        calls = []
        with (
            mock.patch.object(
                host,
                "acquire_lifecycle_plan_artifacts",
                side_effect=lambda raw, **kwargs: calls.append(("acquire", raw, kwargs)) or {},
            ) as acquire,
            mock.patch.object(
                host,
                "execute_offline_lifecycle_plan",
                side_effect=lambda raw, **kwargs: calls.append(("execute", raw, kwargs)) or {
                    "state": "pending-health"
                },
            ) as execute,
        ):
            status, payload = self.post(value)

        self.assertEqual(status, 200)
        self.assertEqual(payload, {
            "schema": "ordax.app-lifecycle-request-result/1",
            "requestId": value["request"]["requestId"],
            "appId": "notes",
            "operation": "install",
            "source": "store",
            "state": "accepted",
            "reason": None,
            "authority": "none",
        })
        self.assertEqual([entry[0] for entry in calls], ["acquire", "execute"])
        acquire.assert_called_once()
        execute.assert_called_once()
        acquire_kwargs = acquire.call_args.kwargs
        self.assertEqual(
            acquire_kwargs["base_origin"],
            "https://store.example.test/artifacts/",
        )
        self.assertEqual(acquire_kwargs["artifact_root"], str(self.artifacts))
        self.assertEqual(acquire_kwargs["watermark_path"], str(self.watermark))
        execute_kwargs = execute.call_args.kwargs
        self.assertEqual(execute_kwargs["artifact_root"], str(self.artifacts))
        self.assertEqual(execute_kwargs["slot_root"], str(self.slots))

    def test_remove_never_requires_or_calls_remote_artifact_acquisition(self) -> None:
        value = plan("remove")
        with (
            mock.patch.object(host, "acquire_lifecycle_plan_artifacts") as acquire,
            mock.patch.object(
                host,
                "execute_offline_lifecycle_plan",
                return_value={"state": "removed"},
            ) as execute,
        ):
            status, payload = self.post(value)
        self.assertEqual(status, 200)
        self.assertEqual(payload["state"], "accepted")
        acquire.assert_not_called()
        execute.assert_called_once()

    def test_invalid_plan_is_rejected_before_privileged_or_network_work(self) -> None:
        value = plan()
        value["authority"] = "platform-component-lifecycle"
        with (
            mock.patch.object(host, "acquire_lifecycle_plan_artifacts") as acquire,
            mock.patch.object(host, "execute_offline_lifecycle_plan") as execute,
        ):
            with self.assertRaises(HTTPError) as context:
                self.post(value)
        self.assertEqual(context.exception.code, 400)
        acquire.assert_not_called()
        execute.assert_not_called()

    def test_query_is_rejected_before_privileged_work(self) -> None:
        with (
            mock.patch.object(host, "acquire_lifecycle_plan_artifacts") as acquire,
            mock.patch.object(host, "execute_offline_lifecycle_plan") as execute,
        ):
            with self.assertRaises(HTTPError) as context:
                self.post(plan(), "/__ordax/native/store-lifecycle?unsafe=1")
        self.assertEqual(context.exception.code, 400)
        acquire.assert_not_called()
        execute.assert_not_called()

    def test_foreign_origin_is_rejected_by_native_request_boundary(self) -> None:
        body = json.dumps(plan(), separators=(",", ":")).encode("utf-8")
        request = Request(
            f"{self.origin}/__ordax/native/store-lifecycle",
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Origin": "https://example.invalid",
            },
        )
        with self.assertRaises(HTTPError) as context:
            urlopen(request, timeout=2)
        self.assertEqual(context.exception.code, 403)

    def test_missing_production_artifact_origin_fails_closed_for_install_only(self) -> None:
        self.server.store_artifact_base_origin = ""
        with (
            mock.patch.object(host, "acquire_lifecycle_plan_artifacts") as acquire,
            mock.patch.object(host, "execute_offline_lifecycle_plan") as execute,
        ):
            with self.assertRaises(HTTPError) as context:
                self.post(plan("install"))
        self.assertEqual(context.exception.code, 503)
        acquire.assert_not_called()
        execute.assert_not_called()

    def test_internal_lifecycle_failure_returns_no_private_error_payload(self) -> None:
        with (
            mock.patch.object(
                host,
                "acquire_lifecycle_plan_artifacts",
                side_effect=host.AppArtifactAcquisitionError("secret internal detail"),
            ),
            mock.patch.object(host, "execute_offline_lifecycle_plan") as execute,
        ):
            body = json.dumps(plan(), separators=(",", ":")).encode("utf-8")
            request = Request(
                f"{self.origin}/__ordax/native/store-lifecycle",
                data=body,
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            with self.assertRaises(HTTPError) as context:
                urlopen(request, timeout=2)
            self.assertEqual(context.exception.code, 503)
            self.assertEqual(context.exception.read(), b"")
        execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
