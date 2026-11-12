from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import os
import socket
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "surface" / "runtime"
MODULE = RUNTIME / "native_intelligence_ipc.py"


def load_module():
    sys.path.insert(0, str(RUNTIME))
    try:
        spec = spec_from_file_location("ordax_native_intelligence_ipc_test", MODULE)
        module = module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(RUNTIME))


def service_request(request_id="request-1"):
    return {
        "schema": "ordax.native-intelligence-service-request/1",
        "requestId": request_id,
        "context": {
            "subjectId": "subject-1",
            "spaceId": "space-1",
            "projectId": None,
        },
        "request": {
            "intent": "ask",
            "prompt": "status",
            "context": [],
            "maxTokens": 512,
        },
    }


def ipc_request(request_id="request-1"):
    return {
        "schema": "ordax.native-intelligence-ipc-request/1",
        "request": service_request(request_id),
    }


class NativeIntelligenceIpcTests(unittest.TestCase):
    def test_private_unix_socket_roundtrip_and_mode(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            socket_path = str(Path(directory) / "intelligence.sock")
            server = module.NativeIntelligenceIpcServer(socket_path=socket_path)
            listener = server.open()
            self.assertEqual(os.stat(socket_path).st_mode & 0o777, 0o600)

            def serve():
                connection, _ = listener.accept()
                with connection:
                    request = server.receive_request(connection)
                    request_id = request["request"]["requestId"]
                    response = module.completed_response(
                        request_id,
                        {
                            "schema": "ordax.native-intelligence-service-response/1",
                            "requestId": request_id,
                            "context": {
                                "subjectId": "subject-1",
                                "spaceId": "space-1",
                                "projectId": None,
                            },
                            "response": {
                                "schema": "ordax.intelligence-response/1",
                                "text": "ok",
                                "engineId": "engine-test",
                                "modelId": "model-test",
                                "authority": "none",
                            },
                        },
                    )
                    server.send_response(
                        connection,
                        response,
                        expected_request_id=request_id,
                    )

            thread = threading.Thread(target=serve)
            thread.start()
            response = module.request_native_intelligence(
                ipc_request(),
                socket_path=socket_path,
                timeout_seconds=2,
            )
            thread.join(timeout=2)
            self.assertEqual(response["outcome"], "completed")
            self.assertEqual(response["requestId"], "request-1")
            self.assertEqual(response["response"]["response"]["authority"], "none")
            server.close()
            self.assertFalse(Path(socket_path).exists())

    def test_unknown_outcome_is_explicit_and_non_retry_claiming(self):
        module = load_module()
        response = module.unknown_response("request-1")
        self.assertEqual(
            response,
            {
                "schema": "ordax.native-intelligence-ipc-response/1",
                "requestId": "request-1",
                "outcome": "unknown",
                "response": None,
                "error": "unavailable",
            },
        )
        module.validate_response(response, expected_request_id="request-1")

    def test_response_must_match_request_id(self):
        module = load_module()
        with self.assertRaisesRegex(PermissionError, "does not match"):
            module.validate_response(
                module.unknown_response("request-2"),
                expected_request_id="request-1",
            )

    def test_existing_non_socket_path_fails_closed(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as directory:
            socket_path = Path(directory) / "intelligence.sock"
            socket_path.write_text("not-a-socket", encoding="utf-8")
            server = module.NativeIntelligenceIpcServer(socket_path=str(socket_path))
            with self.assertRaisesRegex(RuntimeError, "not a socket"):
                server.open()

    def test_request_shape_and_message_size_are_bounded(self):
        module = load_module()
        with self.assertRaisesRegex(ValueError, "fields"):
            module.validate_request({**ipc_request(), "provider": "openai"})

        oversized = {"schema": module.REQUEST_SCHEMA, "request": {"requestId": "r", "padding": "x" * (module.MAX_MESSAGE_BYTES + 1)}}
        with self.assertRaisesRegex(ValueError, "size"):
            module._encode(oversized)

    def test_transport_module_stays_unix_only(self):
        source = MODULE.read_text(encoding="utf-8")
        self.assertIn("socket.AF_UNIX", source)
        self.assertNotIn("socket.AF_INET", source)
        self.assertNotIn("http://", source)
        self.assertNotIn("https://", source)
        for forbidden in ("apiKey", "OPENAI", "xAI", "model-router", "llama", "Qwen"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
