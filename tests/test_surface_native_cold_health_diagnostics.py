"""Offline Native Surface must not require optional account traffic before health."""

import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "system/composition/native/main.mjs"
BROWSER = ROOT / "system/surface/runtime/ordax_browser_host.py"
SERVER = ROOT / "system/surface/runtime/native_host_server.py"
DIAGNOSTIC = ROOT / "system/surface/runtime/native_cold_health_diagnostic.py"


class SurfaceColdHealthContract(unittest.TestCase):
    def test_registration_policy_cannot_block_initial_graphical_mount(self):
        code = MAIN.read_text()
        before, after = code.split('reportQemuBootStage("composition-mounted");', 1)
        # The online refresh is defined before the mount but NOT awaited
        # there: only its call site after the real graphical mount is relevant.
        self.assertNotIn("\\n  await identityActions.refresh();\\n", before)
        self.assertIn("    await identityActions.refresh();", before)
        self.assertIn("void resumeAccountConnectivity().catch(", after)
        self.assertIn('componentManager.setCurrentHealth("surface-shell", "healthy")', after)
        self.assertIn("void updateWatcher.markHealthy()", after)
        self.assertIn("createNativeSurfaceHeartbeat(window)", after)

    def test_original_health_and_heartbeat_authorities_are_unchanged(self):
        server = SERVER.read_text()
        self.assertIn('if self.path == HEALTH_PATH:', server)
        self.assertIn("hmac.compare_digest(supplied_token, self.server.health_token)", server)
        self.assertIn('update_state.get("sourceSha") != source_sha', server)
        self.assertIn("record_surface_health(source_sha)", server)
        self.assertIn('("GET", UPDATE_PATH): "http-get-update"', server)
        self.assertNotIn("UPDATE_STATE_PATH", server)
        self.assertIn("record_surface_heartbeat(payload[", server)
        self.assertNotIn("record_surface_health(", BROWSER.read_text())

    def test_serial_observation_requires_disposable_kernel_flag_and_allowlist(self):
        spec = importlib.util.spec_from_file_location("native_diag_test", DIAGNOSTIC)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with patch.object(module, "enabled", return_value=False):
            self.assertFalse(module.emit("webkit-load-finished"))
        with patch.object(module, "enabled", return_value=True):
            self.assertFalse(module.emit("anything-from-user"))
            self.assertFalse(module.emit("http-get-update", 700))
            self.assertFalse(module.emit("http-get-update", True))
        browser = BROWSER.read_text()
        self.assertIn('if command == "boot.diagnostic":', browser)
        self.assertIn('self.surface_view.connect("load-failed", self.on_surface_load_failed)', browser)
        self.assertNotIn('emit_boot_diag(str(', browser)
        self.assertIn('WebKit2.UserScriptInjectionTime.START', browser)
        self.assertIn('"webkit-uri-expected"', browser)
        self.assertIn('"http-surface-document"', browser)
        self.assertIn('"js-unhandled-rejection"', DIAGNOSTIC.read_text())
        self.assertIn('"http-surface-main"', SERVER.read_text())
        self.assertIn('"http-static-module-failed"', SERVER.read_text())
        self.assertIn('def guess_type(self, path: str)', SERVER.read_text())
        self.assertIn('return "text/javascript"', SERVER.read_text())
        self.assertIn('resource-load-started", self.on_surface_resource_load_started', browser)

    def test_bundled_resource_diagnostics_exclude_sensitive_uris(self):
        spec = importlib.util.spec_from_file_location("native_diag_static", DIAGNOSTIC)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        start = "http://127.0.0.1:8765/composition/native/index.html?source=" + "a" * 40
        self.assertEqual(
            module.same_origin_static_resource(
                "http://127.0.0.1:8765/adapters/native/runtime.mjs?secret=NEVER_LOG", start
            ),
            "adapters/native/runtime.mjs",
        )
        for uri in (
            "https://example.com/adapters/native/runtime.mjs",
            "http://127.0.0.1:8765/var/lib/ordax-user/private.mjs",
            "http://127.0.0.1:8765/adapters/../private.mjs",
            "http://127.0.0.1:8765/adapters/%2e%2e/private.mjs",
            "http://127.0.0.1:8765/adapters/private.mjs#bad",
            "http://127.0.0.1:8765/__ordax/native/health",
        ):
            self.assertIsNone(module.same_origin_static_resource(uri, start))
        with patch.object(module, "enabled", return_value=True):
            self.assertFalse(module.emit(
                "webkit-resource-failed", resource_path="../private.mjs"
            ))


if __name__ == "__main__":
    unittest.main()
