from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BROWSER_HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"


class NativeAppDataNoGlobalBootstrapEventTests(unittest.TestCase):
    def test_app_data_bootstrap_is_delivered_by_direct_privileged_module_call(self):
        source = BROWSER_HOST.read_text(encoding="utf-8")
        start = source.index("    def emit_app_data_bootstrap(self) -> None:")
        end = source.index("    def emit_host_event(self, payload: dict) -> None:", start)
        method = source[start:end]

        self.assertNotIn("window.dispatchEvent", method)
        self.assertNotIn("CustomEvent", method)
        self.assertNotIn("APP_DATA_COMPOSITION_BOOTSTRAP_EVENT", source)
        self.assertIn("/composition/native/app-data-bootstrap.mjs", method)
        self.assertIn("acceptTrustedNativeAppDataBootstrap", method)


if __name__ == "__main__":
    unittest.main()
