"""Protocol regression tests for the read-only real-engine SSE CI probe.

The tests use in-memory stream frames; only the workflow's runtime step proves
actual llama.cpp inference. No network, engine, or artificial device control.
"""
from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "bootstrap/local-ai-runtime/prove_stream.py"
SPEC = importlib.util.spec_from_file_location("ordax_live_sse_probe", SCRIPT)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


def frames(*choices, done=True, model="test-model"):
    lines = []
    for choice in choices:
        lines.append("data: " + json.dumps({"model": model, "choices": [choice]}, separators=(",", ":")) + "\n\n")
    if done:
        lines.append("data: [DONE]\n\n")
    return "".join(lines).encode("utf-8")


class FakeResponse(io.BytesIO):
    status = 200

    def getheader(self, name):
        return "text/event-stream; charset=utf-8" if name.lower() == "content-type" else None


class LiveStreamProbeTests(unittest.TestCase):
    def normal(self):
        return [
            {"index": 0, "delta": {"role": "assistant", "content": "Ol\u00e1 "},
             "finish_reason": None},
            {"index": 0, "delta": {"content": "mundo"}, "finish_reason": None},
            {"index": 0, "delta": {}, "finish_reason": "stop"},
        ]

    def test_complete_sse_is_accepted(self):
        result = probe.verified_stream(FakeResponse(frames(*self.normal())), "test-model")
        self.assertEqual(result["events"], 3)
        self.assertEqual(result["text_chars"], 9)

    def test_truncation_wrong_model_and_missing_done_fail(self):
        for wire in (
            frames(*self.normal(), done=False),
            frames(*self.normal(), model="wrong-model"),
            frames(self.normal()[0], {**self.normal()[2], "finish_reason": "length"}),
            frames(self.normal()[0]),
            frames(self.normal()[2]),
            b'data: {"choices":[]}\n\ndata: [DONE]\n\n',
        ):
            with self.subTest(wire=wire[:64]), self.assertRaises(probe.ProbeError):
                probe.verified_stream(FakeResponse(wire), "test-model")

    def test_tool_authority_and_invalid_roles_are_rejected(self):
        for field in ("tool_calls", "function_call", "tool_call_id", "refusal"):
            for level in ("choice", "delta"):
                choice = self.normal()[0]
                choice = {**choice, "delta": dict(choice["delta"])}
                if level == "choice":
                    choice[field] = "blocked"
                else:
                    choice["delta"][field] = "blocked"
                with self.subTest(field=field, level=level), self.assertRaises(probe.ProbeError):
                    probe.verified_stream(FakeResponse(frames(choice, self.normal()[2])), "test-model")
        for role in ("user", "", None):
            choice = self.normal()[0]
            choice = {**choice, "delta": dict(choice["delta"], role=role)}
            with self.subTest(role=role), self.assertRaises(probe.ProbeError):
                probe.verified_stream(FakeResponse(frames(choice, self.normal()[2])), "test-model")

    def test_only_literal_loopback_http_port_is_accepted(self):
        self.assertEqual(probe.local_port("http://127.0.0.1:17865"), 17865)
        for endpoint in (
            "http://localhost:17865", "https://127.0.0.1:17865",
            "http://127.0.0.2:17865", "http://127.0.0.1",
            "http://127.0.0.1:17865@evil.com", "http://127.0.0.1:0",
            "http://127.0.0.1:17865/evil", "http://127.0.0.1:17865?x=y",
        ):
            with self.subTest(endpoint=endpoint), self.assertRaises(probe.ProbeError):
                probe.local_port(endpoint)


if __name__ == "__main__":
    unittest.main()
