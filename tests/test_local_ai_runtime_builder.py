import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BUILDER_PATH = ROOT / "bootstrap/local-ai-runtime/build.py"
SOURCE_LOCK = ROOT / "system/services/local-ai/source-lock.json"

spec = importlib.util.spec_from_file_location("ordax_local_ai_runtime_builder", BUILDER_PATH)
assert spec and spec.loader
BUILDER = importlib.util.module_from_spec(spec)
spec.loader.exec_module(BUILDER)


class LocalAiRuntimeBuilderTests(unittest.TestCase):
    def test_source_lock_is_exact_and_runtime_is_loopback_only(self):
        lock = BUILDER.load_source_lock()
        self.assertEqual(lock["engine"]["commit"], "7ab4ee7baad2d920464cbacfad4f4b07cf111fd2")
        self.assertEqual(lock["engine"]["build_targets"], ["llama-server"])
        self.assertEqual(
            lock["engine"]["artifact"],
            {
                "platform": "linux-x86_64",
                "binary_format": "ELF",
                "linkage": "static",
                "sha256": "4a974691b9905b88cb46d97c85c2b035b33592a16cd0239ae4c6687f68799afe",
                "size_bytes": 17039584,
            },
        )
        self.assertEqual(lock["model"]["sha256"], "57d1997790d1744fba5b40a7317df71ea5e2acee28c47e78f0cce39c0703f8cf")
        self.assertEqual(lock["model"]["size_bytes"], 563036064)
        self.assertEqual(lock["model"]["license_text_path"], "third_party/licenses/Apache-2.0.txt")
        self.assertEqual(lock["runtime_defaults"], {"reasoning": "off"})
        self.assertEqual(
            lock["runtime_security"],
            {
                "listen_host": "127.0.0.1",
                "listen_port": 17865,
                "web_ui_enabled": False,
                "built_in_tools_enabled": False,
                "agent_mode_enabled": False,
                "mcp_proxy_enabled": False,
                "runtime_model_download_allowed": False,
            },
        )

    def test_launcher_never_enables_provider_tools_or_network_model_fetch(self):
        lock = BUILDER.load_source_lock()
        launcher = BUILDER.launcher_text(lock)
        self.assertIn("--host 127.0.0.1", launcher)
        self.assertIn("--port 17865", launcher)
        self.assertIn("--reasoning off", launcher)
        self.assertIn("--no-ui", launcher)
        self.assertIn("--no-slots", launcher)
        self.assertIn(lock["model"]["filename"], launcher)
        self.assertIn(lock["model"]["id"], launcher)
        for forbidden in (
            "--tools",
            "--agent",
            "--mcp",
            "--hf-repo",
            "--model-url",
            "0.0.0.0",
        ):
            self.assertNotIn(forbidden, launcher)

    def test_builder_rejects_relaxed_runtime_security(self):
        lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        lock["runtime_security"]["listen_host"] = "0.0.0.0"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source-lock.json"
            path.write_text(json.dumps(lock), encoding="utf-8")
            with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "runtime security"):
                BUILDER.load_source_lock(path)

    def test_builder_rejects_malformed_engine_artifact_pin(self):
        lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        lock["engine"]["artifact"]["sha256"] = "0" * 63
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "source-lock.json"
            path.write_text(json.dumps(lock), encoding="utf-8")
            with self.assertRaisesRegex(BUILDER.RuntimeBuildError, "engine artifact pin"):
                BUILDER.load_source_lock(path)

    def test_builder_rejects_model_license_identity_drift(self):
        lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        for value in (None, "MIT", "Proprietary", "apache-2.0"):
            with self.subTest(license=value):
                altered = json.loads(json.dumps(lock))
                altered["model"]["license"] = value
                with tempfile.TemporaryDirectory() as directory:
                    path = Path(directory) / "source-lock.json"
                    path.write_text(json.dumps(altered), encoding="utf-8")
                    with self.assertRaisesRegex(
                        BUILDER.RuntimeBuildError,
                        "model license is not approved",
                    ):
                        BUILDER.load_source_lock(path)

    def test_current_candidate_includes_exact_mit_and_apache_license_sources(self):
        lock = BUILDER.load_source_lock()
        self.assertEqual(lock["engine"]["license"], "MIT")
        self.assertEqual(lock["model"]["license"], "Apache-2.0")
        model_license = ROOT / lock["model"]["license_text_path"]
        contents = model_license.read_text(encoding="utf-8")
        self.assertIn("Apache License", contents[:120])
        self.assertIn("Version 2.0, January 2004", contents[:160])
        builder = BUILDER_PATH.read_text(encoding="utf-8")
        self.assertIn('runtime / "licenses/llama.cpp-MIT.txt"', builder)
        self.assertIn('runtime / "licenses/model-Apache-2.0.txt"', builder)

    def test_model_url_is_revision_pinned(self):
        lock = BUILDER.load_source_lock()
        url = BUILDER.model_url(lock)
        self.assertIn("/resolve/9447f74/", url)
        self.assertTrue(url.endswith("Qwen3.5-0.8B-Q4_0.gguf?download=true"))


if __name__ == "__main__":
    unittest.main()
