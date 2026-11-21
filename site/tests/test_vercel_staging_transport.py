"""Offline tests for authorized Vercel CLI byte transport and canonical preflight."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import staging_preflight as stage
import vercel_staging_transport as transport

ORIGIN = "https://ordax-site-dev.vercel.app"


def emulate(body: bytes, *, status: int = 200, content_type: str = "image/png",
            extra_headers: bytes = b"", returncode: int = 0):
    calls = []

    def execute(args, **kwargs):
        calls.append((args, kwargs))
        headerfile = Path(args[args.index("--dump-header") + 1])
        outputfile = Path(args[args.index("--output") + 1])
        headerfile.write_bytes(
            ("HTTP/2 " + str(status) + "\r\n"
             + "Content-Type: " + content_type + "\r\n"
             + "Content-Length: " + str(len(body)) + "\r\n").encode()
            + extra_headers + b"\r\n"
        )
        outputfile.write_bytes(body)
        return subprocess.CompletedProcess(args, returncode)

    return execute, calls


class VercelTransportTests(unittest.TestCase):
    def test_binary_stream_preserves_all_bytes_not_lossy_text(self):
        payload = bytes(range(256)) * 33
        simulate, calls = emulate(payload)
        with patch.object(transport.shutil, "which", return_value="/bin/vercel"), \
             patch.object(transport.subprocess, "run", side_effect=simulate):
            status, headers, body = transport.get_raw(ORIGIN, "/assets/symbol.png", len(payload))
        self.assertEqual(status, 200)
        self.assertEqual(body, payload)
        self.assertEqual(hashlib.sha256(body).hexdigest(), hashlib.sha256(payload).hexdigest())
        self.assertEqual(headers["content-type"], "image/png")
        self.assertEqual(len(calls), 1)
        args, opts = calls[0]
        self.assertEqual(args[:3], ["/bin/vercel", "curl", ORIGIN + "/assets/symbol.png"])
        self.assertEqual(args[args.index("--max-filesize") + 1], str(len(payload)))
        self.assertEqual(args[args.index("--request") + 1], "GET")
        for prohibited in ("--location", "-L", "--insecure", "-k", "--token", "--prod"):
            self.assertNotIn(prohibited, args)
        self.assertEqual(opts["stdin"], subprocess.DEVNULL)
        self.assertEqual(opts["stdout"], subprocess.DEVNULL)
        self.assertEqual(opts["stderr"], subprocess.DEVNULL)

    def test_json_reuses_mime_size_and_no_store_validation(self):
        value = {"$schema": "prototype-ordax.public-site-runtime/1"}
        payload = (json.dumps(value) + "\n").encode()
        simulate, _ = emulate(payload, content_type="application/json",
                             extra_headers=b"Cache-Control: no-store\r\n")
        with patch.object(transport.shutil, "which", return_value="/bin/vercel"), \
             patch.object(transport.subprocess, "run", side_effect=simulate):
            with patch.object(stage, "vercel_get_raw", side_effect=transport.get_raw):
                status, parsed, digest, size = stage._fetch_vercel_json(
                    ORIGIN, "/auth/session", 16 * 1024)
        self.assertEqual(status, 200)
        self.assertEqual(parsed, value)
        self.assertEqual(size, len(payload))
        self.assertEqual(digest, hashlib.sha256(payload).hexdigest())

    def test_anonymous_must_not_accept_missing_no_store(self):
        simulate, _ = emulate(b'{"authenticated":false}',
                             content_type="application/json")
        with patch.object(transport.shutil, "which", return_value="/bin/vercel"), \
             patch.object(transport.subprocess, "run", side_effect=simulate), \
             patch.object(stage, "vercel_get_raw", side_effect=transport.get_raw):
            with self.assertRaisesRegex(stage.StagingPreflightError, "session-not-no-store"):
                stage._fetch_vercel_json(ORIGIN, "/auth/session", 1024)

    def test_invalid_paths_and_missing_auth_are_not_silently_accepted(self):
        for path in ("//evil.org", "/a/../b", "/a//b", "/a?token=1",
                     "/a#f", "/a\\b", "/a\r\nHeader:evil"):
            with self.subTest(path=path), self.assertRaisesRegex(
                transport.VercelTransportError, "path-invalid"
            ):
                transport.get_raw(ORIGIN, path, 123)
        with patch.object(transport.shutil, "which", return_value=None):
            with self.assertRaisesRegex(transport.VercelTransportError, "not-installed"):
                transport.get_raw(ORIGIN, "/assets/a.js", 123)
        for code in (401, 403):
            simulate, _ = emulate(b"no", status=code)
            with patch.object(transport.shutil, "which", return_value="/bin/vercel"), \
                 patch.object(transport.subprocess, "run", side_effect=simulate):
                with self.assertRaisesRegex(transport.VercelTransportError, "auth-required"):
                    transport.get_raw(ORIGIN, "/", 100)

    def test_redirect_oversize_and_cli_failure_are_fail_closed(self):
        for code in (301, 302, 307, 308):
            simulate, _ = emulate(b"", status=code,
                                 extra_headers=b"Location: https://other.example/\r\n")
            with patch.object(transport.shutil, "which", return_value="/bin/vercel"), \
                 patch.object(transport.subprocess, "run", side_effect=simulate):
                with self.assertRaisesRegex(transport.VercelTransportError, "redirect-forbidden"):
                    transport.get_raw(ORIGIN, "/login/", 1024)
        simulate, _ = emulate(b"a" * 101)
        with patch.object(transport.shutil, "which", return_value="/bin/vercel"), \
             patch.object(transport.subprocess, "run", side_effect=simulate):
            with self.assertRaisesRegex(transport.VercelTransportError, "response-too-large"):
                transport.get_raw(ORIGIN, "/assets/a.png", 100)
        simulate, _ = emulate(b"", returncode=1)
        with patch.object(transport.shutil, "which", return_value="/bin/vercel"), \
             patch.object(transport.subprocess, "run", side_effect=simulate):
            with self.assertRaisesRegex(transport.VercelTransportError, "network-or-auth-unavailable"):
                transport.get_raw(ORIGIN, "/", 100)

    def test_transport_selection_keeps_canonical_evaluator(self):
        expected = {"result": "PASS", "verified_bundle_files": 43}
        with patch.object(stage, "evaluate_gateway_contracts", return_value=expected) as evaluate, \
             patch.object(stage, "_fetch_json", side_effect=AssertionError("direct must not run")), \
             patch.object(stage, "_fetch_asset_digest",
                          side_effect=AssertionError("direct asset must not run")), \
             patch.object(stage, "_fetch_vercel_json", return_value=(200, {}, "0"*64, 20)) as vjson, \
             patch.object(stage, "_fetch_vercel_asset_digest", return_value=("0"*64, 2)) as vasset:
            result = stage.run(ORIGIN, "a"*40, "b"*64,
                               scope="static", transport="vercel-cli")
            self.assertIs(result, expected)
            passed_json, passed_asset = evaluate.call_args.args
            passed_json("/public-site-manifest.json", 512 * 1024)
            passed_asset("assets/a.png", 2)
            vjson.assert_called_once()
            vasset.assert_called_once()
        with self.assertRaisesRegex(stage.StagingPreflightError, "staging-transport-unsupported"):
            stage.run(ORIGIN, "a"*40, "b"*64, transport="unsafe")


if __name__ == "__main__":
    unittest.main()
