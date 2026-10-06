import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
sys.path.insert(0, str(RUNTIME))
MODULE = RUNTIME / "native_project_endpoint.py"
spec = importlib.util.spec_from_file_location("native_project_endpoint", MODULE)
endpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(endpoint)


def state(name="Finance App"):
    return {
        "nextOrdinal": 2,
        "projects": [{
            "id": "project-1",
            "name": name,
            "path": "/Documentos/finance-app",
            "createdAt": 1000,
            "lastOpenedAt": 2000,
            "lastFilePath": None,
        }],
    }


def body(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


class NativeProjectEndpointTests(unittest.TestCase):
    def test_read_and_cas_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "projects")
            self.assertEqual(endpoint.read_project_endpoint(root), {"record": None})

            result = endpoint.mutate_project_endpoint(body({
                "action": "compare-and-swap",
                "expectedRevision": 0,
                "state": state(),
            }), root)
            self.assertEqual(result, {"ok": True, "revision": 1})

            restored = endpoint.read_project_endpoint(root)["record"]
            self.assertEqual(restored["revision"], 1)
            self.assertEqual(restored["state"], state())

    def test_stale_revision_maps_to_409_without_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "projects")
            endpoint.mutate_project_endpoint(body({
                "action": "compare-and-swap",
                "expectedRevision": 0,
                "state": state(),
            }), root)
            with self.assertRaises(endpoint.ProjectEndpointRequestError) as raised:
                endpoint.mutate_project_endpoint(body({
                    "action": "compare-and-swap",
                    "expectedRevision": 0,
                    "state": state("Stale"),
                }), root)
            self.assertEqual(raised.exception.status_code, 409)
            restored = endpoint.read_project_endpoint(root)["record"]
            self.assertEqual(restored["state"]["projects"][0]["name"], "Finance App")

    def test_exact_request_shape_and_cas_only_action_are_required(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "projects")
            with self.assertRaisesRegex(endpoint.ProjectEndpointRequestError, "shape"):
                endpoint.mutate_project_endpoint(body({
                    "action": "compare-and-swap",
                    "expectedRevision": 0,
                    "state": state(),
                    "authority": "admin",
                }), root)
            with self.assertRaisesRegex(endpoint.ProjectEndpointRequestError, "action"):
                endpoint.mutate_project_endpoint(body({
                    "action": "replace",
                    "expectedRevision": 0,
                    "state": state(),
                }), root)

    def test_invalid_state_fails_before_persistence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = str(Path(directory) / "projects")
            invalid = state()
            invalid["projects"][0]["path"] = "/Documentos/../segredo"
            with self.assertRaisesRegex(endpoint.ProjectEndpointRequestError, "invalid segment"):
                endpoint.mutate_project_endpoint(body({
                    "action": "compare-and-swap",
                    "expectedRevision": 0,
                    "state": invalid,
                }), root)
            self.assertEqual(endpoint.read_project_endpoint(root), {"record": None})

    def test_request_parser_is_strict_utf8_json_and_bounded(self):
        with self.assertRaisesRegex(endpoint.ProjectEndpointRequestError, "must be bytes"):
            endpoint.mutate_project_endpoint("not-bytes")
        with self.assertRaisesRegex(endpoint.ProjectEndpointRequestError, "empty"):
            endpoint.mutate_project_endpoint(b"")
        with self.assertRaisesRegex(endpoint.ProjectEndpointRequestError, "invalid JSON"):
            endpoint.mutate_project_endpoint(b"\xff")
        with self.assertRaises(endpoint.ProjectEndpointRequestError) as raised:
            endpoint.mutate_project_endpoint(b"{" + (b" " * endpoint.MAX_PROJECT_REQUEST_BODY_BYTES) + b"}")
        self.assertEqual(raised.exception.status_code, 413)

    def test_expected_revision_never_accepts_boolean_or_terminal_value(self):
        for value in (True, -1, 9007199254740991):
            with self.subTest(value=value):
                with self.assertRaisesRegex(endpoint.ProjectEndpointRequestError, "expected revision"):
                    endpoint.mutate_project_endpoint(body({
                        "action": "compare-and-swap",
                        "expectedRevision": value,
                        "state": state(),
                    }))


if __name__ == "__main__":
    unittest.main()
