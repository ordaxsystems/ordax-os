from email.message import Message
from functools import partial
import http.client
import importlib.util
from pathlib import Path
import tempfile
from unittest.mock import patch
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "system" / "surface" / "runtime" / "native_request_boundary.py"

spec = importlib.util.spec_from_file_location("ordax_native_request_boundary_test", POLICY)
boundary = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(boundary)

HOST = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
host_spec = importlib.util.spec_from_file_location("ordax_native_boundary_integration", HOST)
native_host = importlib.util.module_from_spec(host_spec)
assert host_spec.loader is not None
host_spec.loader.exec_module(native_host)


class NativeRequestBoundaryPolicyTests(unittest.TestCase):
    def headers(self, *pairs):
        headers = Message()
        for name, value in pairs:
            headers.add_header(name, value)
        return headers

    def test_authority_is_exact_ipv4_loopback_with_concrete_port(self):
        self.assertEqual(
            boundary.expected_surface_authority(("127.0.0.1", 8765)),
            "127.0.0.1:8765",
        )
        self.assertEqual(
            boundary.expected_surface_origin(("127.0.0.1", 8765)),
            "http://127.0.0.1:8765",
        )

        invalid = (
            ("0.0.0.0", 8765),
            ("localhost", 8765),
            ("::1", 8765),
            ("127.0.0.1", 0),
            ("127.0.0.1", 65536),
            ("127.0.0.1", True),
        )
        for address in invalid:
            with self.subTest(address=address):
                with self.assertRaises(ValueError):
                    boundary.expected_surface_authority(address)

    def test_host_header_is_unique_and_matches_canonical_authority(self):
        trusted = "127.0.0.1:8765"
        self.assertTrue(
            boundary.host_header_is_trusted(
                self.headers(("Host", trusted)),
                trusted,
            )
        )

        rejected = (
            "attacker.example:8765",
            "localhost:8765",
            "127.0.0.1",
            "127.0.0.1:9999",
            "127.0.0.1:8765.evil.example",
            "１２７.０.０.１:8765",
        )
        for value in rejected:
            with self.subTest(value=value):
                self.assertFalse(
                    boundary.host_header_is_trusted(
                        self.headers(("Host", value)),
                        trusted,
                    )
                )

        duplicate = self.headers(("Host", trusted), ("Host", trusted))
        self.assertFalse(boundary.host_header_is_trusted(duplicate, trusted))
        self.assertFalse(boundary.host_header_is_trusted(Message(), trusted))

    def test_explicit_foreign_browser_context_fails_closed(self):
        trusted = "http://127.0.0.1:8765"
        self.assertTrue(boundary.browser_context_is_trusted(Message(), trusted))
        self.assertTrue(
            boundary.browser_context_is_trusted(
                self.headers(
                    ("Origin", trusted),
                    ("Referer", f"{trusted}/composition/native/index.html"),
                    ("Sec-Fetch-Site", "same-origin"),
                ),
                trusted,
            )
        )
        self.assertTrue(
            boundary.browser_context_is_trusted(
                self.headers(("Sec-Fetch-Site", "none")),
                trusted,
            )
        )

        rejected_headers = (
            self.headers(("Origin", "https://attacker.example")),
            self.headers(("Origin", "null")),
            self.headers(("Referer", "https://attacker.example/page")),
            self.headers(("Referer", "http://127.0.0.1:9999/page")),
            self.headers(("Sec-Fetch-Site", "cross-site")),
            self.headers(("Sec-Fetch-Site", "same-site")),
            self.headers(("Origin", trusted), ("Origin", trusted)),
            self.headers(("Referer", f"{trusted}/"), ("Referer", f"{trusted}/")),
            self.headers(("Sec-Fetch-Site", "same-origin"), ("Sec-Fetch-Site", "same-origin")),
        )
        for headers in rejected_headers:
            with self.subTest(headers=list(headers.items())):
                self.assertFalse(boundary.browser_context_is_trusted(headers, trusted))

    def test_opaque_component_package_read_is_the_only_foreign_native_api_exception(self):
        address = ("127.0.0.1", 8765)
        signed_js = "/__ordax/native/component-module/notes/current/0.3.0/" + "a" * 40 + "/src/runtime.mjs"
        opaque = self.headers(
            ("Host", "127.0.0.1:8765"),
            ("Origin", "null"),
            ("Sec-Fetch-Mode", "cors"),
            ("Sec-Fetch-Dest", "script"),
            ("Sec-Fetch-Site", "cross-site"),
        )
        self.assertFalse(boundary.browser_context_is_trusted(
            opaque, "http://127.0.0.1:8765",
        ))
        self.assertTrue(boundary.request_is_trusted(opaque, address, signed_js, "GET"))
        signed_css = signed_js.replace("/src/runtime.mjs", "/src/runtime.css")
        opaque_css = self.headers(
            ("Host", "127.0.0.1:8765"),
            ("Origin", "null"),
            ("Sec-Fetch-Mode", "no-cors"),
            ("Sec-Fetch-Dest", "style"),
            ("Sec-Fetch-Site", "cross-site"),
        )
        self.assertTrue(boundary.request_is_trusted(opaque_css, address, signed_css, "GET"))
        for extension, destination, mode in (
            (".png", "image", "no-cors"),
            (".woff2", "font", "cors"),
        ):
            asset_headers = self.headers(
                ("Host", "127.0.0.1:8765"),
                ("Origin", "null"),
                ("Sec-Fetch-Mode", mode),
                ("Sec-Fetch-Dest", destination),
                ("Sec-Fetch-Site", "cross-site"),
            )
            self.assertTrue(boundary.request_is_trusted(
                asset_headers, address, signed_js.rsplit(".", 1)[0] + extension, "GET",
            ))
        no_origin_image = self.headers(
            ("Host", "127.0.0.1:8765"),
            ("Sec-Fetch-Mode", "no-cors"),
            ("Sec-Fetch-Dest", "image"),
            ("Sec-Fetch-Site", "cross-site"),
        )
        self.assertTrue(boundary.request_is_trusted(
            no_origin_image, address, signed_js.replace(".mjs", ".png"), "GET",
        ))
        self.assertFalse(boundary.request_is_trusted(
            self.headers(
                ("Host", "127.0.0.1:8765"),
                ("Sec-Fetch-Mode", "no-cors"),
                ("Sec-Fetch-Dest", "image"),
                ("Sec-Fetch-Site", "same-origin"),
            ), address, signed_js.replace(".mjs", ".png"), "GET",
        ))
        for same_origin_module in (
            self.headers(
                ("Host", "127.0.0.1:8765"),
                ("Origin", "http://127.0.0.1:8765"),
                ("Sec-Fetch-Mode", "cors"),
                ("Sec-Fetch-Dest", "script"),
                ("Sec-Fetch-Site", "same-origin"),
            ),
            self.headers(("Host", "127.0.0.1:8765")),
        ):
            self.assertFalse(boundary.request_is_trusted(
                same_origin_module, address, signed_js, "GET",
            ))
        for path in (
            "/__ordax/native/files", "/__ordax/native/file-content",
            "/__ordax/native/file-import", "/__ordax/native/trash",
            "/__ordax/native/component-runtime?component=notes&state=current",
            "/__ordax/native/app-data/secret", "/auth/session",
            signed_js + "?unsafe=1", signed_js.replace(".mjs", ".json"),
        ):
            with self.subTest(path=path):
                self.assertFalse(boundary.request_is_trusted(opaque, address, path, "GET"))
        for method in ("HEAD", "POST", "PUT", "OPTIONS"):
            self.assertFalse(boundary.request_is_trusted(opaque, address, signed_js, method))
        for name, value in (
            ("Host", "evil.example:8765"),
            ("Origin", "https://evil.example"),
            ("Sec-Fetch-Mode", "no-cors"),
            ("Sec-Fetch-Dest", "image"),
            ("Sec-Fetch-Site", "same-origin"),
            ("Cookie", "sid=private"),
            ("Authorization", "Bearer secret"),
            ("Referer", "http://127.0.0.1:8765/"),
        ):
            with self.subTest(header=name):
                changed = [(key, val) for key, val in opaque.items() if key.lower() != name.lower()]
                changed.append((name, value))
                self.assertFalse(boundary.request_is_trusted(
                    self.headers(*changed), address, signed_js, "GET",
                ))
        duplicate = self.headers(*opaque.items(), ("Origin", "null"))
        self.assertFalse(boundary.request_is_trusted(duplicate, address, signed_js, "GET"))

    def test_account_and_sync_routes_are_privileged_loopback_apis(self):
        address = ("127.0.0.1", 8765)
        host = "127.0.0.1:8765"
        for path in ("/auth/session", "/auth/login", "/account/spaces", "/sync/objects", "/sync/mutate", "/network/v2/messages/send"):
            with self.subTest(path=path):
                self.assertFalse(
                    boundary.request_is_trusted(
                        self.headers(
                            ("Host", host),
                            ("Origin", "https://attacker.example"),
                            ("Sec-Fetch-Site", "cross-site"),
                        ),
                        address,
                        path,
                    )
                )

    def test_every_request_is_host_pinned_and_native_api_adds_context_check(self):
        address = ("127.0.0.1", 8765)
        host = "127.0.0.1:8765"
        origin = "http://127.0.0.1:8765"

        self.assertTrue(
            boundary.request_is_trusted(
                self.headers(("Host", host)),
                address,
                "/composition/native/index.html",
            )
        )
        self.assertFalse(
            boundary.request_is_trusted(
                self.headers(("Host", "attacker.example:8765")),
                address,
                "/composition/native/index.html",
            )
        )
        self.assertTrue(
            boundary.request_is_trusted(
                self.headers(
                    ("Host", host),
                    ("Origin", origin),
                    ("Sec-Fetch-Site", "same-origin"),
                ),
                address,
                boundary.NATIVE_API_PREFIX + "session",
            )
        )
        self.assertFalse(
            boundary.request_is_trusted(
                self.headers(
                    ("Host", host),
                    ("Origin", "https://attacker.example"),
                    ("Sec-Fetch-Site", "cross-site"),
                ),
                address,
                boundary.NATIVE_API_PREFIX + "session",
            )
        )


class NativeRequestBoundaryIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        (root / "index.html").write_text("<!doctype html><title>OrdaX</title>", encoding="utf-8")
        handler = partial(native_host.NativeHostHandler, directory=str(root))
        self.server = native_host.NativeHostServer(
            ("127.0.0.1", 0),
            handler,
            user_root=str(root),
            power_request_path=str(root / "power-request"),
            network_session_dir=str(root),
        )
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def request(self, path, *, headers=None, method="GET"):
        status, body, _headers = self.request_with_headers(
            path, headers=headers, method=method,
        )
        return status, body

    def request_with_headers(self, path, *, headers=None, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            body = response.read()
            return response.status, body, dict(response.getheaders())
        finally:
            connection.close()

    def test_static_surface_requires_exact_bound_authority(self):
        status, _body = self.request("/index.html")
        self.assertEqual(status, 200)

        status, _body = self.request(
            "/index.html",
            headers={"Host": f"attacker.example:{self.port}"},
        )
        self.assertEqual(status, 403)

    def test_inherited_head_rejects_foreign_host_before_static_dispatch(self):
        status, body = self.request(
            "/index.html", method="HEAD",
            headers={"Host": f"attacker.example:{self.port}"},
        )
        self.assertEqual(status, 403)
        self.assertEqual(body, b"")

        status, body = self.request("/index.html", method="HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")

    def test_all_methods_share_one_ingress_policy(self):
        bad_headers = {
            "Host": f"attacker.example:{self.port}",
            "Origin": f"https://attacker.example",
        }
        for method in ("GET", "HEAD", "POST", "OPTIONS", "PUT"):
            with self.subTest(method=method):
                status, _body = self.request("/index.html", method=method, headers=bad_headers)
                self.assertEqual(status, 403)

        status, _body = self.request("/index.html", method="PUT")
        self.assertEqual(status, 501)

    def test_duplicate_host_headers_cannot_bypass_canonical_parser(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        try:
            connection.putrequest("HEAD", "/index.html", skip_host=True)
            connection.putheader("Host", f"127.0.0.1:{self.port}")
            connection.putheader("Host", f"127.0.0.1:{self.port}")
            connection.endheaders()
            response = connection.getresponse()
            response.read()
            self.assertEqual(response.status, 403)
        finally:
            connection.close()

    def test_inherited_head_rejects_cross_site_provenance(self):
        status, _ = self.request(
            native_host.SESSION_PATH, method="HEAD",
            headers={"Origin": "https://attacker.example", "Sec-Fetch-Site": "cross-site"},
        )
        self.assertEqual(status, 403)

    def test_native_api_rejects_foreign_browser_provenance(self):
        origin = f"http://127.0.0.1:{self.port}"
        status, body = self.request(
            native_host.SESSION_PATH,
            headers={
                "Origin": origin,
                "Sec-Fetch-Site": "same-origin",
            },
        )
        self.assertEqual(status, 200)
        self.assertIn(b'"token"', body)

        status, _body = self.request(
            native_host.SESSION_PATH,
            headers={
                "Origin": "https://attacker.example",
                "Sec-Fetch-Site": "cross-site",
            },
        )
        self.assertEqual(status, 403)

    def test_account_session_rejects_foreign_browser_provenance(self):
        status, _body = self.request(
            native_host.ACCOUNT_SESSION_PATH,
            headers={
                "Origin": "https://attacker.example",
                "Sec-Fetch-Site": "cross-site",
            },
        )
        self.assertEqual(status, 403)

    def test_network_send_rejects_foreign_browser_provenance(self):
        status, _body = self.request(
            native_host.NETWORK_MESSAGE_SEND_PATH,
            headers={
                "Origin": "https://attacker.example",
                "Sec-Fetch-Site": "cross-site",
            },
        )
        self.assertEqual(status, 403)

    def test_opaque_module_origin_can_read_verified_code_but_not_native_files(self):
        signed_js = "/__ordax/native/component-module/notes/current/0.3.0/" + "a" * 40 + "/src/runtime.mjs"
        opaque = {
            "Origin": "null", "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "script", "Sec-Fetch-Site": "cross-site",
        }
        self.server.component_slot_read_available = True
        # Integration isolates ingress/HTTP headers. Native signed-slot file
        # hash/revision verification is covered by its own separate tests.
        with patch.object(native_host, "read_component_runtime_file", return_value=b"export const ok = true;") as read:
            status, body, headers = self.request_with_headers(signed_js, headers=opaque)
            self.assertEqual(status, 200)
            self.assertEqual(body, b"export const ok = true;")
            self.assertEqual(headers.get("Access-Control-Allow-Origin"), "null")
            self.assertEqual(headers.get("Vary"), "Origin")
            self.assertNotIn("Access-Control-Allow-Credentials", headers)
            read.assert_called_once()
            signed_css = signed_js.replace("/src/runtime.mjs", "/src/runtime.css")
            css_headers = {**opaque, "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "style"}
            status, body, css_response_headers = self.request_with_headers(
                signed_css, headers=css_headers,
            )
            self.assertEqual(status, 200)
            self.assertEqual(body, b"export const ok = true;")
            self.assertEqual(css_response_headers.get("Access-Control-Allow-Origin"), "null")
            self.assertEqual(read.call_count, 2)
            for method, path in (
                ("POST", signed_js),
                ("GET", native_host.FILES_PATH),
                ("GET", native_host.COMPONENT_RUNTIME_PATH + "?component=notes&state=current"),
                ("GET", signed_js.replace(".mjs", ".json")),
            ):
                with self.subTest(method=method, path=path):
                    status, _body, denied_headers = self.request_with_headers(
                        path, headers=opaque, method=method,
                    )
                    self.assertEqual(status, 403)
                    self.assertNotIn("Access-Control-Allow-Origin", denied_headers)
            self.assertEqual(read.call_count, 2)

            # Same-origin import runs in the privileged Surface realm and is
            # rejected before the signed-slot file reader is invoked.
            status, _body, denied_headers = self.request_with_headers(
                signed_js,
                headers={
                    "Origin": f"http://127.0.0.1:{self.port}",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Dest": "script",
                    "Sec-Fetch-Site": "same-origin",
                },
            )
            self.assertEqual(status, 403)
            self.assertNotIn("Access-Control-Allow-Origin", denied_headers)
            self.assertEqual(read.call_count, 2)

    def test_no_cors_file_preview_has_same_origin_resource_policy(self):
        # An ordinary Surface file response is retained; a browser in a
        # cross-origin/no-cors context must not embed its bytes.
        status, _body, headers = self.request_with_headers(native_host.FILES_PATH + "?path=/")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Cross-Origin-Resource-Policy"), "same-origin")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_dns_rebinding_style_host_alias_cannot_reach_native_api(self):
        status, _body = self.request(
            native_host.SESSION_PATH,
            headers={
                "Host": f"public-name.example:{self.port}",
                "Origin": f"http://public-name.example:{self.port}",
                "Sec-Fetch-Site": "same-origin",
            },
        )
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
