from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import os
import stat
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "system/surface/runtime/native_host_server.py"

def load_host():
    spec = spec_from_file_location("ordax_first_run_cursor_test", HOST)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module

class FirstRunResumeCursorTests(unittest.TestCase):
    def test_cursor_is_bounded_and_durable_without_receipt_mutation(self):
        host = load_host()
        with tempfile.TemporaryDirectory() as directory:
            host.FIRST_RUN_FILE = str(Path(directory) / "first-run.json")
            host.FIRST_RUN_CURSOR_FILE = str(Path(directory) / "first-run-cursor.json")
            expected = {"schema": "ordax.first-run-cursor/1", "step": "network"}
            self.assertEqual(host.read_first_run_cursor()["step"], "welcome")
            self.assertFalse(host.valid_first_run_cursor({"schema": expected["schema"], "step": "privacy"}))
            self.assertFalse(host.valid_first_run_cursor({**expected, "identity": "secret"}))
            host.write_first_run_cursor(expected)
            self.assertEqual(host.read_first_run_cursor(), expected)
            self.assertEqual(stat.S_IMODE(os.stat(host.FIRST_RUN_CURSOR_FILE).st_mode), 0o600)
            self.assertFalse(Path(host.FIRST_RUN_FILE).exists())
            self.assertFalse(list(Path(directory).glob("*.tmp.*")))
            with self.assertRaises(ValueError):
                host.write_first_run_cursor({**expected, "step": "ready"})
            host.write_first_run_state({
                "schema": "ordax.first-run-state/1",
                "completed": True,
                "locale": "pt-BR",
                "timeZone": "America/Bahia",
                "accountMode": "local-only",
            })
            with self.assertRaises(ValueError):
                host.write_first_run_cursor({"schema": expected["schema"], "step": "account"})
            self.assertEqual(host.read_first_run_cursor(), expected)

    def test_host_routes_remain_strict_and_loopback_only(self):
        source = HOST.read_text(encoding="utf-8")
        self.assertIn('FIRST_RUN_CURSOR_PATH = "/__ordax/native/first-run-cursor"', source)
        self.assertIn('FIRST_RUN_CURSOR_PATH, DEVICE_PROFILE_PATH', source)
        self.assertIn("payload = self._read_json_body(128)", source)
        self.assertIn('valid_first_run_cursor(payload)', source)
        self.assertIn('write_first_run_cursor(payload)', source)

if __name__ == "__main__":
    unittest.main()
