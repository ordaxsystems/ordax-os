import importlib.util
import json
import os
import stat
import tempfile
import threading
import unittest
from unittest import mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "system" / "diagnostics" / "internet_native_physical_proof.py"
WRAPPER = ROOT / "system" / "surface" / "bin" / "ordax-internet-proof"
RUNTIME_RESOLVER = ROOT / "system" / "surface" / "bin" / "ordax-proof-runtime.sh"

spec = importlib.util.spec_from_file_location("ordax_internet_physical_proof", PROOF)
proof = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(proof)


class BoundaryHandler(BaseHTTPRequestHandler):
    expected_authority = ""

    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        if self.headers.get("Host") != self.expected_authority:
            self.send_response(403)
            self.end_headers()
            return
        if self.path.startswith("http://") or self.path.startswith("https://"):
            self.send_response(403)
            self.end_headers()
            return
        if self.path.startswith("/__ordax/native/"):
            if self.headers.get("Origin") not in (None, f"http://{self.expected_authority}"):
                self.send_response(403)
                self.end_headers()
                return
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                self.send_response(403)
                self.end_headers()
                return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")


class InternetNativePhysicalProofTests(unittest.TestCase):
    def test_session_snapshot_redacts_urls_and_checks_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory)
            session = profile / "session.json"
            session.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "urls": ["https://example.com/a", "https://example.org/b"],
                        "activeIndex": 1,
                    }
                ),
                encoding="utf-8",
            )
            os.chmod(session, 0o600)
            snapshot, checks = proof.session_snapshot(profile)
            self.assertEqual(snapshot["url_count"], 2)
            self.assertEqual(snapshot["active_index"], 1)
            self.assertEqual(snapshot["mode"], 0o600)
            self.assertEqual(len(snapshot["semantic_sha256"]), 64)
            self.assertNotIn("urls", snapshot)
            self.assertFalse(any(item["status"] == "fail" for item in checks))

    def test_session_snapshot_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory)
            target = profile / "target.json"
            target.write_text('{"version":1,"urls":[],"activeIndex":null}', encoding="utf-8")
            (profile / "session.json").symlink_to(target)
            _snapshot, checks = proof.session_snapshot(profile)
            self.assertTrue(any(item["id"] == "browser_session_regular" and item["status"] == "fail" for item in checks))

    def test_finds_exact_browser_host_process_and_profile(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = Path(directory)
            pid = proc / "42"
            pid.mkdir()
            (pid / "cmdline").write_bytes(
                b"/usr/bin/python3\0/srv/ordax-system/surface/runtime/ordax_browser_host.py\0--profile-root\0/var/lib/ordax-user/browser\0"
            )
            (pid / "stat").write_text(
                "42 (python3) S 1 1 1 0 -1 0 0 0 0 0 0 0 0 0 0 0 0 0 12345 0 0\n",
                encoding="ascii",
            )
            processes = proof.find_browser_host_processes(proc)
            self.assertEqual(len(processes), 1)
            self.assertEqual(processes[0]["pid"], 42)
            self.assertEqual(processes[0]["profile_root"], "/var/lib/ordax-user/browser")

    def test_live_http_checks_exercise_exact_host_and_provenance(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), BoundaryHandler)
        BoundaryHandler.expected_authority = f"127.0.0.1:{server.server_port}"
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            checks = proof.live_http_checks("127.0.0.1", server.server_port, 1.0)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.assertEqual(len(checks), 5)
        self.assertTrue(all(item["status"] == "pass" for item in checks), checks)

    def test_compare_requires_new_browser_host_and_same_redacted_session(self):
        before = {
            "schema": proof.SCHEMA,
            "captured_at": "2026-09-20T12:00:00Z",
            "label": "before",
            "boot_id": "boot-a",
            "evidence_context": {
                "distribution_profile": "owner-development",
                "runtime_mode": "dynamic-native-runtime",
                "evidence_scope": "development",
                "runtime_sha256": None,
            },
            "browser_host_processes": [{"pid": 100, "start_ticks": 500}],
            "session": {"semantic_sha256": "a" * 64, "url_count": 3, "active_index": 1},
        }
        after = {
            "schema": proof.SCHEMA,
            "captured_at": "2026-09-20T12:01:00Z",
            "label": "after",
            "boot_id": "boot-a",
            "evidence_context": {
                "distribution_profile": "owner-development",
                "runtime_mode": "dynamic-native-runtime",
                "evidence_scope": "development",
                "runtime_sha256": None,
            },
            "browser_host_processes": [{"pid": 101, "start_ticks": 900}],
            "session": {"semantic_sha256": "a" * 64, "url_count": 3, "active_index": 1},
        }
        report = proof.compare_reports(before, after)
        self.assertEqual(report["summary"]["fail"], 0)
        self.assertGreaterEqual(report["summary"]["pass"], 5)

    def test_compare_rejects_missing_surface_restart(self):
        report = proof.compare_reports(
            {
                "schema": proof.SCHEMA,
                "boot_id": "same",
                "evidence_context": {
                "distribution_profile": "owner-development",
                "runtime_mode": "dynamic-native-runtime",
                "evidence_scope": "development",
                "runtime_sha256": None,
            },
            "browser_host_processes": [{"pid": 10, "start_ticks": 20}],
                "session": {"semantic_sha256": "b" * 64, "url_count": 1, "active_index": 0},
            },
            {
                "schema": proof.SCHEMA,
                "boot_id": "same",
                "browser_host_processes": [{"pid": 10, "start_ticks": 20}],
                "session": {"semantic_sha256": "b" * 64, "url_count": 1, "active_index": 0},
            },
        )
        self.assertGreater(report["summary"]["fail"], 0)

    def test_evidence_context_requires_verified_digest_only_for_stable(self):
        self.assertEqual(
            proof.evidence_context_from_environment()["evidence_scope"],
            "development",
        )
        with mock.patch.dict(
            "os.environ",
            {
                "ORDAX_PROOF_PROFILE": "stable-mvp",
                "ORDAX_PROOF_RUNTIME_MODE": "verified-erofs-overlay",
                "ORDAX_PROOF_EVIDENCE_SCOPE": "canonical-stable-mvp",
                "ORDAX_PROOF_RUNTIME_SHA256": "d" * 64,
            },
            clear=False,
        ):
            context = proof.evidence_context_from_environment()
            self.assertEqual(context["runtime_sha256"], "d" * 64)

        with mock.patch.dict(
            "os.environ",
            {
                "ORDAX_PROOF_PROFILE": "owner-development",
                "ORDAX_PROOF_RUNTIME_MODE": "dynamic-native-runtime",
                "ORDAX_PROOF_EVIDENCE_SCOPE": "development",
                "ORDAX_PROOF_RUNTIME_SHA256": "d" * 64,
            },
            clear=False,
        ):
            with self.assertRaisesRegex(ValueError, "must not claim"):
                proof.evidence_context_from_environment()

    def test_owner_verified_erofs_digest_never_promotes_development_evidence(self):
        valid = {
            "ORDAX_PROOF_PROFILE": "owner-development",
            "ORDAX_PROOF_RUNTIME_MODE": "verified-erofs-overlay",
            "ORDAX_PROOF_EVIDENCE_SCOPE": "development",
            "ORDAX_PROOF_RUNTIME_SHA256": "f" * 64,
        }
        with mock.patch.dict("os.environ", valid, clear=False):
            context = proof.evidence_context_from_environment()
            self.assertEqual(context["runtime_sha256"], "f" * 64)
            self.assertEqual(context["evidence_scope"], "development")
            self.assertIsNotNone(proof._evidence_context({"evidence_context": context}))
        for mutation in (
            {"ORDAX_PROOF_RUNTIME_SHA256": ""},
            {"ORDAX_PROOF_EVIDENCE_SCOPE": "canonical-stable-mvp"},
        ):
            with self.subTest(mutation=mutation), mock.patch.dict(
                "os.environ", {**valid, **mutation}, clear=False
            ):
                with self.assertRaises(ValueError):
                    proof.evidence_context_from_environment()
        self.assertIsNone(proof._evidence_context({"evidence_context": {
            "distribution_profile": "owner-development",
            "runtime_mode": "verified-erofs-overlay",
            "evidence_scope": "development",
            "runtime_sha256": None,
        }}))

    def test_compare_rejects_mixed_development_and_stable_evidence(self):
        before = {
            "schema": proof.SCHEMA,
            "boot_id": "same",
            "evidence_context": {
                "distribution_profile": "owner-development",
                "runtime_mode": "dynamic-native-runtime",
                "evidence_scope": "development",
                "runtime_sha256": None,
            },
            "browser_host_processes": [{"pid": 10, "start_ticks": 20}],
            "session": {"semantic_sha256": "b" * 64, "url_count": 1, "active_index": 0},
        }
        after = {
            **before,
            "evidence_context": {
                "distribution_profile": "stable-mvp",
                "runtime_mode": "verified-erofs-overlay",
                "evidence_scope": "canonical-stable-mvp",
                "runtime_sha256": "e" * 64,
            },
            "browser_host_processes": [{"pid": 11, "start_ticks": 30}],
        }
        self.assertGreater(proof.compare_reports(before, after)["summary"]["fail"], 0)

    def test_wrapper_targets_verified_stable_or_development_runtime_without_installing_dependencies(self):
        text = WRAPPER.read_text(encoding="utf-8")
        resolver = RUNTIME_RESOLVER.read_text(encoding="utf-8")
        self.assertIn("ordax-proof-runtime.sh", text)
        self.assertIn("resolve_ordax_proof_runtime_root", text)
        self.assertIn("/srv/ordax-system/diagnostics/internet_native_physical_proof.py", text)
        self.assertIn('busybox chroot "$RUNTIME_ROOT"', text)
        self.assertIn("/run/ordax-surface/runtime-proof-context", resolver)
        self.assertIn("/run/ordax/runtime/native-surface/rootfs", resolver)
        self.assertIn("alpine-v3.22-cage-webkitgtk-v1", resolver)
        self.assertIn("verified-erofs-overlay", resolver)
        self.assertIn("canonical-stable-mvp", resolver)
        self.assertNotIn('if [ -x "$stable_root/usr/bin/python3" ]', resolver)
        self.assertNotIn("apk add", text + resolver)
        self.assertNotIn("curl ", text + resolver)
        self.assertEqual(stat.S_IMODE(WRAPPER.stat().st_mode), 0o755)


if __name__ == "__main__":
    unittest.main()
