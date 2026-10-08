from contextlib import redirect_stderr
from functools import partial
from io import StringIO
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"

host_spec = importlib.util.spec_from_file_location("ordax_profile_activation_http_test", HOST)
native_host = importlib.util.module_from_spec(host_spec)
assert host_spec.loader is not None
host_spec.loader.exec_module(native_host)


class ProfileActivationCommandHttpTests(unittest.TestCase):
    def start_server(self, distribution_profile="owner-development"):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        (root / "index.html").write_text("<!doctype html><title>OrdaX</title>", encoding="utf-8")
        handler = partial(native_host.NativeHostHandler, directory=str(root))
        server = native_host.NativeHostServer(
            ("127.0.0.1", 0),
            handler,
            user_root=str(root),
            power_request_path=str(root / "power-request"),
            network_session_dir=str(root),
            distribution_profile=distribution_profile,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return temporary, server, thread

    def stop_server(self, temporary, server, thread):
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        temporary.cleanup()

    def request(self, server, method, path, *, headers=None, payload=None):
        port = server.server_address[1]
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
        request_headers = dict(headers or {})
        body = None
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            response_body = response.read()
            return response.status, response_body
        finally:
            connection.close()

    def trusted_headers(self, server):
        origin = f"http://127.0.0.1:{server.server_address[1]}"
        return {
            "Origin": origin,
            "Sec-Fetch-Site": "same-origin",
        }

    def session(self, server):
        status, body = self.request(
            server,
            "GET",
            native_host.SESSION_PATH,
            headers=self.trusted_headers(server),
        )
        self.assertEqual(status, 200)
        return json.loads(body.decode("utf-8"))

    def command_payload(self):
        return {
            "schema": "ordax.profile-activation-command/1",
            "action": "deactivate",
            "expectedRevision": 0,
            "spaceId": "space-professional-1",
        }

    def test_owner_development_requires_valid_ephemeral_command_token(self):
        temporary, server, thread = self.start_server()
        try:
            session = self.session(server)
            self.assertTrue(session["profileActivationAvailable"])
            token = session["profileActivationToken"]
            self.assertGreaterEqual(len(token), 24)

            status, _body = self.request(
                server,
                "POST",
                native_host.PROFILE_ACTIVATION_COMMAND_PATH,
                headers=self.trusted_headers(server),
                payload=self.command_payload(),
            )
            self.assertEqual(status, 403)

            wrong_headers = self.trusted_headers(server)
            wrong_headers[native_host.PROFILE_ACTIVATION_TOKEN_HEADER] = "wrong-token"
            status, _body = self.request(
                server,
                "POST",
                native_host.PROFILE_ACTIVATION_COMMAND_PATH,
                headers=wrong_headers,
                payload=self.command_payload(),
            )
            self.assertEqual(status, 403)
        finally:
            self.stop_server(temporary, server, thread)

    def test_foreign_browser_origin_is_rejected_before_command_dispatch(self):
        temporary, server, thread = self.start_server()
        original = native_host.execute_profile_activation_command
        dispatched = []
        native_host.execute_profile_activation_command = lambda *args, **kwargs: dispatched.append(True)
        try:
            token = self.session(server)["profileActivationToken"]
            status, _body = self.request(
                server,
                "POST",
                native_host.PROFILE_ACTIVATION_COMMAND_PATH,
                headers={
                    "Origin": "https://attacker.example",
                    "Sec-Fetch-Site": "cross-site",
                    native_host.PROFILE_ACTIVATION_TOKEN_HEADER: token,
                },
                payload=self.command_payload(),
            )
            self.assertEqual(status, 403)
            self.assertEqual(dispatched, [])
        finally:
            native_host.execute_profile_activation_command = original
            self.stop_server(temporary, server, thread)

    def test_stable_mvp_exposes_tokenized_profile_mutation_endpoint(self):
        temporary, server, thread = self.start_server("stable-mvp")
        try:
            session = self.session(server)
            self.assertTrue(session["profileActivationAvailable"])
            self.assertGreaterEqual(len(session["profileActivationToken"]), 24)
            status, _body = self.request(
                server,
                "POST",
                native_host.PROFILE_ACTIVATION_COMMAND_PATH,
                headers=self.trusted_headers(server),
                payload=self.command_payload(),
            )
            self.assertEqual(status, 403)
        finally:
            self.stop_server(temporary, server, thread)


    def test_native_consent_resolver_mints_receipt_only_after_approved_presenter_decision(self):
        temporary, server, thread = self.start_server()
        original = native_host.request_native_decision
        try:
            native_host.request_native_decision = lambda request: {
                "schema": "ordax.profile-human-consent-decision/1",
                "requestId": request["requestId"],
                "approved": True,
            }
            receipt = server.resolve_profile_human_consent(
                permission_diff={
                    "schema": "ordax.profile-permission-diff/1",
                    "componentAdds": [{"id": "knowledge.example"}],
                    "componentRemovals": [],
                    "authorityChanges": [],
                    "requiresExplicitReview": True,
                },
                permission_diff_sha256="a" * 64,
                expected_revision=5,
                space_id="space-professional-1",
                space_kind="professional",
                profile={"slug": "developer", "version": 1},
            )
            self.assertEqual(receipt["permissionDiffSha256"], "a" * 64)
            server.profile_human_consent_authority.consume(
                receipt,
                permission_diff_sha256="a" * 64,
                expected_revision=5,
                space_id="space-professional-1",
                profile={"slug": "developer", "version": 1},
            )
        finally:
            native_host.request_native_decision = original
            self.stop_server(temporary, server, thread)

    def test_native_consent_rejection_and_presenter_unavailability_fail_closed(self):
        temporary, server, thread = self.start_server()
        original = native_host.request_native_decision
        args = {
            "permission_diff": {
                "schema": "ordax.profile-permission-diff/1",
                "componentAdds": [{"id": "knowledge.example"}],
                "componentRemovals": [],
                "authorityChanges": [],
                "requiresExplicitReview": True,
            },
            "permission_diff_sha256": "b" * 64,
            "expected_revision": 3,
            "space_id": "space-professional-2",
            "space_kind": "professional",
            "profile": {"slug": "developer", "version": 1},
        }
        try:
            native_host.request_native_decision = lambda request: {
                "schema": "ordax.profile-human-consent-decision/1",
                "requestId": request["requestId"],
                "approved": False,
            }
            with self.assertRaisesRegex(PermissionError, "rejected by the user"):
                server.resolve_profile_human_consent(**args)

            native_host.request_native_decision = lambda request: (_ for _ in ()).throw(
                ConnectionError("presenter unavailable")
            )
            with self.assertRaises(native_host.ProfileConsentUnavailableError):
                server.resolve_profile_human_consent(**args)
        finally:
            native_host.request_native_decision = original
            self.stop_server(temporary, server, thread)

    def test_presenter_unavailable_maps_to_http_503(self):
        temporary, server, thread = self.start_server()
        original = native_host.execute_profile_activation_command

        def unavailable(*_args, **_kwargs):
            raise native_host.ProfileConsentUnavailableError("presenter unavailable")

        native_host.execute_profile_activation_command = unavailable
        try:
            token = self.session(server)["profileActivationToken"]
            headers = self.trusted_headers(server)
            headers[native_host.PROFILE_ACTIVATION_TOKEN_HEADER] = token
            status, body = self.request(
                server,
                "POST",
                native_host.PROFILE_ACTIVATION_COMMAND_PATH,
                headers=headers,
                payload=self.command_payload(),
            )
            self.assertEqual(status, 503)
            self.assertEqual(body, b"")
        finally:
            native_host.execute_profile_activation_command = original
            self.stop_server(temporary, server, thread)

    def test_owner_development_reads_profile_content_context_for_explicit_space(self):
        temporary, server, thread = self.start_server()
        original = native_host.read_active_profile_content_context
        seen = []
        native_host.read_active_profile_content_context = lambda space_id, *, query=None: (
            seen.append((space_id, query))
            or {
                "schema": "ordax.profile-content-context/1",
                "spaceId": space_id,
                "profile": {"slug": "developer", "version": 1},
                "entries": [],
            }
        )
        try:
            log_capture = StringIO()
            with redirect_stderr(log_capture):
                status, body = self.request(
                    server,
                    "GET",
                    f"{native_host.PROFILE_CONTENT_CONTEXT_PATH}?spaceId=space-professional-1&query=extrusao",
                    headers=self.trusted_headers(server),
                )
            self.assertNotIn("extrusao", log_capture.getvalue())
            self.assertIn("[query redacted]", log_capture.getvalue())
            self.assertEqual(status, 200)
            self.assertEqual(seen, [("space-professional-1", "extrusao")])
            payload = json.loads(body.decode("utf-8"))
            self.assertEqual(payload["spaceId"], "space-professional-1")
        finally:
            native_host.read_active_profile_content_context = original
            self.stop_server(temporary, server, thread)

    def test_stable_mvp_reads_profile_content_context_for_explicit_space(self):
        temporary, server, thread = self.start_server("stable-mvp")
        original = native_host.read_active_profile_content_context
        seen = []
        native_host.read_active_profile_content_context = lambda space_id, *, query=None: (
            seen.append((space_id, query))
            or {
                "schema": "ordax.profile-content-context/1",
                "spaceId": space_id,
                "profile": {"slug": "pizzaria-br", "version": 1},
                "entries": [],
            }
        )
        try:
            status, body = self.request(
                server,
                "GET",
                f"{native_host.PROFILE_CONTENT_CONTEXT_PATH}?spaceId=space-professional-1",
                headers=self.trusted_headers(server),
            )
            self.assertEqual(status, 200)
            self.assertEqual(seen, [("space-professional-1", None)])
            payload = json.loads(body.decode("utf-8"))
            self.assertEqual(payload["profile"]["slug"], "pizzaria-br")
        finally:
            native_host.read_active_profile_content_context = original
            self.stop_server(temporary, server, thread)


    def test_native_profile_context_rejects_query_injection_and_duplicates(self):
        temporary, server, thread = self.start_server()
        try:
            invalid_targets = [
                "?spaceId=space-1&query=a&query=b",
                "?spaceId=space-1&query=" + ("x" * 257),
                "?spaceId=space-1&query=",
                "?spaceId=space-1&unexpected=secret",
                "?spaceId=space-1&spaceId=space-2",
            ]
            for suffix in invalid_targets:
                with self.subTest(suffix=suffix[:60]):
                    status, body = self.request(
                        server, "GET",
                        f"{native_host.PROFILE_CONTENT_CONTEXT_PATH}{suffix}",
                        headers=self.trusted_headers(server),
                    )
                    self.assertEqual(status, 409)
                    self.assertEqual(body, b"")
        finally:
            self.stop_server(temporary, server, thread)

    def test_revision_conflict_maps_to_http_409_with_valid_token(self):
        temporary, server, thread = self.start_server()
        original = native_host.execute_profile_activation_command

        def conflict(*_args, **_kwargs):
            raise RuntimeError("Profile activation state revision changed")

        native_host.execute_profile_activation_command = conflict
        try:
            token = self.session(server)["profileActivationToken"]
            headers = self.trusted_headers(server)
            headers[native_host.PROFILE_ACTIVATION_TOKEN_HEADER] = token
            status, body = self.request(
                server,
                "POST",
                native_host.PROFILE_ACTIVATION_COMMAND_PATH,
                headers=headers,
                payload=self.command_payload(),
            )
            self.assertEqual(status, 409)
            self.assertEqual(body, b"")
        finally:
            native_host.execute_profile_activation_command = original
            self.stop_server(temporary, server, thread)


if __name__ == "__main__":
    unittest.main()
