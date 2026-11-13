import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "local-ai.json"
PORT = ROOT / "system" / "contracts" / "local-ai.mjs"
README = ROOT / "system" / "services" / "local-ai" / "README.md"
SOURCE_LOCK = ROOT / "system" / "services" / "local-ai" / "source-lock.json"


class LocalAiContractTests(unittest.TestCase):
    def test_local_ai_is_required_in_mvp_distribution_but_not_boot_critical(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["$schema"], "prototype-ordax.local-ai/1")
        self.assertFalse(contract["required_for_boot"])
        self.assertFalse(contract["required_for_offline_use"])
        self.assertTrue(contract["required_for_stable_mvp_distribution"])
        self.assertTrue(contract["runtime"]["internet_required_for_inference"] is False)
        self.assertTrue(contract["runtime"]["engine_migratable"])
        self.assertTrue(contract["runtime"]["model_migratable"])
        self.assertEqual(contract["runtime"]["model_format"], "GGUF")
        self.assertTrue(contract["runtime"]["exact_model_artifact_pinned"])
        self.assertEqual(contract["runtime"]["source_lock"], "system/services/local-ai/source-lock.json")
        self.assertTrue(contract["runtime"]["exact_engine_artifact_pinned"])
        self.assertFalse(contract["creator_toggle"]["user_may_disable"])
        self.assertFalse(contract["creator_toggle"]["exposed_as_install_omission_toggle"])
        self.assertTrue(contract["mvp_policy"]["mandatory"])
        self.assertEqual(contract["migration"]["system_intelligence_contract"], "ordax.intelligence/1")
        self.assertTrue(contract["mvp_policy"]["failure_must_not_block_surface"])

    def test_source_lock_pins_model_bytes_without_committing_large_binary(self):
        lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
        self.assertEqual(lock["engine"]["commit"], "7ab4ee7baad2d920464cbacfad4f4b07cf111fd2")
        self.assertEqual(lock["engine"]["artifact"]["platform"], "linux-x86_64")
        self.assertEqual(lock["engine"]["artifact"]["binary_format"], "ELF")
        self.assertEqual(lock["engine"]["artifact"]["linkage"], "static")
        self.assertEqual(lock["engine"]["artifact"]["sha256"], "c170393570f105856508d5d2f5423e853194dbcd8a55e61136f084e9a0619471")
        self.assertEqual(lock["engine"]["artifact"]["size_bytes"], 17039536)
        self.assertEqual(lock["engine"]["linux_build_toolchain"], {
            "runner_os": "ubuntu-24.04",
            "gcc": "13.3.0",
            "libc6": "2.39-0ubuntu8.12",
            "libc6_dev": "2.39-0ubuntu8.12",
            "binutils": "2.42-4ubuntu2.10",
            "cmake": "3.31.6",
        })
        windows = lock["engine"]["windows_artifact"]
        self.assertEqual(windows["builder_commit"], "70fc05715e1eb99a43d513caec9f4ac13fbcb1f3")
        self.assertEqual(windows["proof_run_id"], 43309006398)
        self.assertEqual(
            windows["proof_bundle_sha256"],
            "21680ead38fbbd34848826badb1ec30ee489b5a8c25fca29deb9d1da74e2cc29",
        )
        self.assertEqual(windows["msvc_runtime"], {
            "distribution": "microsoft-vc143-app-local",
            "publisher": "Microsoft Corporation",
            "version": "14.44.35211.0",
            "files": [
                {"name": "msvcp140.dll", "size_bytes": 557728,
                 "sha256": "0f885b509a685d2bbfa652fed26b5fb31d88fbdab0a978c641d1c7b8aa460aa9"},
                {"name": "vcruntime140.dll", "size_bytes": 124544,
                 "sha256": "d5e4d9a3e835fa679450145d6a7d94e36573a509317111904d9b3712c30d9066"},
                {"name": "vcruntime140_1.dll", "size_bytes": 49792,
                 "sha256": "1f2d41c4aa5db0bc33ebf7b66d72943a817d7ce6cbe880502a9403823633093f"},
            ],
        })
        self.assertEqual(lock["model"]["filename"], "Qwen3.5-0.8B-Q4_0.gguf")
        self.assertEqual(lock["model"]["sha256"], "57d1997790d1744fba5b40a7317df71ea5e2acee28c47e78f0cce39c0703f8cf")
        self.assertEqual(lock["model"]["size_bytes"], 563036064)
        self.assertFalse(lock["distribution"]["model_committed_to_git"])
        self.assertTrue(lock["distribution"]["signed_release_artifact_required"])
        self.assertEqual(
            lock["distribution"]["initial_release_schema_target"],
            "prototype-ordax.release-manifest/4",
        )
        self.assertEqual(lock["runtime_security"]["listen_host"], "127.0.0.1")
        self.assertEqual(lock["runtime_security"]["listen_port"], 17865)
        self.assertFalse(lock["runtime_security"]["web_ui_enabled"])
        self.assertFalse(lock["runtime_security"]["built_in_tools_enabled"])
        self.assertFalse(lock["runtime_security"]["agent_mode_enabled"])
        self.assertFalse(lock["runtime_security"]["mcp_proxy_enabled"])
        self.assertFalse(lock["runtime_security"]["runtime_model_download_allowed"])

    def test_surface_boundary_is_provider_neutral(self):
        port = PORT.read_text(encoding="utf-8")
        readme = README.read_text(encoding="utf-8")
        self.assertIn('LOCAL_AI_PORT_SCHEMA = "ordax.local-ai/1"', port)
        self.assertIn("generate", port)
        for provider in ("llama.cpp", "OpenVINO"):
            self.assertNotIn(provider, port)
            self.assertIn(provider, readme)
        self.assertIn("loopback", readme)
        self.assertIn("no implicit cloud fallback", readme.lower())


if __name__ == "__main__":
    unittest.main()
