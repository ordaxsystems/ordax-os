"""Network-real localhost fixture tests; these do NOT measure llama.cpp hardware."""
import importlib.util
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
from threading import Thread
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "tools/benchmarks/local_http.py"
SPEC = importlib.util.spec_from_file_location("ordax_local_http_bench", SCRIPT)
bench = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bench)
MODEL = "fixture-gguf"


class Fixture(BaseHTTPRequestHandler):
    seen = []
    mode = "valid"

    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        length = int(self.headers["Content-Length"])
        value = json.loads(self.rfile.read(length))
        self.__class__.seen.append((value, self.headers.get("Authorization")))
        choice = {
            "index": 0,
            "message": {"role": "assistant", "content": "local answer"},
            "finish_reason": "stop",
        }
        if self.__class__.mode == "tool":
            choice["message"]["tool_calls"] = [{"id": "forbidden"}]
        if self.__class__.mode == "truncated":
            choice["finish_reason"] = "length"
        model = "wrong" if self.__class__.mode == "model" else MODEL
        body = json.dumps({
            "model": model, "choices": [choice], "usage": {"completion_tokens": 3},
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class LocalHttpBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.key = Path(self.temporary.name) / "key"
        self.key.write_text("fixture-private-key\n", encoding="utf-8")
        self.key.chmod(0o600)
        Fixture.mode = "valid"
        Fixture.seen = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        self.thread = Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)
        self.endpoint = f"http://127.0.0.1:{self.server.server_port}"

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def measure(self):
        return bench.benchmark(endpoint=self.endpoint, model=MODEL,
                               api_key_file=self.key, warmups=1,
                               samples=2, max_tokens=5, timeout=5)

    def test_loopback_measurement_is_bounded_and_redacts_private_data(self):
        result = self.measure()
        self.assertEqual(result["schema"], bench.SCHEMA)
        self.assertEqual(result["samples"], 2)
        self.assertEqual(result["warmup_requests"], 1)
        self.assertEqual(result["completion_tokens_total"], 6)
        self.assertGreater(result["end_to_end_effective_tokens_per_second"], 0)
        self.assertGreater(result["latency_ms"]["p95"], 0)
        self.assertFalse(result["hardware_performance_qualified"])
        self.assertFalse(result["is_buildroot_abi_proof"])
        self.assertEqual(len(Fixture.seen), 3)
        for body, authorization in Fixture.seen:
            self.assertEqual(authorization, "Bearer fixture-private-key")
            self.assertEqual(body["stream"], False)
            self.assertEqual(body["model"], MODEL)
        emitted = json.dumps(result)
        self.assertNotIn("fixture-private-key", emitted)
        self.assertNotIn("Briefly explain", emitted)

    def test_remote_or_ambiguous_endpoints_are_rejected(self):
        for url in ("https://127.0.0.1:1234", "http://localhost:1234",
                    "http://8.8.8.8:1234", "http://127.0.0.1:1234@evil.com",
                    "http://127.0.0.1:1234/other", "http://127.0.0.1:1234?x=1",
                    "http://127.0.0.1", "http://127.0.0.1:0"):
            with self.subTest(url=url), self.assertRaises(bench.BenchmarkError):
                bench.completion_url(url)

    def test_insecure_key_and_symlink_are_rejected(self):
        self.key.chmod(0o644)
        with self.assertRaises(bench.BenchmarkError):
            self.measure()
        self.key.chmod(0o600)
        link = Path(self.temporary.name) / "link"
        link.symlink_to(self.key)
        with self.assertRaises(bench.BenchmarkError):
            bench.read_key(link)

    def test_tool_calls_truncation_and_model_mismatch_fail_closed(self):
        for mode in ("tool", "truncated", "model"):
            with self.subTest(mode=mode):
                Fixture.mode = mode
                with self.assertRaises(bench.BenchmarkError):
                    self.measure()

    def test_invalid_sample_bounds_are_rejected_before_network(self):
        with self.assertRaises(bench.BenchmarkError):
            bench.benchmark(endpoint=self.endpoint, model=MODEL,
                            api_key_file=self.key, samples=51)
        self.assertEqual(Fixture.seen, [])


if __name__ == "__main__":
    unittest.main()
